# Batch 14 acceptance

Verified on 2026-11-07. This batch adds **Conveyor Chef** and **Firefly Trail**. Both passed initial development, independent review and browser acceptance, bringing the accepted total to 41, Pixel Parkour included. The collection target is 50 games, and the required second independent review is still to come.

The Snowball Siege rebuild, first scheduled alongside them, was still in independent review and carries over to batch 15 with Rail Switch.

## Automated and independent evidence

All **141 focused tests pass**. Also passing are the 28 shared input, fixed-step and lifecycle regressions, and four scoped catalog checks. See:

- [game coverage](coverage.txt)
- [shared tests](shared-tests.txt)
- [catalog tests](catalog-tests.txt)
- [independent reviews](reviews.json)
- [integration checks](integration.json)

Both games were built new by separate owners and audited by separate reviewers over four rounds each.

| Game          |     Levels | Tests | Distinct mechanics and verified behavior                                                                                                                                                                                                                                                                                                    | Line coverage |
| ------------- | ---------: | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------: |
| Conveyor Chef |  22 shifts |    60 | One or two chefs put ingredients from crates onto a belt, flip junctions to steer them, chop at the board and cook on the stove before the dish burns. The belt carries finished dishes to the window. Wrong, raw or burnt dishes are rejected and cost satisfaction, and a shift ends early once its stock can no longer reach the target. |        99.96% |
| Firefly Trail | 24 meadows |    81 | A lantern draws a fading trail of light. Closing a loop, with Space or by crossing the trail, catches every firefly inside it. Moths cut the trail and sting the lantern, costing one of three lights. Later meadows refuse loops wider than the light reaches and add stalking moths and lures, all before dawn.                           |        99.08% |

Each game's quality tests include prompt-following bots at two reaction delays, crude-policy limits, determinism at 30/60/120 Hz and a scripted solution for every level. Firefly Trail's warnings cannot swap between "release" and "back away" faster than every 0.5 s. A literal prompt-follower took no stings in 1941 runs at 0 and 0.25 s reaction delay.

All review findings are closed on the recorded hashes. The remaining notes are low severity and listed in the review record: Conveyor Chef's prompt effectively solves each shift, and Firefly Trail's reviewer saw 3 lantern cuts in about 650 runs at a 0.25 s delay. Coverage supports this evidence; it does not establish that a game is bug-free. Both modules exceed the 800-line soft ceiling for source files; level data accounts for much of it.

## Browser acceptance

Acceptance used the user's stable Google Chrome through the official Claude in Chrome extension, in its own tab-group window. Held keys were sent as synthetic `keydown`/`keyup` events inside the page. Held touch buttons were sent as pointer events on the real touch buttons. Only visible DOM text and the drawn canvas were read; no game state was read or injected. The Chrome window could not be resized, so phone layouts were checked in a same-origin portrait frame on the page. See the [browser record](browser.json).

- **Conveyor Chef:** a driver that reads only the prompt and the drawn kitchen won all 22 shifts, ending at 80% satisfaction with "所有班次都完成了，这间厨房属于你！". An idle shift was lost, input on the end screens changed nothing, and Play again opened a clean shift select. In the English two-player phone layout, both chefs moved independently from their own touch buttons.
- **Firefly Trail:** on the approved build, confirmed by hashing the served file, a prompt-following driver played meadows 19 to 24 back to back and reached the win screen with no lost light. Meadow 23, the longest, took 56 s against a 110 s dawn. Idle play lost meadow 1 at dawn, input on the loss screen changed nothing, and Play again returned to meadow select. On the previous round's build, which differs only in prompt timing, a Chinese run cleared meadows 2 to 24, and English play and an English loss were checked. In the phone frame the touch buttons alone cleared meadow 1 in both languages.

One open note from Conveyor Chef's browser run: the green reach bar marks the prompted station, but Space uses whichever station is nearest. A chef standing off-centre between two crates can therefore take from the wrong one. The game follows its documented rule, so this is recorded rather than fixed. Physical devices, other browsers and audio were not tested. These checks do not replace the final independent review.

## Reproduce checks

```sh
node --experimental-test-coverage \
  --test-coverage-include='src/games/conveyor-chef.js' \
  --test-coverage-include='src/games/firefly-trail.js' \
  --test tests/conveyor-chef.test.js tests/conveyor-chef-quality.test.js \
  tests/firefly-trail.test.js tests/firefly-trail-quality.test.js
node --test tests/input.test.js tests/simulation.test.js tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|Pixel Parkour|^(conveyor|firefly)' tests/catalog.test.js
npm run check
npm run format:check
npm run build
```
