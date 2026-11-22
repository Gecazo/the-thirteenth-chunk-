# Minecraft SoulBot

SoulBot is a Minecraft Java Edition companion with a persistent profile, simulated emotions and needs, and a real Minecraft sleep routine. In survival mode, local Ollama chooses the bot's jobs and distills in-game outcomes into reusable rules at night. The game controller enforces safety and executes those jobs. Bots can also work together on one shelter while keeping their own memories.

## Quick start

**Requirements:** Node.js 24 LTS recommended (required for the documented team setup), npm, and a running Minecraft Java server. Start Ollama for AI-driven play. The default game version is **1.20.1**; the survival progression smoke test uses **1.21.1**. Use a private server where bots are welcome. The bot does not require operator privileges.

```sh
npm ci
cp .env.example .env
```

In `.env`, set `MC_HOST`, `MC_PORT`, and `MC_VERSION` for your server, and set `MC_ADMINS=YourJavaName` so you can control the bot. For an online-mode server, set `MC_AUTH=microsoft` and `MC_USERNAME` to the account email; follow the device-code instructions printed at first login. Use a separate Minecraft account so you and the bot can be online concurrently. For a trusted, private offline-mode server, `MC_AUTH=offline` and `MC_USERNAME=SoulBot` work without an account. **Never use offline mode for administration on an untrusted server.**

```sh
npm run build
npm start
```

`npm run dev` watches source files. `npm run lint` runs ESLint and strict TypeScript checks. `npm test` builds and runs deterministic unit and integration tests with real Markdown saves and mock advisors; no server or model is needed for those tests.

### Monitor dashboard (thoughts + stats)

By default, SoulBot runs a local monitor at `http://127.0.0.1:8787`.

- Shows live planner thoughts (chosen action, top candidates, blocked reasons)
- Vitals/needs/emotions
- Goals/runtime flags
- Inventory and nearby safety context
- Recent short-term events
- Raw JSON snapshot at `/api/state`

Settings in `.env`:

```dotenv
MONITOR_ENABLED=true
MONITOR_HOST=127.0.0.1
MONITOR_PORT=8787
```

Named instances get separate default ports. Override `MONITOR_PORT` in `.env.<instance>` if needed.

### Try it in game

1. Join the same server. Use `!status` and `!follow YourJavaName`. Walk on ordinary terrain within the sensing radius (24 blocks by default).
2. Give SoulBot ordinary food such as bread or cooked beef. It eats at 7/20 food under the default threshold, or sooner if wounded. On a staging server, `HUNGER_TRIGGER=5` makes it eat as soon as it loses one food point.
3. Place a **free Overworld bed** along a walkable route. Keep an empty hotbar slot and the bot's off-hand free. Send `!sleep` after sunset, or during the day to queue a request. The bot enters a real bed; if other players are online, have them sleep too or use your server's normal `playersSleepingPercentage` setting. On a private test world, set the time to `13000` to try it immediately.
4. Look for `Server confirmed bed sleep` and `Sleep consolidation committed` in the logs, and the intention statement in Minecraft chat at dawn. Use `!memory` for a retrieved memory. Restart with the same datastore to keep the same identity and intentions.

### Commands

Type these in normal player chat. Replies are private whispers except addressed conversation and the dawn statement. `!status` is public; all other commands need an allowlisted player and, in Microsoft mode, verified signed player chat.

| Command | What it does |
| --- | --- |
| `!status` | Health, food, sleep debt, current activity, first intention, and most recent survival milestone |
| `!play` | Resume autonomous survival when enabled; clear follow and pending sleep |
| `!follow <player>` | Follow the named nearby player; urgent needs and danger can interrupt |
| `!stop` | Clear follow and pending sleep, wake if in bed, pause routine actions; emergency retreat remains active |
| `!sleep` | Leave pause mode and request a real bed when conditions permit |
| `!memory` | Retrieve a relevant long-term memory or show the recent-event count |
| `!recall <topic>` | Search the experience archive and recent work, e.g. `!recall tree` |
| `!remember <preference>` | Save or replace your own private preference for addressed conversation |
| `!forget` | Clear your preference note; does not erase game history |
| `!trust <player>` | Inspect simulated trust; this is not a permission or reputation signal |
| `!goal <text>` | Save a preference (e.g. `!goal build a shelter`), not a new skill or an instruction to execute |
| `!debugstate` | Write diagnostics to the bot process log, not in-game chat |
| `!rethink` | Request an immediate planning pass without unpausing |

