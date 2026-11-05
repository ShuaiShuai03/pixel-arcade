# Batch 10 acceptance

Verified on 2026-11-05. This batch adds **Burrow Rescue, Raft Rush, and Shield Sentinel**. All three passed initial development, independent review and browser acceptance, bringing the accepted total to 30. The 100-game collection and its required second independent review remain unfinished.

## Automated and independent evidence

All **118 focused tests pass**, along with 27 shared input, fixed-step and lifecycle regressions and four scoped catalog checks. See [game coverage](coverage.txt), [shared tests](shared-tests.txt), [catalog tests](catalog-tests.txt), [independent reviews](reviews.json) and [integration checks](integration.json).

The queue held only three-line test stubs for Burrow Rescue and Raft Rush and nothing for Shield Sentinel, so all three games were built new by separate owners and audited by separate reviewers.

| Game            | Tests | Distinct mechanics and verified behavior                                                                                                                                                                                                                                                                                           | Line coverage |
| --------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------: |
| Burrow Rescue   |    39 | Tile digging, unbraced spans that crack with a visible countdown before collapsing, beams that split spans, oxygen that drains underground and per follower and refills at the surface or from tanks, miners that wake only when adjacent and follow only open tunnels to the lift. Event messages reach the screen-reader status. |          100% |
| Raft Rush       |    35 | Raft velocity relaxes toward the local water flow; paddle, stroke and brake forces add on top. Swept collisions against banks and rocks never tunnel or add speed. Flags count once and docks need a real stop. A prompt-only player with 0.4–0.6 s reactions must win at least 27 of 30 runs per rate.                            |          100% |
| Shield Sentinel |    44 | Only the drawn shield plates block, including their end faces; orbs reflect about the surface normal and credit damage once per target; slugs are only blocked; lances ignore the shield and are telegraphed by their true lane. Waves of armored turrets, crawlers and a Guardian whose slam breaks the shield.                   |          100% |

All review findings are closed on the recorded hashes. Coverage supports this evidence; it does not establish that a game is bug-free. Burrow Rescue (1108 lines) and Shield Sentinel (1144 lines) exceed the 800-line soft ceiling for source files.

## Browser acceptance

Final acceptance used installed stable Google Chrome 156 (headless, temporary profile), driven over the DevTools protocol at 1440x900, 390x844 and 844x390. Only trusted keyboard, mouse and touch events were dispatched. Visible DOM text and screenshots were read; no game state was read or injected, and Playwright was not used. Every referenced screenshot was opened and inspected. See the [browser record](browser.json), which also lists intermediate revisions and the findings they produced.

- **Raft Rush:** a driver that reads only the page status text and presses the key it names won all three rivers for 2400 points without hull damage. Earlier, the same driver exposed a flickering steering prompt, which was fixed. Ramming the banks broke the raft and reached the loss; both terminal screens ignored input. Touch steering worked on the Chinese portrait layout.
- **Shield Sentinel:** a driver that reads only the prompt text and canvas pixels — facing the nearest cyan or orange threat with the shield up, stepping out of red lanes, leaving the slam circle and bashing crawlers — won all three waves and the Guardian for 5725. That run found the slam circle drawn purple while every text called it red; the final build says purple in both languages. Cruder runs reached the loss screen. Multi-touch aiming and shielding worked on the Chinese portrait layout.
- **Burrow Rescue:** following the prompts on the visible mine map, the campaign was won for 9100 points with all seven miners and no lives lost. Deliberately unbraced tunnels always showed the crack countdown before collapsing; three collapses ended the run. On the final build, rescue and lift messages appeared in the page status line. Touch digging worked on the Chinese portrait layout.

Landscape fullscreen placed every game's controls in side columns. No console warnings or errors were observed. Phone layouts and touch were emulated in Chrome; physical devices, other browsers and audio quality were not tested. These checks do not replace the final independent review of all 100 games.

## Reproduce checks

```sh
node --experimental-test-coverage \
  --test-coverage-include='src/games/burrow-rescue.js' \
  --test-coverage-include='src/games/raft-rush.js' \
  --test-coverage-include='src/games/shield-sentinel.js' \
  --test tests/burrow-rescue.test.js tests/raft-rush.test.js tests/raft-rush-quality.test.js \
  tests/shield-sentinel.test.js tests/shield-sentinel-quality.test.js
node --test tests/input.test.js tests/simulation.test.js tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|^(burrow|raft|shield)' tests/catalog.test.js
npm run check
npm run format:check
npm run build
```
