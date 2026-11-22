import { createBot, type Bot } from 'mineflayer'
import { Movements, pathfinder } from 'mineflayer-pathfinder'
import { playerName } from '../config'
import { type BrainContext, ThinkLoop } from '../brain/thinkLoop'
import { replyToChat } from '../brain/dialogue'
import { retrieve } from '../brain/memory/retrieval'
import { editPlayerNote, recallContext, recallHistory } from '../brain/memory/journal'
import type { MemoryRepo } from '../storage/repositories/memoryRepo'
import type { SocialRepo } from '../storage/repositories/socialRepo'
import { errorMessage } from '../infra/errors'
import { renderTopDown } from '../monitor/mapRender'
import { classifyChat, routeCommand } from './commandRouter'
import { dangerousBlocks, hostilesNear, vec } from './perception'
import type { Point } from '../types/decisions'

export interface MinecraftContext extends BrainContext { memories: MemoryRepo; social: SocialRepo }

function safeMovement(bot: Bot, radius: number) {
  const moves = new Movements(bot)
  moves.canDig = moves.canOpenDoors = moves.allow1by1towers = moves.allowParkour = moves.allowSprinting = moves.allowFreeMotion = false
  moves.maxDropDown = 2
  moves.infiniteLiquidDropdownDistance = false
  moves.scafoldingBlocks = []
  for (const name of dangerousBlocks) {
    const block = bot.registry.blocksByName[name]
    if (block) moves.blocksToAvoid.add(block.id)
  }
  moves.exclusionAreasStep.push(block => {
    if (!block?.position) return 0
    const down = bot.blockAt(block.position.offset(0, -1, 0), false)
    return (down && dangerousBlocks.has(down.name)) || dangerousBlocks.has(block.name) ? 100 : 0
  })
  // Refresh the risk map when pathfinder rebuilds its entity collision index, not for each open node.
  let threats = hostilesNear(bot, radius)
  const updateCollisionIndex = moves.updateCollisionIndex.bind(moves)
  moves.updateCollisionIndex = () => { updateCollisionIndex(); threats = hostilesNear(bot, radius) }
  moves.exclusionAreasStep.push(block => {
    if (!block?.position) return 0
    const near = threats.slice(0, 8).some(mob => block.position.distanceTo(vec(mob.position)) < Math.min(4, mob.distance - .4))
    return near ? 100 : 0
  })
  bot.pathfinder.thinkTimeout = 5000
  bot.pathfinder.tickTimeout = 40
  bot.pathfinder.setMovements(moves)
}

function wireChat(bot: Bot, ctx: MinecraftContext, loop: ThinkLoop) {
  let nextCommand = 0, nextDenial = 0, nextDialogue = 0, conversation: Promise<unknown> | undefined
  // Protocol sender UUID + plain payload, not a username parsed from formatted/system chat.
  bot._client.on('playerChat', packet => {
    if (!loop.live || typeof packet.plainMessage !== 'string' || packet.plainMessage.length > 256) return
    const sender = Object.values(bot.players).find(p => p.uuid === packet.sender)?.username
    if (!sender || sender === bot.username || !playerName.safeParse(sender).success) return
    const message = classifyChat(packet.plainMessage, bot.username, Boolean(ctx.config.SOULBOT_INSTANCE))
    if (!message) return
    const { text } = message, now = ctx.clock.now()
    const auth = ctx.config.MC_ADMINS.has(sender.toLowerCase()) && (ctx.config.MC_AUTH === 'offline' || packet.verified === true)
    if (message.kind === 'command') {
      const stop = auth && /^!stop$/i.test(text)
      if (!stop && (auth ? now < nextCommand : now < nextDenial)) return
      if (auth) nextCommand = now + 750
      else nextDenial = now + 1500
      try {
        const reply = routeCommand({ config: ctx.config, state: () => ctx.engine.get(), perception: () => loop.perception,
          follow: target => loop.manual('follow', target), stop: () => loop.manual('stop'), sleep: () => loop.manual('sleep'), play: () => loop.manual('play'),
          goal: text => loop.manual('goal', text), rethink: () => loop.rethink(), debug: () => {
            const state = ctx.engine.get()
            state.journal.players = []
            ctx.log.info({ state, perception: loop.perception }, 'Operator state diagnostic')
          },
          trust: player => ctx.social.read(player)?.trust,
          activity: () => loop.activity,
          recall: query => recallHistory(ctx.engine.get(), ctx.memories.list(), now, query, ctx.stm.all())[0]?.summary.slice(0, 160) ?? 'I found no memory matching that topic.',
          remember: (player, text) => {
            const journal = editPlayerNote(ctx.engine.get().journal, player, text)
            if (!journal) return false
            const state = ctx.engine.prepare(s => { s.journal = journal })
            ctx.stateRepo.save(state, ctx.stm.all())
            ctx.engine.install(state)
            return true
          },
          memory: () => {
            const s = ctx.engine.get()
            const top = retrieve(ctx.memories.list(), { topics: s.goals.intentions, mood: s.emotions.joy - s.emotions.fear, now, limit: 1 })[0]
            return s.journal.notes[0]?.text.slice(0, 160) ?? top?.summary.slice(0, 160) ?? `No consolidated memories yet. ${ctx.stm.all().length} recent events in short-term memory.`
          },
        }, sender, text, packet.verified)
        bot.whisper(sender, reply)
      } catch (err) { ctx.log.error({ error: errorMessage(err) }, 'Command failed'); bot.whisper(sender, 'That command did not complete; check the local logs.') }
      return
    }
    const state = ctx.engine.get()
    if (conversation || now < nextDialogue || state.circadian.sleeping || state.runtime.paused) return
    nextDialogue = now + 5000
    const signal = loop.signal
    const recall = recallContext(state, ctx.memories.list(), now, text, auth ? sender : undefined, ctx.stm.all())
    conversation = replyToChat(text, state, ctx.providers.local, signal, { activity: loop.activity, recall }).then(reply => {
      if (reply && !signal.aborted && !bot.isSleeping && !ctx.engine.get().runtime.paused) {
        if (recall.playerNote) bot.whisper(sender, reply)
        else bot.chat(reply)
      }
    }).catch(() => {}).finally(() => { conversation = undefined })
  })
}

