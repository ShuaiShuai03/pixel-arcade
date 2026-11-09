# Batch 18 acceptance: Phase Tiles

Verified on 2026-11-09. **Phase Tiles** passed initial development, two rounds of independent review and browser acceptance, bringing the accepted total to 50, Pixel Parkour included. It completes batch 18 and the collection's 50-game target. The required second independent review of every game is still to come.

## What it is

The player matches glowing tiles on 26 woven boards to a small target card, with board select and saved progress.

- Each tile shows a phase. Pressing a tile moves every tile in its influence shape one phase on, wrapping around at the end. The shape is previewed under the cursor before the press.
- Boards 1 to 3 teach the plus shape. Later boards add holes, locked tiles that cannot be pressed but still change, diagonal, ring, line and knight shapes, tiles that carry their own shape icon, and three phases.
- Boards 4 to 26 have a press budget, with one spare press from board 7. Undo gives a press back. When the presses run out unmatched, an 8-second countdown on the canvas asks for an undo before the board fails.
- The arrows move the cursor, Space presses, Z undoes and Q resets the board. Tapping a tile selects it, and tapping again presses it.
- A hint computed from the current state, by elimination over the press counts, names the next tile on a shortest way home, or asks for an undo when the budget can no longer be met.

## Automated and independent evidence

All **70 focused tests pass** with 100% line coverage across the four modules. The 28 shared input, fixed-step and lifecycle regressions and three scoped catalog checks also pass. See:

- [game coverage](coverage.txt)
- [shared tests](shared-tests.txt)
- [catalog tests](catalog-tests.txt)
- [independent review](reviews.json)
- [integration checks](integration.json)

On correctness, the reviewer's own model and solver matched every board's influence sets, start, target, optimum and budget. Breadth-first search agreed on the small boards. Every cell was pressed through the game, and each press changed exactly the previewed set.

On play, the reviewer's followers read only the prompt in English and Chinese:

- They cleared every board at 30, 60 and 120 Hz, by keys, bursts and touch, from the start and from 1,872 mistaken states.
- Slow followers (3 and 6 s per action) never lost a board.
- Over 20,800 frames, the undo prompt appeared exactly when the budget could no longer be met.

On depth, round 1 found that a no-prompt bot looking three presses ahead, with free restarts, beat about 15 boards. The boards were regenerated as denser scrambles with tighter budgets. Now:

- Bots looking two and three presses ahead win nothing from board 3 on.
- Random and informed random presses win at most 2 of 40, on board 3 only.
- A hill-climber with restarts wins only boards 1, 2, 4, 6 and 11.

Open notes, all within the agreed limits:

- An exhaustive four-press look-ahead (hundreds of thousands of sequences per decision) still wins several boards in small samples, including boards 20, 22 and 25. No human-plausible strategy was found that does.
- Optimal press counts rise from 1 to 14, but bot success does not rise evenly across the late boards.

The full list is in the review record. Coverage supports this evidence; it does not establish that the game is bug-free.

## Browser acceptance

Acceptance used the user's stable Google Chrome through the official Claude in Chrome extension, in its own tab-group window. Only visible DOM text and the drawn canvas were read; no game state was read or injected. The served modules were hashed in the page and matched the approved source. See the [browser record](browser.json).

- **English campaign:** a driver that follows only the status-line prompt played all 26 boards back to back in under 7 minutes. It reached the win screen with the maximum score of 2600 and never needed an undo.
- **Chinese loss:** board select listed all 26 boards. Wasting board 8's presses brought up the undo prompt and the canvas countdown. With no undo, the run ended 8 seconds after the last press. Input on the loss screen changed nothing, and Play again returned to board select.
- **Chinese phone frame:** the touch buttons alone, following the prompt, cleared boards 1 and 2. Undo took back a wrong press, and Reset restored a board.

Physical devices, other browsers, the English phone header and audio were not tested. These checks do not replace the final independent review.

## Reproduce checks

```sh
node --experimental-test-coverage --test-coverage-include='src/games/phase-tiles*.js' \
  --test tests/phase-tiles.test.js tests/phase-tiles-quality.test.js
node --test tests/input.test.js tests/simulation.test.js tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|Pixel Parkour|^phase' tests/catalog.test.js
npm run check
npm run format:check
npm run build
```
