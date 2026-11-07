# Batch 17 acceptance: Circuit Weaver

Verified on 2026-11-07. **Circuit Weaver** passed initial development, five rounds of independent review and browser acceptance, bringing the accepted total to 47, Pixel Parkour included. Tide Lock, the last batch 17 game, is still in development. The collection target is 50 games, and the required second independent review is still to come.

## What it is

The player turns etched copper tiles on 24 circuit boards, with board select and saved progress.

- Straights, corners, tees, crosses and bridges connect only where both neighbours expose a port on the shared edge.
- Each lamp lights only when its network carries its own voltage. Two voltages meeting is a short, which blocks the win.
- On sealed boards, an open end is a leak that also blocks the win. Unfed decorative wires never count.
- Locked tiles cannot turn. Fifteen boards limit the number of turns, and running out blows one of three fuses and resets the board.
- The arrows move a cursor, Space turns, X inspects a network and Z undoes. Tapping a tile selects it, and tapping again turns it.
- A hint computed from the current state names the next tile and how many turns it needs.

## Automated and independent evidence

All **64 focused tests pass** with 100% line coverage across the four modules. The 28 shared input, fixed-step and lifecycle regressions and three scoped catalog checks also pass. See:

- [game coverage](coverage.txt)
- [shared tests](shared-tests.txt)
- [catalog tests](catalog-tests.txt)
- [independent review](reviews.json)
- [integration checks](integration.json)

On correctness, the reviewer's own connectivity model agreed with the game on 96,000 states. Its own solver reproduced the optimum of every board.

On depth, the review drove several rounds of board redesign. The final numbers:

- Informed random and mash solve at most 10% per board from board 3.
- A port-pair hill-climber solves at least half its runs only on tutorial boards 1–9 and board 12. On boards 17–24 it stays at 12% or below.
- A hill-climber that tries a turn and undoes it wins at most 13% on boards 17–24.

Shorts are a real risk on six open boards, where one wrong turn joins two voltages. Prompt followers in English and Chinese, per frame and pressing exactly the stated number of turns, cleared every board from the start and from scrambles with no blown fuse.

All findings are closed on the recorded hashes. The remaining notes are low severity and listed in the review record. Coverage supports this evidence; it does not establish that the game is bug-free.

## Browser acceptance

Acceptance used the user's stable Google Chrome through the official Claude in Chrome extension, in its own tab-group window. Only visible DOM text and the drawn canvas were read; no game state was read or injected. The served modules were hashed in the page and matched the approved source. See the [browser record](browser.json).

- A driver that follows only the status-line prompt played all 24 boards in English back to back. It reached the win screen with the maximum score of 3840 and blew no fuse.
- In Chinese, the board select listed all 24 boards. Spending board 10's turn budget three times blew all three fuses and ended the run. Input on the loss screen changed nothing, and Play again returned to board select.
- In the Chinese phone frame, the touch buttons alone selected and cleared boards 1 to 3. The Undo and Inspect buttons worked.
- At 390 px, the clipped header keeps the prompt's verb and key visible after the board tip. The full prompt is always drawn on the canvas.

Physical devices, other browsers, tapping tiles on the canvas and audio were not tested. These checks do not replace the final independent review.

## Reproduce checks

```sh
node --experimental-test-coverage --test-coverage-include='src/games/circuit-weaver*.js' \
  --test tests/circuit-weaver.test.js tests/circuit-weaver-quality.test.js
node --test tests/input.test.js tests/simulation.test.js tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|Pixel Parkour|^circuit' tests/catalog.test.js
npm run check
npm run format:check
npm run build
```