For conversation, address the bot directly, e.g. `SoulBot, how are you?`. It can answer deterministically without Ollama.

## Autonomous survival on a 16 GB Mac mini

Use **`qwen3.5:4b`** in Ollama. The default quantized download is about 3.3 GB on disk. The 4,096-token context and short, non-thinking replies keep the model's workload modest alongside Minecraft. Start with one model-enabled bot on a 16 GB machine.

With the Ollama app running, run `ollama pull qwen3.5:4b`. Add or update these lines in `.env` (or in `.env.<instance>` for just one named bot):

```dotenv
AUTONOMY_ENABLED=true
AUTONOMY_VISION=true
LOCAL_LLM_ENABLED=true
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3.5:4b
```

Rebuild and restart the bot, not the Minecraft server. Use a private test world or an area you're willing to let it modify. If the save isn't paused, the bot can start working on its own; its first survival planning pass saves its current location as the work-area anchor. Use `!stop` to pause and `!play` to resume (`@cedar !play` for a named bot). Project coordinates, pending furnace work, and the survival milestone checklist stay in that bot's `soul.md`. `!play` does not move the work area; for another world, use a separate instance or save file.

| Setting | Default | Effect |
| --- | --- | --- |
| `AUTONOMY_ENABLED` | `false` | Opt into gathering, crafting and building in the Survival Overworld |
| `AUTONOMY_VISION` | `true` | Include a 256×160 first-person terrain render; disable for text-only models or lower inference load |
| `AUTONOMY_RADIUS` | `28` | Maximum horizontal distance for job targets from the saved anchor (12–48 blocks) |
| `AUTONOMY_REQUIRE_AI` | `true` | Require a valid Ollama choice before running a survival job; `false` allows a rules-only fallback |
| `AUTONOMY_MODEL_TIMEOUT_MS` | `12000` | Deadline for a survival plan; raise it if several bots share one Ollama instance |
| `OLLAMA_CONTEXT` | `4096` | Token context for local requests; increasing it can use more memory |
| `SLEEP_EVERY_NIGHT` | `true` | Attempts real sleep each night when a safe bed can be reached |
| `REFLECTION_ENABLED` | `false` | Enables the explicit pause-and-reflect action; keep false for more active play |
| `MONITOR_ENABLED` | `true` | Starts a local web dashboard with thoughts/state |
| `MONITOR_PORT` | `8787` | Dashboard port (set per instance when running many bots) |

The image is a simplified view of nearby loaded terrain, not the Minecraft client screen. Ollama chooses **each survival job** from a bounded list and sees the bot's profile, feelings, intentions, observations and recently learned skills. With strict mode on, an invalid or unavailable model plan is visible on the dashboard and retried on a later tick; routine jobs don't silently switch to rules-only mode. Immediate retreat, eating, going to bed and operator commands remain deterministic so they don't depend on model latency. For two bots sharing one Apple Silicon Mac, start with `AUTONOMY_VISION=false` and give both time to queue at Ollama.

**How Adam learns:** job outcomes (including failed attempts) go into memory. A real Minecraft sleep starts an Ollama review of that day's results. For example, given successful nearby tree harvests and failed distant ones, it can learn `tree: nearest`. A validated rule is saved in the bot's own `soul.md`, shown under **Learned skills & team**, and influences future candidate order and model prompts. Rules lose weight over eight in-game days unless refreshed by new evidence. It learns when to use existing actions, not arbitrary code or new motor abilities. No model weights are retrained.

### Hermes-inspired memory

Like [Hermes Agent](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory), SoulBot separates frequently needed memory from history it recalls on demand. Each bot keeps its own compact **Curated journal**, a searchable archive of past in-game experiences, a short-term event buffer, and separate learned rules. Ollama selects which verified notes to carry forward after sleep; pruning the journal does not delete entries from the archive. Job planning and dialogue receive a bounded portion of the journal, a few relevant older memories, and recent events. Unaddressed chat is not stored, and this is not a raw chat transcript or a connection to Hermes's own files.

