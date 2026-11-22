import { playerName, type Config } from '../config'
import type { Command } from '../types/commands'
import { milestoneNames, type AgentState } from '../types/state'
import { trustFor } from '../brain/socialModel'
import { cleanText } from '../brain/policies/ethicsPolicy'
import { focusText } from '../brain/intentionPlanner'
import type { PerceptionFrame } from '../types/decisions'

export function classifyChat(message: string, username: string, requireAddress: boolean): { kind: 'command' | 'dialogue'; text: string } | null {
  const raw = message.trim()
  if (raw.startsWith('!')) return requireAddress ? null : { kind: 'command', text: raw }
  const [, target, body] = /^@?([A-Za-z0-9_]{1,16})[,:]?\s+(.+)$/u.exec(raw) ?? []
  if (!body || target?.toLowerCase() !== username.toLowerCase()) return null
  return { kind: body.startsWith('!') ? 'command' : 'dialogue', text: body }
}

export function parseCommand(message: string): Command | null {
  const [, word, args] = /^!([a-z]+)(?:\s+(.+))?$/i.exec(message.trim()) ?? []
  const kind = word?.toLowerCase()
  if (kind === 'follow' || kind === 'trust') {
    const player = playerName.safeParse(args?.trim())
    return player.success ? { kind, player: player.data } : null
  }
  if ((kind === 'goal' || kind === 'remember' || kind === 'recall') && args) {
    const text = cleanText(args, 120)
    return text ? { kind, text } : null
  }
  if (!args && (kind === 'status' || kind === 'stop' || kind === 'sleep' || kind === 'memory' || kind === 'debugstate' || kind === 'rethink' || kind === 'play' || kind === 'forget')) return { kind }
  return null
}

interface CommandContext {
  config: Config; state(): AgentState; perception(): PerceptionFrame | undefined
  follow(player: string): void; stop(): void; sleep(): void; goal(text: string): void; rethink(): void; play(): void
  memory(): string; debug(): void; trust(player: string): number | undefined
  activity?(): string | undefined
  recall?(query: string): string
  remember?(player: string, text?: string): boolean
}

export function routeCommand(ctx: CommandContext, player: string, text: string, verified?: boolean): string {
  const command = parseCommand(text)
  if (!command) return 'Try !status, !play, !follow <player>, !stop, !sleep, !memory, !recall <topic>, !remember <preference>, or !forget.'
  const state = ctx.state()
  if (command.kind === 'status') {
    const intent = state.goals.intentions[0]
    const last = state.project?.milestones?.at(-1)
    return `HP ${Math.round(state.vitals.health)}/20, food ${Math.round(state.vitals.food)}/20, sleep debt ${Math.round(state.needs.sleepDebt)}/100. ${state.circadian.sleeping ? 'In bed' : state.runtime.paused ? 'Paused' : ctx.activity?.() ?? state.runtime.lastAction.toLowerCase().replaceAll('_', ' ')}.${intent ? ` Plan: ${focusText[intent]}.` : ''}${last ? ` Reached: ${milestoneNames[last]}.` : ''}`
  }
  if (!ctx.config.MC_ADMINS.has(player.toLowerCase()) || (ctx.config.MC_AUTH === 'microsoft' && verified !== true)) return 'That command is restricted to authorized operators.'
  switch (command.kind) {
    case 'follow': ctx.follow(command.player); return `I'll follow ${command.player} when they're nearby and it's safe.`
    case 'stop': ctx.stop(); return 'Paused. I can still retreat from danger.'
    case 'play':
      if (!ctx.config.AUTONOMY_ENABLED) return 'Survival play is disabled; set AUTONOMY_ENABLED=true before starting.'
      ctx.play(); return 'Autonomous survival resumed. Use !stop to pause.'
    case 'sleep':
      if (!ctx.config.ENABLE_SLEEP) return 'Sleep is disabled.'
      if (state.circadian.sleeping) return "I'm already in bed."
      ctx.sleep(); return ctx.perception()?.beds.length ? "I'll try to use a bed when it's safe." : "I'll look for a free Overworld bed at night or during thunder."
    case 'goal': ctx.goal(command.text); return ctx.config.AUTONOMY_ENABLED ? 'Goal noted as a survival preference. It does not override safety rules.' : 'Goal noted. It does not override my safety rules.'
    case 'trust': return `Simulated trust in ${command.player}: ${Math.round((ctx.trust(command.player) ?? trustFor(state, command.player)) * 100)}%.`
    case 'memory': return ctx.memory()
    case 'recall': return ctx.recall?.(command.text) ?? 'The memory archive is unavailable.'
    case 'remember': return ctx.remember?.(player, command.text) ? "I'll remember that as your preference." : 'I could not save that preference.'
    case 'forget': return ctx.remember?.(player) ? 'Your preference note is cleared.' : 'I could not clear that note.'
    case 'debugstate': ctx.debug(); return 'I wrote state diagnostics to the local log.'
    case 'rethink': ctx.rethink(); return 'Reconsidering my next action. Use !play, !follow, or !sleep to leave pause mode.'
  }
}
