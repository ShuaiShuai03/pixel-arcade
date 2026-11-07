# Batch 15 acceptance

Verified on 2026-11-07. This batch adds **Rail Switch** and **Tilt Lab**. Both passed initial development, independent review and browser acceptance, bringing the accepted total to 43, Pixel Parkour included. The collection target is 50 games, and the required second independent review is still to come.

The Snowball Siege rebuild, scheduled alongside them, is still in independent review and carries over to batch 16 with Stacksmith and Traffic Conductor.

## Automated and independent evidence

All **150 focused tests pass**. Also passing are the 28 shared input, fixed-step and lifecycle regressions, and four scoped catalog checks. See:

- [game coverage](coverage.txt)
- [shared tests](shared-tests.txt)
- [catalog tests](catalog-tests.txt)
- [independent reviews](reviews.json)
- [integration checks](integration.json)

Both games were built new by separate owners and audited by separate reviewers.

| Game        |        Levels | Tests | Distinct mechanics and verified behavior                                                                                                                                                                                                                                                                                                                                       | Line coverage |
| ----------- | ------------: | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------: |
| Rail Switch | 20 timetables |    79 | Trains with coloured cargo leave portals on a timetable, and the player selects and flips junctions so each one reaches its own platform. A wrong platform, a head-on, crossing or rear-end crash, or a train left looping for two minutes is a strike, and the cause is shown. Later yards add loops, passing sidings, timed signals and express trains that catch slow ones. |        99.63% |
| Tilt Lab    |       22 labs |    71 | The player tilts the whole board to roll a glass marble around holes into a goal socket, where it must settle. Acceleration follows the tilt, contact is swept and never adds energy, and plates, timed gates, one-way flaps, moving blocks, ice and sand change how it rolls.                                                                                                 |        99.95% |

Each game's quality tests include prompt-following bots at two reaction delays, crude-policy limits, determinism at 30/60/120 Hz and a scripted solution for every level. In Rail Switch, a no-prompt shortest-route bot wins none of timetables 10 to 20. Every run's small timetable variation is checked at load, so a perfect follower took no strikes in 3000 audited runs. In Tilt Lab, random tilting clears no lab above 25% after the first tutorial lab, and a literal follower half a second late lost no marbles.

All review findings are closed on the recorded hashes. The remaining notes are low severity and listed in the review record. Coverage supports this evidence; it does not establish that a game is bug-free. Both modules exceed the 800-line soft ceiling for source files; level data accounts for much of it.

## Browser acceptance

Acceptance used the user's stable Google Chrome through the official Claude in Chrome extension, in its own tab-group window. Held keys were sent as synthetic `keydown`/`keyup` events inside the page. Held touch buttons were sent as pointer events on the real touch buttons. Only visible DOM text and the drawn canvas were read; no game state was read or injected. The Chrome window could not be resized, so phone layouts were checked in a same-origin portrait frame on the page. The served module was hashed in the page before each final run. See the [browser record](browser.json).

- **Rail Switch:** a driver that reads only the prompt ran all 20 timetables in English back to back and reached the win screen without a strike of its own. In Chinese, an idle timetable was lost with the strike cause on screen, input on the loss screen changed nothing, and Play again opened level select. In the Chinese phone frame, the touch buttons alone cleared timetable 1. The final build's loss screen shows Spare 0 rather than the -1 that acceptance first found.
- **Tilt Lab:** a driver that reads only the prompt played all 22 labs in Chinese back to back and reached the win screen without losing a marble, with the plate-charging and wait-for-the-block prompts on screen. In English, blind tilting ran out of lives, input on the loss screen changed nothing, and Play again opened level select. The final build's loss banner reads "Out of lives" rather than the "Lab cleared!" that acceptance first found. In the English phone frame, the touch buttons alone cleared lab 1.

The full-campaign runs used builds that differ from the final ones only by those two small text fixes, which were reviewed and rechecked in Chrome. Physical devices, other browsers and audio were not tested. These checks do not replace the final independent review.

## Reproduce checks

```sh
node --experimental-test-coverage \
  --test-coverage-include='src/games/rail-switch.js' \
  --test-coverage-include='src/games/tilt-lab.js' \
  --test tests/rail-switch.test.js tests/rail-switch-quality.test.js \
  tests/tilt-lab.test.js tests/tilt-lab-quality.test.js
node --test tests/input.test.js tests/simulation.test.js tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|Pixel Parkour|^(rail|tilt)' tests/catalog.test.js
npm run check
npm run format:check
npm run build
```