An allowlisted player can use `!remember I prefer short replies` (or `@cedar !remember I prefer short replies`) to save a preference immediately. `!forget` removes it. Preferences are scoped to that player's conversation; replies using one are whispered. They aren't sent to the survival planner, the team board, the cloud advisor, or the dashboard. The per-bot checkpoint contains the notes, so don't store credentials in them or share the save publicly. For curation to run, provide a reachable free Overworld bed.

**Survival progression:**

1. **Gather and make tools.** Harvest reachable parts of trunks near foliage, make a crafting table, and progress from a wooden pickaxe to a stone one.
2. **Build a home.** Assemble a roofed 4×4 shelter with an open doorway. The planner checks the actual blocks, not just how many placement jobs ran.
3. **Upgrade and expand.** After the home is complete, mine exposed iron with a suitable pickaxe, smelt it in an owned furnace, and return later for the ingots. Build a separate roofed 3×3 workshop when a suitable plot is available. Iron and expansion can progress in parallel.
4. **Furnished house.** A six-wide, two-story blueprint with glass windows, oak doors, interior stairs to the loft, chest storage, a bed, crafting/furnace stations and torch lighting. Placed by role: each cell accepts only its role's palette (walls accept planks/cobblestone, windows accept glass, stairs accept stair items, etc.). Decorative-only cells are skipped instead of stalling the build.
5. **Mineshaft.** A staircase descending six blocks with torch anchors every other step, built after the house. The bot stores surplus blocks and food in the house chest when its inventory fills up.

Start near trees, exposed stone and iron, and clear flat ground (at least 6×6 for the home, plus space nearby for the workshop). Supply food for longer sessions. Rare or inaccessible resources, obstructed sites, threats and server protections can stall progress. This is bounded early-game automation, not unrestricted play: no combat, farming, caving, custom building plans, or Nether/End progression. It cannot distinguish all player-built structures from natural resources.

## Run multiple bots

Build once, then start each bot in a separate terminal from the project directory:

```sh
npm run build
npm start -- --instance cedar
# In another terminal:
npm start -- --instance birch
```

Each named instance has its own `data/instances/<name>/soul.md`, Microsoft auth cache, and instance label in logs. On a private offline-mode test server, the instance name is also the default Minecraft username. On an online-mode server, each bot needs its own Microsoft account with Minecraft Java. Don't reuse a username/account on the same server, or the server may disconnect the previous session.

Shared settings such as `MC_HOST`, `MC_PORT`, and `MC_ADMINS` can stay in `.env`. Named bots do **not** inherit `.env`'s `MC_USERNAME`, `STATE_PATH`, `MC_AUTH_CACHE` or `MONITOR_PORT`. Each named monitor gets a stable default port (printed on startup); if two ports clash, override one in its instance file. Exported environment variables override file settings. Instance names use lowercase letters, digits, or underscores (1–16 characters).

Address the Minecraft username so only that bot responds: `@cedar !follow YourJavaName`, `@birch !status`. Bare commands still work for the unnamed standalone bot. Every bot has independent sleep history, but all online bots can count toward the server's sleep vote.

Only one process may open a given save, including imports. Normal shutdown removes its `.lock` file. If a hard kill leaves a lock behind, confirm the process listed in the lock is no longer using that save before removing **only** the `.lock` file. Do not delete `soul.md`.

### Have two bots build one shelter

Use **Node 24 LTS** and two fresh named saves (e.g. `cedar` and `birch`). In **both** `.env.cedar` and `.env.birch`, set the same team ID and site coordinates. Replace the sample coordinates with the minimum X/Z corner of a clear 4×4 plot on your server. The Y coordinate should be the first air block above level ground. Start both bots within their work radius, with an accessible plot and building resources.

```dotenv
AUTONOMY_ENABLED=true
AUTONOMY_REQUIRE_AI=true
LOCAL_LLM_ENABLED=true
AUTONOMY_VISION=false
TEAM_ID=homestead
TEAM_HOME=120,68,-45
```

Start the two instances as above, from the same project directory on the same Mac. They share a local team board under `data/teams/`, not a `soul.md`. The board exchanges job updates and reserves particular blocks or stations so two bots don't start on the same target. Both see peer activity in Ollama prompts and on their dashboards, and actual placed blocks count toward the same shelter. This version coordinates through the board rather than free-form Minecraft chat; it does not yet trade inventory, coordinate across machines, or accept arbitrary shared projects. Do not point an existing personal project save at a different team build site; use a fresh named save.

