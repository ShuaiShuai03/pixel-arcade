# Batch 1 acceptance

Verified on 2026-11-05. This batch upgrades **Snowball Siege, Pinball Pocket, and Starbreaker**, plus the shared timing, input, and fullscreen behavior needed to play them. Other games are queued for their own quality passes; the collection has not yet reached the 100-game target.

## Results

All **95 focused tests pass**, plus four catalog/seeded-input checks restricted to this batch. The [coverage output](test-coverage.txt) records the exact tests and results. Static import/catalog checks, formatting, the production build, and `git diff --check` pass. Every game and the final shared-host changes received independent code review with all reported findings resolved.

| Game           | Rule and progression evidence                                                                                                                                                                                                                                                                                                                                              | Line coverage |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Snowball Siege | Six chambers completed through public input at 60/120 Hz on two seeds; independent campaigns and 10,000 sampled solver movements found no solid penetration. Constant gravity, swept solid contacts, deliberate forward kicks, harmless frozen contact, coyote time, buffered jumps, rolling friction, impact losses, and the Warden's exposed recovery window are tested. | 97.67%        |
| Pinball Pocket | Three legal launches and timed flipper input complete runs at 30/60/120 Hz. Physical rails replace lane/ramp warps; moving flippers use relative-surface restitution. Passive energy, powered bumper/motor work, fast contacts, target solidity, and flipper motion during launch travel are tested.                                                                       | 97.06%        |
| Starbreaker    | Independent public-input campaigns win on two seeds at 30/60/120 Hz. Curved paddle and brick contacts, bounded paddle/width motors, retained-position catches, wall limits, and passive energy behavior are tested. Artificial speed normalization and anti-stall boosts were removed.                                                                                     | 97.78%        |

Shared tests cover a fixed 120 Hz simulation, bounded catch-up, input edges retained until a physics tick, separate pointer ownership, keyboard activation of touch controls, stale navigation, pause/resume, restart score persistence, fullscreen fallback, and keyboard focus on fullscreen entry/exit.

## Browser evidence

Used installed stable Google Chrome through the Codex Chrome extension. Interactions used actual keyboard keys and visible controls. No game-state injection or modified campaign state was used. Saved screenshots were opened and visually inspected.

- **Snowball:** held Snow to freeze a monster; walking into it left score at zero and did not damage the player. A deliberate Kick raised the score to 100. Used movement, jump, snow, and kick through keyboard and touch controls. Cleared the first chamber and entered the second with 543 points. Inspected English desktop, Chinese landscape, and Chinese portrait layouts.
- **Pinball:** played all three balls to the Chinese game-over screen with 1,000 points. Used both keyboard and touch flippers, launch, pause, and resume. Restart restored three balls and a zero score while preserving the 1,000-point best. Retested launch/flipper input after the final fix.
- **Starbreaker:** launched, moved the paddle, used the emergency catch, and scored through real input. Verified the three-charge label in Chinese. Completed a three-ball loss and restarted with score zero and best score retained. Inspected desktop, landscape, and portrait controls.
- **Fullscreen:** checked the full-window fallback, button exit, Escape exit, navigation cleanup, and unobscured side controls in landscape. A browser-discovered focus issue was fixed and retested: Space now reaches the active game after clicking Fullscreen, and entry/exit both focus the canvas.
- Final Chrome error/warning log was empty.

The [browser record](browser.json) links the inspected screenshots. Full campaign victories are automated legal-input evidence; the browser sessions do not claim manual completion of every campaign. Viewport checks cover 1440×900, 844×390, and 390×844. Physical touch devices, browsers other than Chrome, and universal absence of bugs are not established by these checks.

## Reproduce

```sh
node --experimental-test-coverage \
  --test-coverage-include='src/games/snowball-siege.js' \
  --test-coverage-include='src/games/starbreaker.js' \
  --test-coverage-include='src/games/pinball-pocket.js' \
  --test-coverage-include='src/shared/**' \
  --test tests/snowball-siege.test.js tests/starbreaker.test.js \
  tests/pinball-pocket.test.js tests/input.test.js tests/simulation.test.js \
  tests/platform-lifecycle.test.js
npm run check
npm run format:check
npm run build
git diff --check
```
