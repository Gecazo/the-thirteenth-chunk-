# Minecraft SoulBot — Full Build Specification (First-Pass Maximal Delivery)

## 0) Mission

Build a production-quality **Minecraft Java Edition AI bot** that appears human-like through:
- persistent identity/personality (“soul profile” simulation),
- emotions and needs,
- memory formation and retrieval,
- day/night rhythm with real sleep behavior,
- **sleep-time consolidation** that can optionally call a larger cloud model to reorganize memory/personality under strict local safety constraints.

The system must be useful on first run, not a toy scaffold. Deliver a runnable MVP+ with robust architecture, diagnostics, guardrails, and clear extension points.

## 1) Core principles (non-negotiable)

1. **No fake consciousness claims**  
   This is a simulation of human-like behavior and continuity.
2. **Deterministic control first**  
   Minecraft actions and safety are controlled by deterministic planners/behaviors, not free-form LLM output.
3. **LLM as advisor, not root authority**  
   LLM can propose dialogue, reflections, and sleep updates.  
   Local “Soul Guard” validates/clamps/rejects before state mutation.
4. **Persistent identity continuity**  
   Personality and values evolve slowly; no abrupt identity resets.
5. **Human-like pacing**  
   Add realistic delays/hesitation/idle transitions so behavior feels less robotic.
6. **Observability over magic**  
   Every significant decision must be explainable by logs and state diffs.

## 2) Tech stack requirements

- Runtime: **Node.js LTS** (20+ preferred)
- Language: **TypeScript** (strict mode)
- Minecraft bot:
  - `mineflayer`
  - `mineflayer-pathfinder`
  - `mineflayer-pvp` (scaffold if not fully used)
- Persistence:
  - **SQLite** via `better-sqlite3` (preferred)
  - JSON fallback for emergency/dev only
- Validation:
  - `zod` for schemas (required)
- Logging:
  - structured JSON logs (pino or equivalent)
- Optional local LLM:
  - **Ollama** HTTP API
- Optional cloud sleep model:
  - OpenRouter/OpenAI-compatible chat endpoint (provider abstraction required)

## 3) Deliverables (must include)

1. Full project code (not partial snippets).
2. Runnable scripts:
   - `npm run dev`
   - `npm run build`
   - `npm run start`
   - `npm run lint`
   - `npm run test` (minimum unit tests for core logic)
3. `.env.example` with all variables documented.
4. `README.md` with setup, architecture, troubleshooting, and operation guide.
5. `docs/` with:
   - `ARCHITECTURE.md`
   - `STATE_MODEL.md`
   - `SLEEP_PIPELINE.md`
   - `SAFETY_GUARDRAILS.md`
6. A first-pass “works now” bot behavior:
   - join server
   - follow player
   - eat
   - avoid danger
   - seek bed and sleep
   - run consolidation during sleep
   - morning intention statement

## 4) Required directory/file structure

