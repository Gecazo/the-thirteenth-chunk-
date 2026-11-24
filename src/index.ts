import { loadConfig, playerName } from './config'
import { makeLogger } from './infra/logger'
import { systemClock } from './infra/clock'
import { seededRng } from './infra/rng'
import { installShutdown } from './infra/shutdown'
import { errorMessage } from './infra/errors'
import { openSoulFile } from './storage/soulFile'
import { StateRepo } from './storage/repositories/stateRepo'
import { MemoryRepo } from './storage/repositories/memoryRepo'
import { SocialRepo } from './storage/repositories/socialRepo'
import { SleepRepo } from './storage/repositories/sleepRepo'
import { StateEngine } from './brain/stateEngine'
import { ShortTermMemory } from './brain/memory/shortTermMemory'
import { ollamaClient, openAiLocalClient } from './llm/localOllamaClient'
import { cloudClient } from './llm/cloudClient'
import { runMinecraft, type MinecraftContext } from './bot/minecraftClient'
import { ReconnectControl, reconnect } from './bot/reconnect'
import { ZodError } from 'zod'
import { startMonitor } from './monitor/server'
import { openTeam } from './brain/survival/team'

async function main() {
  const config = loadConfig(), log = makeLogger(config), clock = systemClock, rng = seededRng(config.RNG_SEED)
  const storage = openSoulFile(config.STATE_PATH)
  const monitor = startMonitor(config)
  monitor?.update({ status: 'starting', updatedAt: clock.now() })
  const reconnectControl = new ReconnectControl()
  monitor?.setConnectHandler(() => reconnectControl.connectNow())
  if (monitor) log.info({ url: monitor.url }, 'SoulBot monitor running')
  let team: Awaited<ReturnType<typeof openTeam>>
  try {
    team = await openTeam(config)
    const stateRepo = new StateRepo(storage), persisted = stateRepo.load()
    const engine = new StateEngine(persisted.state, playerName.safeParse(config.MC_USERNAME).data ?? 'SoulBot', clock, log)
    const stm = new ShortTermMemory(config.STM_CAPACITY, persisted.events)
    stateRepo.save(engine.get(), stm.all())
    const controller = new AbortController()
    const ctx: MinecraftContext = { config, log, clock, rng, engine, stm, stateRepo,
      memories: new MemoryRepo(storage), social: new SocialRepo(storage), repo: new SleepRepo(storage),
      providers: { local: config.LOCAL_LLM_ENABLED
        ? (config.LOCAL_OPENAI_BASE_URL ? openAiLocalClient(config) : ollamaClient(config))
        : undefined, cloud: config.CLOUD_SLEEP_ENABLED ? cloudClient(config) : undefined },
      monitor, team,
    }
    installShutdown(async () => { log.info('Graceful shutdown requested'); controller.abort(); await monitor?.close() })
    log.info({ host: config.MC_HOST, port: config.MC_PORT, identity: engine.get().identity.id, auth: config.MC_AUTH,
      soulFile: config.STATE_PATH, localAdvisor: config.LOCAL_LLM_ENABLED,
      localEngine: config.LOCAL_OPENAI_BASE_URL ?? (config.LOCAL_LLM_ENABLED ? 'ollama' : 'none'), cloudSleepAdvisor: config.CLOUD_SLEEP_ENABLED,
    }, 'Starting SoulBot behavior simulation')
    if (!config.MC_ADMINS.size) log.warn('No MC_ADMINS configured: only !status is available in chat')
    await reconnect(signal => runMinecraft(ctx, signal), controller.signal, log, rng, reconnectControl)
    stateRepo.save(engine.get(), stm.all())
    monitor?.update({ status: 'stopped', updatedAt: clock.now() })
    log.info('Saved state and shut down')
  } finally {
    storage.close()
    await monitor?.close().catch(() => {})
    team?.close()
  }
}

void main().catch(error => {
  if (error instanceof ZodError) console.error('Validation failed:', error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '))
  else console.error('SoulBot startup/runtime failure:', errorMessage(error))
  process.exitCode = 1
})
