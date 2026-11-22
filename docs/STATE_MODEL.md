# State and memory

`types/state.ts` is the versioned Zod schema and TypeScript source of truth. `StateEngine` returns detached snapshots, protects identity, clamps valid numeric updates, and rejects malformed transitions. On startup it keeps valid sections where possible, clamps outlying numeric values, and logs schema paths requiring recovery. A corrupt or unsupported Markdown checkpoint fails closed rather than silently starting over.

| Group | Fields and invariants |
| --- | --- |
| `identity` | UUID, initial name, creation time, fixed persona; preserved across restart |
| `vitals` | Real Minecraft health and food, `0..20` |
| `personality` | Curiosity, sociability, caution and patience, `0..1`; sleep-limited drift |
| `values` | Kindness, prudence, helpfulness, `0..1`; kindness and prudence always locked |
| `emotions` | Joy, fear, curiosity and calm, `0..1`; event deltas and time decay to baseline |
| `needs` | Energy, hunger pressure, perceived safety, loneliness, sleep debt, `0..100` |
| `social` | Up to 100 case-insensitive unique player snapshots with last-seen time and simulated trust, `0..1` |
| `goals` | Optional local operator note and up to three distinct typed intentions |
| `circadian` | Minecraft day and tick-of-day, observed bed state, last consolidated day |
| `project` | Optional saved work anchor, home/workshop sites, stations, pending iron smelt, and validated milestones |
| `runtime` | Pause, follow/sleep requests, last action and update timestamp; pause persists, active requests don't |

**STM** is a checkpointed ring (300 events by default). It records typed events and affect; raw player chat is not retained. Danger events can include a coarse 16-block location cell for the local danger map. **LTM** stores up to 2,000 entries across episodic summaries, semantic lessons, social activity, preferences, and danger cells. The profile's social entries store per-player continuity. Episode ranking uses age, salience, topical overlap and emotional congruence. LTM is used by `!memory`; the danger map records observations rather than controlling movement, which always uses current perception.

Survival milestones are historical achievements, not assumptions about current inventory or blocks. They are checked against server observations and recorded once in the project checklist, with a typed event for sleep consolidation. Existing Markdown saves still load without the new optional fields.

`soul.md` holds a readable overview followed by a versioned fenced JSON checkpoint with `state`, `events`, `memories`, `sleeps` (one record per world day), and `audit`. The file is the only save. The overview is generated; it is not parsed as instructions or source data. Sleep changes are written together by atomic file replacement before the new snapshot becomes active. With the default checkpoint cadence, a hard kill can lose about 20 seconds of recent, uncommitted events; sleep commits and operator writes save immediately.
