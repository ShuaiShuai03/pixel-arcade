# Release acceptance

This document records the initial release baseline. For subsequent game changes and their current verification evidence, see the [quality batch schedule](quality/BATCHES.md).

Verified on 2026-11-05. This release contains 20 original browser games and the Pixel Parkour WebAssembly integration. The original `pixel_parkour` repository remains a separate, unchanged project.

## Automated gameplay verification

**172 JavaScript tests passed**, with **98.29% line coverage** and **95.69% branch coverage** across game modules and shared input/platform utilities. The [test output](acceptance/test-coverage.txt) records the complete result.

`npm run test:coverage` covers the catalog, game rules, legal playthroughs, deterministic mixed input, both languages, and shared input/persistence/lifecycle behavior. Every game is instantiated in English and Chinese, rendered, and exercised with seeded keyboard and pointer input. Tests assert finite game state, one terminal callback, frozen terminal state, and fresh restarts.

| Game           | Completion and rule evidence                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Snowball Siege | Legal movement and throws clear all three towers; platform landing, freezing, rolling snowballs, timer and damage.                   |
| Ember Knights  | Legal attacks resolve a best-of-three match; both players move, jump, block, and spend stamina.                                      |
| Bomb Garden    | Legal planting, escape and navigation clear three gardens; blast blocking, crates, safe spawns, local duel controls.                 |
| Iron Bastion   | Legal three-wave victories, including seed 18 terrain-overlap recovery; safe player positions stay unchanged.                        |
| Sky Raiders    | Legal piloting clears three sectors and carriers; limited pulse bombs, movement bounds, damage and restart.                          |
| Neon Snake     | Legal turns collect all 18 fruit over three gardens on two seeds; wall, body and obstacle collisions.                                |
| Starbreaker    | Legal pointer play clears all three brick fields on two seeds; brick faces, durability, paddle, lives and upgrades.                  |
| Orbit Invaders | Legal movement and fire clear four formations on two seeds; shields, descent, projectiles and health.                                |
| River Hop      | Timed legal hops fill all homes in three rounds without losing a life; traffic, logs, water and timer.                               |
| Meteor Drift   | Legal flight and fire clear five sectors on two seeds; splitting, respawn, and matching rendering/collisions at all wrapped corners. |
| Blockfall      | Legal rotations, movement and drops clear 30 lines; walls, overlap, row clearing and top-out.                                        |
| Gem Match      | Legal pointer swaps complete all gardens; productive boards, invalid swaps, matches, cascades and move exhaustion.                   |
| Crate Keeper   | All eight warehouses have verified legal solutions; walls, pushing, undo, touch buttons and useful hints.                            |
| Minefield      | Safe first reveal, flood fill, flags, chording, legal safe-tile completion and mine loss.                                            |
| Memory Grove   | All three decks complete through card input; mismatch, peek cost, timeout, and last-second stage completion.                         |
| Pixel Rally    | Legal steering reaches the finish; collisions, coins, braking and off-road timeout prevent bypassing the race.                       |
| Paddle Duel    | Legal solo play wins a seven-point match; local P2 control, aimed bounces, serve and opponent victory.                               |
| Pinball Pocket | Three real launches drain correctly; flippers sustain finite play, bumpers and rollovers score.                                      |
| Dungeon Dash   | Legal movement and attacks clear five rooms; reachable keys/exits, walls, guardians and terminal conditions.                         |
| Bubble Pop     | Real aim, fire and swap input clears the cavern; clusters, disconnected drops, bounces and overflow.                                 |

Shared host regressions cover best scores surviving keyboard/button restart, translated end results, immediate pause status, resume, released inputs on blur, bounded frame deltas, stale navigation, and hiding solo touch controls in multiplayer.

Pixel Parkour additionally passes its 68 Rust tests, Rust formatting, native and WebAssembly Clippy checks, and JavaScript tests against the actual shipped WebAssembly imports. Artifact provenance and SHA-256 hashes are in `public/parkour/build-info.json`.

## Browser verification

Used installed stable Google Chrome through the Codex Chrome extension. No page-state injection or game cheats were used for the browser journeys. [The twenty-game record](acceptance/browser-games.json) records actual start/input/playing checks; [screenshots](acceptance/screenshots/) show the rendered games.

- Opened every catalog entry, started each game, exercised its documented keyboard controls, and captured its active canvas.
- Checked desktop, tablet, and phone layouts at 1440, 1024, 768, and 390 pixel viewport widths, including Chinese layouts.
- Checked category filtering, the three-game two-player filter, Chinese search, navigation back to the shelf, and random selection.
- Exercised both players in Ember Knights, Bomb Garden, and Paddle Duel. Verified that solo touch controls remain hidden in two-player mode, including pause/resume and language changes.
- Tapped Minefield on the phone-sized viewport; a safe reveal changed the score from 0 to 80. The best score stayed 80 through keyboard restart and a page reload, with Chinese retained.
- Verified game pause/resume, restart, loss feedback, language changes, and saved best scores. No game errors or warnings were present in the final Chrome console check.
- Loaded the real Pixel Parkour title, began a run, used jump/roll/lane controls, and paused. Switching English/Chinese preserved the run. Native Settings changed the wrapper language and URL; reloading without a language query used the saved preference. Chinese phone-sized controls and text rendered correctly.

Screenshots and browser checks demonstrate representative interaction and rendering. Full campaign completions are exercised by the automated legal-input tests; the browser checks do not claim that every campaign was manually completed. Physical mobile devices and browsers other than Chrome were not tested.

The final Parkour check also verified desktop and phone-sized fullscreen fallback, visible movement/menu controls, localized Exit labels, button exit, Escape exit, and one-press re-entry through native Settings after either exit path. Native fullscreen requests were denied in the automated Chrome environment, so its fallback was exercised directly; the native path is covered by the wrapper tests.

## Reproduce locally

```sh
npm ci
npm run test:coverage
npm run check
npm run format:check
npm run build
npm run dev
```

For the Rust port checks and rebuild instructions, see [PARKOUR.md](PARKOUR.md).
