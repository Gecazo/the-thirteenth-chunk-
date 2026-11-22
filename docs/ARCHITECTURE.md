# Architecture

```text
Minecraft events and world snapshots ──> ThinkLoop ──> StateEngine + STM
                                            │                    │
Player commands ──> issuer/syntax checks ───┤                    ├──> soul.md checkpoints
                                            v                    │
                                 safety gate + utility          └──> sleep pipeline + LTM
                                            │
                                  cancellable behavior
                                            │
                                   Mineflayer/pathfinder
```

- **`index.ts`** validates configuration, opens storage, restores the profile and STM, installs shutdown handling, and owns the reconnect loop. A connection has a fresh planner, timers, and abort scope. On disconnect/death/respawn the planner clears movement, cancels session work, and drops ephemeral requests. Reconnect backoff is bounded, with jitter and reset after a healthy connection.
- **`bot/`** adapts server events and Minecraft objects to typed state and perception. Perception includes time, dimension, vitals, nearby entities and players, hostiles, safe foods, dropped provisions, beds when relevant, and recent damage. Beds are cached briefly and revalidated before use. The command router has no arbitrary execution path.
- **`brain/`** updates simulated needs and emotions, scores action candidates and explains exclusion/selection, preserves continuity, and manages single-action execution. A fast safety check runs every 250 ms; decision ticks are slower and configurable. Immediate hazards can cancel active movement or consumption. Stalled paths are cleared and retried after cooldown. The optional seed controls pacing jitter, not policy or authority.
- **`behaviors/`** are fixed Minecraft operations. They receive typed targets and cancellation signals, not model output. Retreat picks loaded standable destinations with a clearance gain and tests paths before moving. Follow is bounded by sensing range; it doesn't teleport or dig to keep up. Basic gathering is limited to nearby dropped ordinary food when needed.
- **`brain/survival/`** enumerates bounded survival jobs when enabled. Live block and inventory checks unlock house construction, iron work and workshop expansion. Milestones and pending furnace work persist in an optional project checkpoint. Ollama can see the job list, structured observations and a small headless terrain image; a validated index picks one eligible job, otherwise the highest local priority wins. Execution rechecks the block, inventory, reach and placement before acting.
- **`storage/`** uses one Markdown save per instance and holds an exclusive writer lock for the session. Checkpoints atomically replace the file and occur periodically, on commands, on connection lifecycle events, and on graceful shutdown. The readable overview and versioned checkpoint are generated together. The optional legacy importer is separate from the runtime and respects the same write lock.
- **`llm/`** contains HTTP adapters, allowlisted prompts, and response schemas. Providers implement an `Advisor` interface; they have no access to Mineflayer or the datastore.

Utility is `base + need + emotion + personality + social + context − risk`. Gated actions cannot win even when their raw score is high. Ties follow the stable action order. Logs include the chosen action, active action, leading score breakdowns, and exclusions; active can differ briefly because some actions are not interrupted by routine choices.

### Extension checklist

New game actions should introduce a typed eligibility rule, bounded target selection, cancellation, capability restrictions, decision trace and tests. Never add model output as action arguments, arbitrary block interactions, or server commands. Add a checkpoint migration before changing on-disk types. A new model provider should implement the existing interface and keep validation and data minimization outside the provider.
