import dotenv from 'dotenv'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { parseArgs } from 'node:util'

const bool = (fallback: boolean) => z.enum(['true', 'false']).default(String(fallback) as 'true' | 'false').transform(v => v === 'true')
const int = (fallback: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(fallback)
const limit = (cap: number) => z.coerce.number().min(0).max(cap).default(cap)
const url = z.url({ protocol: /^https?$/ }).refine(v => {
  const parsed = new URL(v)
  return !parsed.username && !parsed.password && !parsed.search && !parsed.hash
}, 'Use a base URL with no credentials, query, or fragment').transform(v => v.replace(/\/+$/, ''))
export const playerName = z.string().regex(/^[A-Za-z0-9_]{1,16}$/)
const instanceName = z.string().regex(/^[a-z0-9_]{1,16}$/, 'Use 1–16 lowercase letters, digits, or underscores for an instance name')
const instanceSelection = z.object({ SOULBOT_INSTANCE: instanceName.optional() })

const schema = z.object({
  SOULBOT_INSTANCE: instanceName.optional(),
  MC_HOST: z.string().min(1).default('localhost'), MC_PORT: int(25565, 1, 65535),
  MC_USERNAME: z.string().min(1).default('SoulBot'), MC_VERSION: z.string().min(1).default('1.20.1'),
  MC_AUTH: z.enum(['offline', 'microsoft']).default('offline'), MC_AUTH_CACHE: z.string().min(1).default('./data/auth'),
  MC_ADMINS: z.string().default('').transform(s => s.split(',').map(s => s.trim()).filter(Boolean)).pipe(z.array(playerName)).transform(names => new Set(names.map(n => n.toLowerCase()))),
  THINK_INTERVAL_MS: int(3000, 250, 10000), ACTION_TIMEOUT_MS: int(15000, 1000, 90000), PERCEPTION_RADIUS: int(24, 12, 48),
  HUNGER_TRIGGER: int(65, 0, 100), SAFETY_TRIGGER: int(35, 0, 100), SLEEP_TRIGGER: int(60, 0, 100),
  SLEEP_EVERY_NIGHT: bool(true),
  ENABLE_SLEEP: bool(true), MAX_TRAIT_DRIFT_PER_SLEEP: limit(0.02), MAX_TRUST_DELTA_PER_SLEEP: limit(0.05),
  MAX_VALUE_DELTA_PER_SLEEP: limit(0.01), ALLOW_CORE_VALUE_CHANGE: bool(false),
  LOCAL_LLM_ENABLED: bool(true), OLLAMA_BASE_URL: url.default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().min(1).max(200).default('qwen3.5:4b'), OLLAMA_TIMEOUT_MS: int(30000, 250, 60000),
  OLLAMA_CONTEXT: int(4096, 2048, 16384),
  AUTONOMY_ENABLED: bool(false), AUTONOMY_VISION: bool(true), AUTONOMY_RADIUS: int(28, 12, 48),
  AUTONOMY_PLAN_INTERVAL_MS: int(7500, 1500, 60000), AUTONOMY_MODEL_TIMEOUT_MS: int(8000, 1000, 20000),
  REFLECTION_ENABLED: bool(false),
  MONITOR_ENABLED: bool(true), MONITOR_HOST: z.string().min(1).default('127.0.0.1'), MONITOR_PORT: int(8787, 1, 65535),
  CLOUD_SLEEP_ENABLED: bool(false), CLOUD_PROVIDER: z.enum(['openrouter', 'openai', 'compatible']).default('openrouter'),
  CLOUD_BASE_URL: url.default('https://openrouter.ai/api/v1'), CLOUD_MODEL: z.string().min(1).max(200).default('openai/gpt-4.1'),
  CLOUD_API_KEY: z.string().trim().default(''), CLOUD_TIMEOUT_MS: int(7000, 250, 30000),
  STATE_PATH: z.string().refine(v => extname(v).toLowerCase() === '.md', 'Use a Markdown path (e.g. ./soul.md); import legacy saves with npm run import:soul').default('./soul.md'),
  STM_CAPACITY: int(300, 20, 2000), RNG_SEED: z.preprocess(v => v === '' ? undefined : v, z.coerce.number().int().min(0).max(0xffffffff).optional()),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  LOG_PRETTY: bool(true), AUDIT_LOG_SLEEP_DIFFS: bool(true),
}).superRefine((v, ctx) => {
  if (v.CLOUD_SLEEP_ENABLED && (!v.CLOUD_API_KEY || !v.CLOUD_BASE_URL.startsWith('https://'))) {
    ctx.addIssue({ code: 'custom', path: ['CLOUD_BASE_URL'], message: 'Enabled cloud sleep requires HTTPS and CLOUD_API_KEY' })
  }
  if (v.MC_AUTH === 'offline' && !playerName.safeParse(v.MC_USERNAME).success) {
    ctx.addIssue({ code: 'custom', path: ['MC_USERNAME'], message: 'Offline usernames must be Java player names' })
  }
  if (v.SOULBOT_INSTANCE && v.MC_AUTH === 'microsoft' && v.MC_USERNAME === v.SOULBOT_INSTANCE) {
    ctx.addIssue({ code: 'custom', path: ['MC_USERNAME'], message: 'Set this instance’s Microsoft account in its .env file' })
  }
})

export type Config = z.infer<typeof schema>
export function parseConfig(env: NodeJS.ProcessEnv = {}): Config {
  const { SOULBOT_INSTANCE: instance } = instanceSelection.parse(env)
  if (!instance) return schema.parse(env)
  const directory = join('data', 'instances', instance)
  return schema.parse({ ...env, MC_USERNAME: env.MC_USERNAME ?? instance,
    MC_AUTH_CACHE: env.MC_AUTH_CACHE ?? join(directory, 'auth'), STATE_PATH: env.STATE_PATH ?? join(directory, 'soul.md'),
  })
}

function readEnvFile(path: string): Record<string, string> {
  try { return dotenv.parse(readFileSync(path)) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

export function loadConfig(args = process.argv.slice(2), env = process.env, cwd = process.cwd()): Config {
  const { values } = parseArgs({ args, options: { instance: { type: 'string' } } })
  const { SOULBOT_INSTANCE: id } = instanceSelection.parse({ SOULBOT_INSTANCE: values.instance ?? env.SOULBOT_INSTANCE })
  const shared = readEnvFile(join(cwd, '.env'))
  if (id) for (const key of ['MC_USERNAME', 'MC_AUTH_CACHE', 'STATE_PATH']) delete shared[key]
  const profile = id ? readEnvFile(join(cwd, `.env.${id}`)) : {}
  return parseConfig({ ...shared, ...profile, ...env, SOULBOT_INSTANCE: id })
}
