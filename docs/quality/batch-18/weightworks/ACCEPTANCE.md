# Batch 18 acceptance: Weightworks

Verified on 2026-11-09. **Weightworks** passed initial development, two rounds of independent review and browser acceptance, bringing the accepted total to 49, Pixel Parkour included. Phase Tiles, the other batch 18 game, is still in review. The collection target is 50 games, and the required second independent review is still to come.

## What it is

The player balances the beams of 24 workshop machines, with machine select and saved progress.

- Each beam has pegs at set distances from its pivot. A mass pulls with its weight times its distance, so a light mass far out can outweigh a heavy one near the pivot.
- Masses come from a tray. A machine is solved when every gate lamp is lit at the same time: some beams must hang level, others must tip left or right.
- Machines then add tilt gates, beams hanging from other beams' pegs (passing on their whole load), locked pegs, sliders that move only along their own beam, tippers that drop a mass onto another beam, and three-beam machines.
- Machines 3 to 24 have a move budget. Undo gives a move back. When the moves run out unsolved, a visible 6-second countdown asks for an undo before the machine fails.
- The arrows move the cursor, Space places or picks up a mass, X turns the tray, Z undoes and Q resets the machine. Tapping a peg selects it, and tapping again places or picks.
- A hint computed from the current state names the next move: which mass to choose, where to move and what to place.

## Automated and independent evidence

All **59 focused tests pass** with 100% line coverage across the four modules. The 28 shared input, fixed-step and lifecycle regressions and three scoped catalog checks also pass. See:

- [game coverage](coverage.txt)
- [shared tests](shared-tests.txt)
- [catalog tests](catalog-tests.txt)
- [independent review](reviews.json)
- [integration checks](integration.json)

On correctness, the reviewer's own torque model agreed with the game on 270,000 complete and 480,000 partial placements. Its own search reproduced every machine's optimum, and machines 5 to 24 have exactly one solved layout. Needles at rest always lean the way the torque says.

On play, the reviewer's followers read only the prompt in English and Chinese. They cleared every machine at 30, 60 and 120 Hz, from the start and from 2,875 scrambled states, including touch-only play, and never lost a machine. Round 1 found one false tip (machine 20), two ambiguous prompts, unbudgeted early machines and a tight loss window. Round 2 confirmed all of them fixed with no regression.

On depth:

- Idle, sweeping, random keys and mashing win nothing from machine 3 on.
- An informed random placer wins at most 3 of 100 from machine 5.
- The reviewer's strongest no-prompt bots, with free restarts, beat at most 12 of 24 machines and none of machines 14 to 24.
- Optimal move counts rise only from 1 to 8. Because undo is free, a patient exhaustive search can still solve the late machines.

The remaining notes are low severity and listed in the review record. Coverage supports this evidence; it does not establish that the game is bug-free.

## Browser acceptance

Acceptance used the user's stable Google Chrome through the official Claude in Chrome extension, in its own tab-group window. Only visible DOM text and the drawn canvas were read; no game state was read or injected. The served modules were hashed in the page and matched the approved source. See the [browser record](browser.json).

- **Chinese campaign:** a driver that follows only the status-line prompt played all 24 machines back to back in under 5 minutes. It reached the win screen with the maximum score of 2400 and never needed an undo.
- **English loss:** machine select listed all 24 machines. Spending machine 5's five moves without solving it brought up the undo prompt. With no undo, the run ended about 6.5 seconds after the last move. Input on the loss screen changed nothing, and Play again returned to machine select.
- **English phone frame:** the touch buttons alone, following the prompt, cleared machines 1 and 2. Undo and Reset worked.
- **Phone header:** at 371 px the header clips the end of the prompt, which stays in full on the canvas.

Physical devices, other browsers, tapping pegs on the canvas and audio were not tested. These checks do not replace the final independent review.

## Reproduce checks

```sh
node --experimental-test-coverage --test-coverage-include='src/games/weightworks*.js' \
  --test tests/weightworks.test.js tests/weightworks-quality.test.js
node --test tests/input.test.js tests/simulation.test.js tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|Pixel Parkour|^weightworks' tests/catalog.test.js
npm run check
npm run format:check
npm run build
```