```text
.
├─ src/
│  ├─ index.ts
│  ├─ config.ts
│  ├─ types/
│  │  ├─ state.ts
│  │  ├─ memory.ts
│  │  ├─ decisions.ts
│  │  ├─ llm.ts
│  │  └─ commands.ts
│  ├─ infra/
│  │  ├─ logger.ts
│  │  ├─ clock.ts
│  │  ├─ rng.ts
│  │  ├─ errors.ts
│  │  └─ shutdown.ts
│  ├─ storage/
│  │  ├─ sqlite.ts
│  │  ├─ repositories/
│  │  │  ├─ stateRepo.ts
│  │  │  ├─ memoryRepo.ts
│  │  │  ├─ socialRepo.ts
│  │  │  ├─ sleepRepo.ts
│  │  │  └─ auditRepo.ts
│  │  └─ migrations/
│  │     └─ 001_init.sql
│  ├─ bot/
│  │  ├─ minecraftClient.ts
│  │  ├─ perception.ts
│  │  ├─ commandRouter.ts
│  │  └─ reconnect.ts
│  ├─ brain/
│  │  ├─ stateEngine.ts
│  │  ├─ thinkLoop.ts
│  │  ├─ decisionEngine.ts
│  │  ├─ utilityScoring.ts
│  │  ├─ interruptionPolicy.ts
│  │  ├─ personality.ts
│  │  ├─ emotions.ts
│  │  ├─ needs.ts
│  │  ├─ socialModel.ts
│  │  ├─ intentionPlanner.ts
│  │  ├─ dialogue.ts
│  │  ├─ memory/
│  │  │  ├─ shortTermMemory.ts
│  │  │  ├─ longTermMemory.ts
│  │  │  ├─ retrieval.ts
│  │  │  └─ salience.ts
│  │  ├─ sleep/
│  │  │  ├─ sleepTrigger.ts
│  │  │  ├─ sleepConsolidation.ts
│  │  │  ├─ cloudSleepAdvisor.ts
│  │  │  ├─ soulGuard.ts
│  │  │  ├─ driftLimiter.ts
│  │  │  └─ morningRoutine.ts
│  │  └─ policies/
│  │     ├─ safetyGate.ts
│  │     ├─ ethicsPolicy.ts
│  │     └─ actionBudget.ts
│  ├─ behaviors/
│  │  ├─ followPlayer.ts
│  │  ├─ stopBehavior.ts
│  │  ├─ eatIfHungry.ts
│  │  ├─ gatherBasic.ts
│  │  ├─ safetyBehavior.ts
│  │  ├─ findBedAndSleep.ts
│  │  ├─ idleHumanizer.ts
│  │  └─ recoverFromStuck.ts
│  ├─ llm/
│  │  ├─ localOllamaClient.ts
│  │  ├─ cloudClient.ts
│  │  ├─ providerRouter.ts
│  │  ├─ prompts/
│  │  │  ├─ dialoguePrompt.ts
│  │  │  ├─ reflectionPrompt.ts
│  │  │  └─ sleepIntegratorPrompt.ts
│  │  └─ schemas.ts
│  └─ tests/
│     ├─ decisionEngine.test.ts
│     ├─ soulGuard.test.ts
│     ├─ sleepConsolidation.test.ts
│     └─ memorySalience.test.ts
├─ docs/
│  ├─ ARCHITECTURE.md
│  ├─ STATE_MODEL.md
│  ├─ SLEEP_PIPELINE.md
│  └─ SAFETY_GUARDRAILS.md
├─ .env.example
├─ package.json
├─ tsconfig.json
├─ README.md
└─ AGENT_TASK_MINECRAFT_SOULBOT.md
5) State model (strict typing required)
Implement AgentState with full schema validation and clamping.
- include identity, vitals, personality, values, social, goals, circadian, runtime
- clamp ranges on every update
- auto-heal invalid persisted state to defaults with warning log
6) Memory architecture
- STM ring buffer (default 300)
- LTM: episodic summaries, semantic beliefs, social memory, preferences, danger map
- retrieval by recency + salience + overlap + emotional congruence
7) Perception system
Each think tick gather world time, vitals, inventory summary, nearby entities/hostiles, bed availability, last damage source, nearby players; emit normalized PerceptionFrame.
8) Decision system (utility-based)
Candidate actions: FOLLOW_PLAYER, EAT, GATHER_BASIC, RETREAT_TO_SAFETY, SEEK_BED, SLEEP, IDLE_SOCIAL, PAUSE_AND_REFLECT, STOP.
Score formula:
score = baseWeight + needPressure + emotionModifier + personalityModifier + socialModifier + contextBonus - riskPenalty
Include reason trace and top candidates in logs.
9) Emotions + Needs
- event-driven emotion changes with baseline decay
- needs update continuously (energy, hungerNeed, safety, loneliness, sleepDebt)
- thresholds drive action pressure
10) Sleep pipeline (critical)
1. collect day events from STM
2. salience scoring
3. local summary
4. optional cloud advisory
5. Soul Guard validate/clamp/reject
6. apply updates to LTM/state
7. audit diff
8. morning intentions + reflection
Default drift limits:
- trait ±0.02/sleep
- trust ±0.05/player/sleep
- value ±0.01/sleep (if not locked)
- intentions <= 3
11) LLM strategy
- Local Ollama: dialogue/reflection/local summarization
- Cloud optional: sleep-time deep reorganization proposals only
- Local deterministic control remains authoritative
12) Soul Guard (required)
Reject mutation if:
- schema invalid
- ranges invalid
- drift too large
- locked core values changed
- unsafe directives detected
- contradictory state transition
Fallback to deterministic consolidation on reject.
13) Commands
!status, !follow <player>, !stop, !sleep, !memory, !trust <player>, !goal <text>, !debugstate, !rethink
14) Required .env.example
MC_HOST=localhost
MC_PORT=25565
MC_USERNAME=SoulBot
MC_VERSION=1.20.1
MC_AUTH=offline

THINK_INTERVAL_MS=3000
ACTION_TIMEOUT_MS=15000
PERCEPTION_RADIUS=24

HUNGER_TRIGGER=65
SAFETY_TRIGGER=35
SLEEP_TRIGGER=60

ENABLE_SLEEP=true
MAX_TRAIT_DRIFT_PER_SLEEP=0.02
MAX_TRUST_DELTA_PER_SLEEP=0.05
MAX_VALUE_DELTA_PER_SLEEP=0.01
ALLOW_CORE_VALUE_CHANGE=false

LOCAL_LLM_ENABLED=true
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b-instruct
OLLAMA_TIMEOUT_MS=30000

CLOUD_SLEEP_ENABLED=false
CLOUD_PROVIDER=openrouter
CLOUD_BASE_URL=https://openrouter.ai/api/v1
CLOUD_MODEL=openai/gpt-4.1
CLOUD_API_KEY=

LOG_LEVEL=info
LOG_PRETTY=true
AUDIT_LOG_SLEEP_DIFFS=true
15) Reliability + safety
- reconnect with backoff
- graceful shutdown with state save
- startup state recovery
- LLM timeout/retry/fallback
- no hardcoded secrets
- admin command allowlist
- anti-toxic chat filter
- anti-grief default policy
16) Tests
Minimum unit tests:
- decision scoring
- emotion transitions
- drift clamping
- Soul Guard rejects
- state invariants
- memory salience ordering
Include one sleep pipeline integration test with mocked LLM.
17) Acceptance criteria
 1. stable run >30 min
 2. follows player/eats/retreats from danger
 3. sleeps at night
 4. writes sleep memory + next-day intentions
 5. cloud output always gated by Soul Guard
 6. deterministic fallback when LLM unavailable
 7. useful command outputs
 8. explainable logs for decisions
 9. continuity across restart
10. modular typed codebase, no monolithic file
