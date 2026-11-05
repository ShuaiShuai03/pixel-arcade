# Batch 8 acceptance

Verified on 2026-11-05. This batch adds **Lantern Climber, Gravity Courier, and Grapnel Gorge**. All three passed initial development, independent review and browser acceptance, bringing the accepted total to 24. The 100-game collection and its required second independent review remain unfinished.

## Automated and independent evidence

All **106 focused tests pass**, along with 27 shared input, fixed-step and lifecycle regressions and four scoped catalog checks. See [game coverage](coverage.txt), [shared tests](shared-tests.txt), [catalog tests](catalog-tests.txt), [independent reviews](reviews.json) and [integration checks](integration.json).

| Game            | Tests | Distinct mechanics and verified behavior                                                                                                                                                                                                                                                                                                                       | Line coverage |
| --------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------: |
| Lantern Climber |    25 | Three authored summits: teaching stairs, moving cable decks with inherited launch velocity, and a required handrail climb. Finite ground and air forces, swept solid contacts, walk-off grace, grip stamina that recovers only at supported rest, lamp fuel and reveal range, brazier relighting and checkpoint recovery. Legal campaigns win at 30/60/120 Hz. |        97.36% |
| Gravity Courier |    33 | A powered field reverses acceleration, never momentum. Thrusters and drag, chronological swept contacts, impact-speed parcel damage, explicit X pickup, handoff and repacking, three chambers with alternating bulkheads and marked field-strength zones. Displayed coast forecasts match released-control physics in 410 independent cases.                   |        98.52% |
| Grapnel Gorge   |    48 | Unilateral constant-length rope at 240 Hz with inelastic capture, ballistic release, explicit winch and anchor work kept separate from numerical residual, ground-only walking, visible rock occlusion that blocks hooks and cuts rope, and three routes ending with motor-driven anchors. Nine independent public campaigns win across rates and insets.      |        97.52% |

All review findings are closed on the recorded hashes. Coverage supports this evidence; it does not establish that a game is bug-free.

Grapnel Gorge's final source (`4a2565aa`) differs from the independently approved source (`507ac73d`) only by a parent copy fix found in the browser: the English status line read "1 lives". Reversing that single expression reproduces the approved hash exactly, and all 48 Grapnel tests pass on the final file.

## Browser acceptance

The Codex Chrome extension used for earlier batches and Claude in Chrome were both unavailable in the continuation session. Final acceptance therefore used installed stable Google Chrome 156 (headless, temporary profile), driven over the DevTools protocol at 1440x900, 390x844 and 844x390. Only trusted keyboard, mouse and touch events were dispatched. Visible DOM text and screenshots were read; no game state was read or injected, and Playwright was not used. Every referenced screenshot was opened and inspected. See the [browser record](browser.json).

- **Lantern Climber:** won the full campaign for 1800 points, lighting all three summits. Braziers refilled the lamp, cable decks carried the climber, and the required rail was climbed with Grip and exited with a directional jump while Grip was still held. Two real falls each cost a life and returned the climber to the summit-2 brazier with the score unchanged. Pausing while gripping preserved stamina and the climbing state. Lamp exhaustion alone reached the loss at about 270 seconds; gameplay keys left the loss screen unchanged, and R restarted with the best score kept. In Chinese at 390x844, all seven touch controls fit, touch Refill restored the lamp and touch jumps scored. Landscape fullscreen places the controls in side columns.
- **Gravity Courier:** the full campaign, recovery, loss and layout checks on the preceding revision `3b7ceefc` remain valid, because the final delta only reorders the docking cue. On the final source, braking airborne toward the ceiling pad shows "Brake before rail contact / brake first, field into rail after contact". The courier then touched the rail softly, flipped the field into it and delivered intact for 480 points.
- **Grapnel Gorge:** won all three routes for 1700 points with four of five lives. Landing markers ended in a cross over gaps and a check over safe stone, and every release on a check landed safely. Anchor 2 became selectable after a small step on the middle cairn. Walking off the narrow cairn cost one life. Five Z rescues reached the explicit loss, and the loss screen ignored further input. In Chinese at 390x844, all eight touch controls fit; touch hook, reel and release worked and collected the optional relic. Landscape fullscreen places the controls in side columns.

No console warnings or errors were observed during the driven sessions. The shared host clears held input on every pause and resume; physical keys return through keyboard auto-repeat, while the protocol driver re-pressed them. After a win, Space activates the focused Play Again button, so terminal freezes were checked with non-activating keys. Phone layouts and touch were emulated in Chrome; physical devices, other browsers and audio quality were not tested. These checks do not replace the final independent review of all 100 games.

## Reproduce checks

```sh
node --experimental-test-coverage \
  --test-coverage-include='src/games/lantern-climber.js' \
  --test-coverage-include='src/games/gravity-courier.js' \
  --test-coverage-include='src/games/grapnel-gorge.js' \
  --test tests/lantern-climber.test.js tests/lantern-climber-quality.test.js \
  tests/gravity-courier.test.js tests/grapnel-gorge.test.js tests/grapnel-gorge-quality.test.js
node --test tests/input.test.js tests/simulation.test.js tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|^(lantern-climber|gravity-courier|grapnel-gorge):' tests/catalog.test.js
npm run check
npm run format:check
npm run build
```
