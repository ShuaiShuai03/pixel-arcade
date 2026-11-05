# Batch 9 acceptance

Verified on 2026-11-05. This batch adds **Wallrunner Relay, Clockwork Bridge, and Glider Ridge**. All three passed initial development, independent review and browser acceptance, bringing the accepted total to 27. The 100-game collection and its required second independent review remain unfinished.

## Automated and independent evidence

All **112 focused tests pass**, along with 27 shared input, fixed-step and lifecycle regressions and four scoped catalog checks. See [game coverage](coverage.txt), [shared tests](shared-tests.txt), [catalog tests](catalog-tests.txt), [independent reviews](reviews.json) and [integration checks](integration.json).

The queued drafts were stubs: Wallrunner Relay had a seven-line module, and the other two had only three-line test files. All three games were built new by separate owners and audited by separate reviewers.

| Game             | Tests | Distinct mechanics and verified behavior                                                                                                                                                                                                                                                                                                                 | Line coverage |
| ---------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------: |
| Wallrunner Relay |    33 | Wall-running only on chalk faces with real contact, momentum gained from the approach and decaying on the wall, bounded kicks once per face with short grace windows, energy spent on runs and kicks and refilled only on relay pads. Three courses: roof hops, a one-kick canyon, and slick-walled climbs. Perturbed-route and camera-visibility tests. |        99.46% |
| Clockwork Bridge |    33 | Gears drive ferries, lifts and presses through visible linkage at finite speed. Riders are carried exactly; linked groups jam instead of crushing anything. Carried keys, three machines, and an escape test from every settled gear configuration. Rate tests require identical state at 30/60/120 Hz.                                                  |        98.84% |
| Glider Ridge     |    46 | Unpowered lift, drag and stall with exact still-air energy accounting; thermals, ridge lift and lee sink as visible air motion; crosswinds; ordered gates; flare landings. A policy that reads only the on-screen prompt text must finish every ridge at 30/60/120 Hz without losing an attempt in at least 27 of 30 seeded runs.                        |        99.35% |

All review findings are closed on the recorded hashes. Coverage supports this evidence; it does not establish that a game is bug-free. Clockwork Bridge (1031 lines) and Glider Ridge (1381 lines) exceed the 800-line soft ceiling for source files.

## Browser acceptance

Final acceptance used installed stable Google Chrome 156 (headless, temporary profile), driven over the DevTools protocol at 1440x900, 390x844 and 844x390. Only trusted keyboard, mouse and touch events were dispatched. Visible DOM text and screenshots were read; no game state was read or injected, and Playwright was not used. Every referenced screenshot was opened and inspected. See the [browser record](browser.json), which also lists every failed intermediate revision.

- **Wallrunner Relay:** won all three courses for 1672 points with all four lives. Wall-run height depends on the run-up: a standing start at a tower edge clung and slid back, while a run-up from the back of the pad climbed it. The runner stayed visible below the HUD. Four deliberate falls reached the loss, and both terminal screens ignored input. Course 1 was completed entirely with Chinese touch controls on the portrait layout.
- **Clockwork Bridge:** escaped all three machines for 4100 points with all five lives. The ferry carried the player and key, a shared gear moved two mechanisms at once, and a press dropped behind the player as a lift rose. Five pit falls reached the loss. Touch took the key and turned a gear on the Chinese portrait layout.
- **Glider Ridge:** a driver that read only the page status text every 0.15 s and pressed the key it named won the campaign for 2785 points without losing an attempt, including recovery from a missed gate. Earlier revisions failed this test through mistimed flare cues, flare and stall cues that alternated, and a too-fast cue that led into a stall; each was fixed before acceptance. Holding the nose down for a whole run reached the loss. Chinese touch steering worked on the portrait layout.

Landscape fullscreen placed every game's controls in side columns. No console warnings or errors were observed. Phone layouts and touch were emulated in Chrome; physical devices, other browsers and audio quality were not tested. Glider Ridge's first course is forgiving: hands-off flight can land it. These checks do not replace the final independent review of all 100 games.

## Reproduce checks

```sh
node --experimental-test-coverage \
  --test-coverage-include='src/games/wallrunner-relay.js' \
  --test-coverage-include='src/games/clockwork-bridge.js' \
  --test-coverage-include='src/games/glider-ridge.js' \
  --test tests/wallrunner-relay.test.js tests/wallrunner-relay-quality.test.js \
  tests/clockwork-bridge.test.js tests/clockwork-bridge-quality.test.js \
  tests/glider-ridge.test.js tests/glider-ridge-quality.test.js
node --test tests/input.test.js tests/simulation.test.js tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|^(wallrunner|clockwork|glider)' tests/catalog.test.js
npm run check
npm run format:check
npm run build
```