## Models, storage, and logs

- **No-model baseline:** Set `LOCAL_LLM_ENABLED=false` and leave `CLOUD_SLEEP_ENABLED=false` for no model requests. To also run survival jobs in this mode, explicitly opt out with `AUTONOMY_REQUIRE_AI=false`.
- **Local Ollama:** Start Ollama and fetch the configured model (`ollama pull qwen3.5:4b`). It may pick survival jobs and suggest dialogue or a short sleep reflection. These requests go only to `OLLAMA_BASE_URL`, not the cloud sleep provider.
- **Cloud sleep:** Disabled by default. Set `CLOUD_SLEEP_ENABLED=true`, `CLOUD_API_KEY`, `CLOUD_PROVIDER`, `CLOUD_BASE_URL`, and `CLOUD_MODEL` for an OpenRouter, OpenAI or other HTTPS Chat Completions endpoint. It receives bounded event categories and profile metrics, not chat, names, locations, goals, or raw logs. See [Sleep pipeline](docs/SLEEP_PIPELINE.md).
- **Persistence:** `soul.md` is each bot's save file. It shows identity, personality, intentions, skills, and recent memories in readable Markdown. Its fenced checkpoint holds the full state, memories, sleep history, and audit diffs. To back up the bot, copy the whole file. The optional team board uses a separate, local SQLite file for temporary coordination, not personal memory.
- **Logs:** `LOG_PRETTY=false` emits JSON; add `LOG_LEVEL=debug` for every planning tick. Info logs contain action changes, periodic decisions, and sleep outcomes. `AUDIT_LOG_SLEEP_DIFFS=false` disables new before/after diffs in `soul.md` and logs; the sleep result itself is still recorded. Treat `soul.md`, the Microsoft auth cache, `.env`, and diagnostic logs as private.

### Import an existing save

Stop the old bot. With Node 24 LTS, run the importer and use a destination that does not exist yet:

```sh
npm run import:soul -- ./data/soulbot.sqlite ./data/imported-soul.md
```

The importer also accepts a legacy `.json` save. It preserves the identity, memories, audit history, and consolidated sleep days, leaves the source untouched, and refuses to overwrite a destination. Set `STATE_PATH=./data/imported-soul.md` in `.env`. Remove any old `STORAGE_BACKEND` setting; it is no longer used.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Repeated reconnects | Server address/version, allowlist, authentication settings, and the logged kick/error reason. Backoff is automatic. |
| Bot joins but ignores commands | Set `MC_ADMINS` and restart. Send ordinary player chat, not console `/say`, server system chat, or plugin-reformatted chat. Online-mode operator commands require a verified signature. |
| Won't follow or seek the bed | Stay within sensing range, leave a clear path, and avoid closed doors, drops, and nearby hostiles. Movement deliberately does not open, place, or break blocks. |
| Doesn't say “Morning” | The server must actually reach daytime, via its sleep vote or clock. Interrupted sleep at night does not get an immediate morning announcement. |
| Can't restore or update `soul.md` | Stop the bot. Restore the whole file from a backup if its checkpoint is damaged. If you changed the file while the bot was running, restart to reload it. |
| No sleep updates after resetting server time/world | Sleep commits deduplicate on Minecraft world-day number. After replacing a world or rewinding its clock, use a separate datastore or restore it from the matching backup. |
| Survival mode doesn't start | Check `AUTONOMY_ENABLED`, Survival game mode in the Overworld, and whether the bot is still near its saved anchor. Use `!play` to clear pause, follow or queued sleep. |
| No model advice | For survival jobs look for `source: ollama-vision` or `ollama`. If the dashboard shows `Waiting: no valid Ollama plan`, check that Ollama is running and the configured model is installed. For sleep advice check `sleep.source` and `sleep.rejections`. |

## Design docs

- [Architecture](docs/ARCHITECTURE.md)
- [State and memory](docs/STATE_MODEL.md)
- [Sleep pipeline](docs/SLEEP_PIPELINE.md)
- [Safety guardrails](docs/SAFETY_GUARDRAILS.md)
- [Live verification checklist](docs/LIVE_VERIFICATION.md)
