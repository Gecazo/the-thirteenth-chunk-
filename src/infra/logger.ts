import pino from 'pino'
import type { Config } from '../config'

export type Logger = pino.Logger
export function makeLogger(config: Config): Logger {
  return pino({ name: 'soulbot', level: config.LOG_LEVEL }, config.LOG_PRETTY
    ? pino.transport({ target: 'pino-pretty', options: { colorize: Boolean(process.stdout.isTTY), translateTime: 'SYS:standard' } })
    : undefined).child({ instance: config.SOULBOT_INSTANCE ?? 'default' })
}