export async function runMinecraft(ctx: MinecraftContext, signal: AbortSignal): Promise<{ connectedMs: number }> {
  const { config, log, clock } = ctx
  signal.throwIfAborted()
  let closing = false
  const bot = createBot({ host: config.MC_HOST, port: config.MC_PORT, username: config.MC_USERNAME, version: config.MC_VERSION,
    auth: config.MC_AUTH, profilesFolder: config.MC_AUTH_CACHE, logErrors: false, hideErrors: true, defaultChatPatterns: false,
    onMsaCode: data => { if (!closing) console.info(`Microsoft sign-in: open ${data.verification_uri} and enter ${data.user_code}`) },
  })
  bot.loadPlugin(pathfinder)
  // mineflayer-pvp is intentionally not loaded. No combat capability is exposed to the planner.
  const loop = new ThinkLoop(bot, ctx)
  let spawnedAt: number | undefined, lastHealth: number | undefined
  let finish!: (reason: string) => void
  const ended = new Promise<string>(resolve => { finish = resolve; bot.once('end', resolve) })
  const end = (reason: string) => {
    if (closing) return
    closing = true
    if (bot._client.socket) bot.end(reason)
    else finish(reason) // Authentication or DNS can fail before there is a socket to emit end.
  }
  bot._client.on('connect', () => { if (closing) bot._client.socket.destroy() })
  const stop = () => end('SoulBot shutting down')
  signal.addEventListener('abort', stop, { once: true })
  const loginTimeout = setTimeout(() => end('connection/spawn deadline exceeded'), config.MC_AUTH === 'microsoft' ? 300_000 : 45_000)
  bot.on('spawn', () => {
    if (closing) return
    clearTimeout(loginTimeout)
    spawnedAt ??= clock.now()
    lastHealth = undefined
    ctx.team?.identify(bot.username)
    ctx.monitor?.update({ status: 'connected', username: bot.username })
    ctx.monitor?.setRenderer(() => {
      const project = ctx.engine.get().project
      const outlines: Array<[Point, number, [number, number, number]]> = []
      if (project?.shelter) outlines.push([project.shelter, 4, [80, 220, 100]])
      if (project?.workshop) outlines.push([project.workshop, 3, [240, 160, 60]])
      if (project?.house) outlines.push([project.house, 6, [180, 120, 240]])
      if (project?.mineshaft) outlines.push([project.mineshaft, 6, [160, 110, 70]])
      return renderTopDown(bot, config.PERCEPTION_RADIUS, outlines)
    })
    log.info({ username: bot.username, version: bot.version, dimension: bot.game.dimension }, 'Minecraft bot spawned')
    try { safeMovement(bot, config.PERCEPTION_RADIUS); loop.restart() } catch (err) { log.error({ error: errorMessage(err) }, 'Spawn initialization failed'); end('spawn initialization failed') }
  })
  bot.on('health', () => {
    if (lastHealth !== undefined && bot.health < lastHealth) loop.damage('unknown')
    lastHealth = bot.health
  })
  bot.on('entityHurt', (entity, source) => {
    if (entity === bot.entity) loop.damage(source?.username ?? source?.name ?? 'unknown')
  })
  bot.on('death', () => { try { loop.death() } catch (error) { log.error({ error: errorMessage(error) }, 'Could not checkpoint death') } })
  bot.on('respawn', () => { if (loop.live) loop.worldChanged() })
  bot.on('sleep', () => loop.slept())
  bot.on('wake', () => loop.woke())
  bot.on('kicked', (reason, loggedIn) => log.warn({ reason: errorMessage(reason), loggedIn }, 'Kicked by Minecraft server'))
  bot.on('error', err => {
    log.warn({ error: errorMessage(err) }, 'Minecraft client error')
    if (!bot._client.socket) end('connection failed before login')
  })
  wireChat(bot, ctx, loop)
  try {
    const reason = await ended
    ctx.monitor?.setRenderer(undefined)
    ctx.monitor?.update({ status: 'disconnected', reason: errorMessage(reason), activeAction: null })
    log.info({ reason: errorMessage(reason) }, 'Minecraft session ended')
  } finally {
    closing = true
    signal.removeEventListener('abort', stop)
    clearTimeout(loginTimeout)
    try { await loop.close() } finally { ctx.team?.offline() }
  }
  return { connectedMs: spawnedAt === undefined ? 0 : clock.now() - spawnedAt }
}
