# Batch 11 acceptance

Verified on 2026-11-05. This batch adds **Dash Duelist, Tether Twins, and Vine Warden**. All three passed initial development, independent review and browser acceptance, bringing the accepted total to 33. The 100-game collection and its required second independent review remain unfinished.

## Automated and independent evidence

All **152 focused tests pass**, along with 27 shared input, fixed-step and lifecycle regressions and four scoped catalog checks. See [game coverage](coverage.txt), [shared tests](shared-tests.txt), [catalog tests](catalog-tests.txt), [independent reviews](reviews.json) and [integration checks](integration.json).

None of the three games had queued files, so all three were built new by separate owners and audited by separate reviewers.

| Game         | Tests | Distinct mechanics and verified behavior                                                                                                                                                                                                                                                                                                                    | Line coverage |
| ------------ | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------: |
| Dash Duelist |    62 | Three rivals whose attacks commit to a drawn telegraph that matches the true hit area. Recovery windows are the only time strikes land. Dash charges give exactly 0.3 s of invulnerability. Heavy magenta attacks cost 3 HP and cannot be walked out of, so a sidestep-only player loses while a player who dashes when needed wins in both reaction bands. |        99.05% |
| Tether Twins |    46 | Two robots share a fixed-length insulated cable that wraps wall corners and posts, never stretches or crosses a wall, and is shared symmetrically. Plates, gates, tension relays and a winch drive three rooms; live strips zap robots. Solo switches the active robot with X; co-op controls both.                                                         |          100% |
| Vine Warden  |    44 | Seeds grow for 6 s before roots can hold pests; each bloom has four bites and harvesting returns seeds. Weevils route around live roots by a visible rule, bare lanes are marked, and unused blooms are flagged. A prompt-following casual player with 0.4–0.6 s reactions must win the whole campaign in at least 24 of 30 runs per rate.                  |          100% |

All review findings are closed on the recorded hashes. Coverage supports this evidence; it does not establish that a game is bug-free. All three modules (1151–1157 lines) exceed the 800-line soft ceiling for source files.

## Browser acceptance

Final acceptance used installed stable Google Chrome 156 (headless, temporary profile), driven over the DevTools protocol at 1440x900, 390x844 and 844x390. Only trusted keyboard, mouse and touch events were dispatched. Visible DOM text and screenshots were read; no game state was read or injected, and Playwright was not used. Every referenced screenshot was opened and inspected. See the [browser record](browser.json), which also lists intermediate revisions and the findings they produced.

- **Dash Duelist:** a driver that reads only the prompt text and canvas pixels — sidestepping normal telegraphs, running out of rings, dashing late into heavy telegraphs and striking during openings — won all three rivals for 3050 without taking a hit. An earlier run dodged heavy ring sweeps with the dash and then lost to a mistimed dash. Touch dashing worked on the Chinese portrait layout.
- **Tether Twins:** following the prompts and route markers solo, all three rooms were won for 5650 without losing a cell, including wrapping the cable on a post to light a plate inside a live ring and latching a relay by reeling the cable taut. Reeling alone showed the pay-out prompt. Three deliberate zaps reached the loss with corrected copy. Two-player mode moved both robots at once, and touch switching worked on the Chinese portrait layout. Earlier browser runs found two copy errors and a live strip on the natural route; all were fixed.
- **Vine Warden:** planting beside the path, patrolling and harvesting when prompted won all three plots for 4200 with four of five health. Earlier browser runs lost plots 2 and 3 with sensible play, which led to the weevil routing change, an easier third plot and the bare-lane and idle-bloom cues. Touch planting worked on the Chinese portrait layout.

Landscape fullscreen placed every game's controls in side columns, and every terminal screen ignored gameplay input. No console warnings or errors were observed. Phone layouts and touch were emulated in Chrome; physical devices, other browsers and audio quality were not tested. These checks do not replace the final independent review of all 100 games.

## Reproduce checks

```sh
node --experimental-test-coverage \
  --test-coverage-include='src/games/dash-duelist.js' \
  --test-coverage-include='src/games/vine-warden.js' \
  --test-coverage-include='src/games/tether-twins.js' \
  --test tests/dash-duelist.test.js tests/dash-duelist-quality.test.js \
  tests/vine-warden.test.js tests/vine-warden-quality.test.js \
  tests/tether-twins.test.js tests/tether-twins-quality.test.js
node --test tests/input.test.js tests/simulation.test.js tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|^(dash|vine|tether)' tests/catalog.test.js
npm run check
npm run format:check
npm run build
```
