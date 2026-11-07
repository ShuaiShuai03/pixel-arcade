# Batch 17 acceptance: Mirror Lab

Verified on 2026-11-07. **Mirror Lab** passed initial development, two rounds of independent review and browser acceptance, bringing the accepted total to 46, Pixel Parkour included. It is released ahead of Circuit Weaver and Tide Lock, the other batch 17 games, which are still in development. The collection target is 50 games, and the required second independent review is still to come.

## What it is

A laser fires across a dark optical bench in 22 rooms with level select and saved progress.

- The arrows move a cursor and Space turns the mirror or splitter under it. X flips a shutter, Z undoes and Q resets the room. Tapping a cell selects it, and tapping again turns it.
- Walls and closed shutters stop the beam, and splitters send out a second beam. Crystals must stay dark.
- Some rooms light sensors only in number order. Eight rooms allow only one or two turns more than the optimum.
- The beam is traced exactly, and loops end when a cell, direction and sensor progress repeat.
- Rooms 1 to 5 teach the parts. From room 6 on, every room has 9 to 12 live switches and exactly one solved setting.
- A hint computed by a solver from the current state names the next switch and how far to move. A highlight marks the target.

## Automated and independent evidence

All **64 focused tests pass** with 100% line coverage. The 28 shared input, fixed-step and lifecycle regressions and three scoped catalog checks also pass. See:

- [game coverage](coverage.txt)
- [shared tests](shared-tests.txt)
- [catalog tests](catalog-tests.txt)
- [independent review](reviews.json)
- [integration checks](integration.json)

On correctness, the reviewer's independent tracer and solver agreed with the game on every switch setting of all 22 rooms and on 8,180 fuzzed traces.

The first review round found that a prompt such as "Move cursor → 3" counted the whole path rather than the arrow's leg, and that most rooms could be won by random turning. After the fix:

- A follower that presses each named arrow exactly the stated number of times clears every room.
- Followers at 0, 0.25 and 0.5 s reaction delay clear every room from the start and from 330 scrambles.
- From room 6, an informed random turner wins at most 5 of 40 per room.
- A beam-aware greedy wins at most 20% of runs on any room at 300 s, and none of rooms 16 to 22.
- A random walk with undo wins at most 10 of 40 at 300 s.
- A systematic human brute force would take several minutes even on the smallest later rooms.

All findings are closed on the recorded hashes. The remaining notes are low severity and listed in the review record. Coverage supports this evidence; it does not establish that the game is bug-free. The main module is 957 lines, over the 800-line soft ceiling, plus 279 lines of room data.

## Browser acceptance

Acceptance used the user's stable Google Chrome through the official Claude in Chrome extension, in its own tab-group window. Only visible DOM text and the drawn canvas were read; no game state was read or injected. The served modules were hashed in the page and matched the approved source. See the [browser record](browser.json).

- A driver that follows only the prompt played all 22 rooms in Chinese back to back. It reached the win screen with the maximum score of 2200, which means every room was solved in its optimal number of turns.
- In English, the room select listed all 22 rooms. Spending every turn on budget room 13 lost the run with "Out of turns in room 13", and input on the loss screen changed nothing. Play again returned to room select.
- In the English phone frame, the touch buttons alone selected and cleared rooms 1 to 3. The Undo and Reset touch buttons worked.

Physical devices, other browsers, tapping cells on the canvas and audio were not tested. These checks do not replace the final independent review.

## Reproduce checks

```sh
node --experimental-test-coverage --test-coverage-include='src/games/mirror-lab*.js' \
  --test tests/mirror-lab.test.js tests/mirror-lab-quality.test.js
node --test tests/input.test.js tests/simulation.test.js tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|Pixel Parkour|^mirror' tests/catalog.test.js
npm run check
npm run format:check
npm run build
```
