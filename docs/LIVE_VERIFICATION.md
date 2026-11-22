# Live verification checklist

Use a disposable Minecraft Java 1.20.1 staging world and an allowlisted test player. Disable both model providers for the baseline. Use a dedicated Markdown save path and structured logs. The bot itself does not need operator status.

| Check | Expected observation |
| --- | --- |
| Login | `Minecraft bot spawned` and planner decisions in the process log |
| Follow and stop | `!follow YourName` while 8–15 blocks away on flat ground; the bot approaches. `!stop` clears the path and the bot no longer follows. |
| Eat | Supply bread, lower the staging hunger trigger if needed, and deplete food in survival mode; verify inventory decreases, food increases, and an `ate` event is saved. |
| Retreat | With the bot on open terrain, place a hostile mob nearby in the staging world. The bot selects `RETREAT_TO_SAFETY` and increases its distance, including when routine actions are paused. |
| Sleep | Place a free bed 8–12 blocks away in the Overworld, set the staging clock to a new night, and run `!sleep`. Satisfy the server's normal sleeping vote. Look for `Server confirmed bed sleep`, then `Sleep consolidation committed`, the in-game morning statement, and a result from `!memory`. |
| Continuity | Gracefully stop and restart using the same `soul.md` path. The startup identity UUID, previous intentions and memory should remain; active follow and queued sleep should not. |
| Reconnect | Disconnect only the bot or temporarily stop the staging server. Look for rejoin attempts with backoff and a new spawn when the server returns. |
| Multiple bots | Start two named instances on the same server. Address `!goal` and `!stop` to one Minecraft username. Check that only its `soul.md` changes. A second process selecting the same instance should fail with a lock error without joining. |
| Long run | Keep the final build connected for at least 30 minutes. Confirm no uncaught failures, check repeated planner heartbeats and checkpoints, and run `!status`/`!memory` near the end. Record game version, duration, and any abnormal disconnects. |

The original gameplay baseline was exercised against a private vanilla 1.20.1 server for join, follow/stop, eating, retreat, bed approach and confirmed sleep, deterministic consolidation, morning chat, memory retrieval, reconnect after a kick, and identity continuity across process restarts. The SQLite build also completed a 31-minute connected run after the intentional reconnect, with 46 logged planner decisions, no unexpected disconnects or error-level bot logs, and a clean database integrity check. The subsequent Markdown backend passed consolidation and restart integration tests; it has not had a separate 30-minute live run.

Two named Markdown instances also joined the same vanilla 1.20.1 server concurrently. The smoke test verified separate identities and saves, addressed goal/stop/status commands, rejection of a second writer before it joined, and preservation of one bot's identity and goal when restarting it while the other stayed connected.

## Autonomous survival smoke test

Use a disposable vanilla 1.21.1 Overworld. Place an empty-inventory bot on an open plot with flat sites for a home and workshop, nearby trees, and exposed stone, iron and coal. Enable autonomy, local Ollama (`qwen3.5:4b`) and vision. For a faster staging run, use `THINK_INTERVAL_MS=500` and `ACTION_TIMEOUT_MS=22000`, disable sleep and use peaceful difficulty. Run `!play` and check:

1. `Survival job selected` logs include `source: ollama-vision`.
2. The bot harvests logs, places its workbench, crafts a wooden pickaxe, mines stone, and crafts a stone pickaxe. Verify inventory and blocks on the server, not only the planning logs.
3. A 4×4 shelter with a roof and open doorway appears at the saved site.
4. The bot places its own furnace, smelts iron, and crafts an iron pickaxe. A separate roofed 3×3 workshop appears near the home when a suitable plot is available.
5. `!status` reports the latest milestone, and the Markdown checklist shows all milestones. `!stop` persists the pause. The save still has the original identity and records the project coordinates.

### Observed results

- **Empty-inventory run:** On a 16 GB M4 Mac mini with real Ollama vision advice, the bot gathered wood and stone, crafted wooden and stone pickaxes, completed the 4×4 home, placed its own furnace, smelted iron, and crafted an iron pickaxe. It placed eight workshop blocks but stalled on roof placement.
- **Resume run:** After adding an exterior step to the workshop and requiring solid footing for interaction goals, the rebuilt bot resumed in the same world with the same save and finished the workshop. The observer checked all 18 blueprint cells, including the roof and step. The `workshop` milestone was recorded once, the identity and project coordinates were unchanged, and `!stop` was still saved after clean shutdown. Ollama vision was used in both runs, with deterministic decisions in between.

The 1.21.1 observer emitted a nonfatal protocol warning but verified the blocks and sent commands successfully. The final build was tested resuming a partly built workshop, not in a single uninterrupted empty-inventory run. These checks cover progression on a prepared peaceful plot, not prolonged survival on arbitrary terrain.
