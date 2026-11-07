# Batch 16 acceptance: Traffic Conductor

Verified on 2026-11-07. **Traffic Conductor** passed initial development, four rounds of independent review and browser acceptance, bringing the accepted total to 45, Pixel Parkour included. It completes batch 16. The collection target is 50 games, and the required second independent review is still to come.

## What it is

The player runs the signals of 20 busy junctions. Cars, buses and trucks arrive from every road with their turn indicators showing.

- The arrows select a junction, and Space moves its signal to the next phase. Every change passes through yellow and a short all-red, so conflicting greens cannot happen.
- X calls a pedestrian phase.
- A vehicle enters only on green and only when its conflict zones are clear. Long vehicles start slowly, and permissive left turns wait for gaps.
- Each shift has a quota and a clock. Broken wait limits, spilled queues and gridlock are strikes, each explained on screen, and the third strike ends the shift.
- Later shifts add protected turns, school crossings, bus priority, surges, ambulances and two linked junctions.
- Arrival schedules are drawn at random and checked at load by a prompt follower at 30, 60 and 120 Hz.

## Automated and independent evidence

All **69 focused tests pass** with 99.74% line coverage. The 28 shared input, fixed-step and lifecycle regressions and three scoped catalog checks also pass. See:

- [game coverage](coverage.txt)
- [shared tests](shared-tests.txt)
- [catalog tests](catalog-tests.txt)
- [independent review](reviews.json)
- [integration checks](integration.json)

On signal safety, the review fuzzed 2400 follower runs with noise and ran further overlap and frame-rate checks. It found no vehicle entering on red, no overlap in the junction, no pedestrian crossing on green and no contradictory greens.

On difficulty and prompt safety:

- 24 crude policies clear at most 25% per level from shift 3 at n=40. Idle play never wins.
- A tuned fixed-time plan that never reads the road clears 50% or more on only 3 of 18 levels, and on none of shifts 14 to 20.
- A literal prompt follower cleared 2400 of 2400 runs at 0, 0.25 and 0.5 s reaction delay.
- A skilled player who never reads the prompt wins at least 50% on every level from shift 3. Shifts 6 and 13 sit exactly at 50%.
- The prompt controller now runs on simulation steps, so its advice is the same at 30, 60 and 120 Hz.

All findings are closed on the recorded hashes. The remaining notes are low severity and listed in the review record. Coverage supports this evidence; it does not establish that the game is bug-free. The module is about 2720 lines, over the 800-line soft ceiling.

## Browser acceptance

Acceptance used the user's stable Google Chrome through the official Claude in Chrome extension, in its own tab-group window. Only visible DOM text and the drawn canvas were read; no game state was read or injected. The served module was hashed in the page and matched the approved source. See the [browser record](browser.json).

- A driver that follows only the prompt played all 20 shifts in English back to back. It reached the win screen without taking a strike.
- In Chinese, the shift select listed all 20 shifts. Idling on shift 3 took a strike and then lost to a held-up ambulance, with the cause shown on the canvas and the end screen. Input on the loss screen changed nothing.
- In the Chinese phone frame, the touch buttons alone selected and cleared shift 1. R during a shift and Play again both returned to shift select.

Physical devices, other browsers, tapping junctions on the canvas and audio were not tested. These checks do not replace the final independent review.

## Reproduce checks

```sh
node --experimental-test-coverage \
  --test-coverage-include='src/games/traffic-conductor.js' \
  --test tests/traffic-conductor.test.js tests/traffic-conductor-quality.test.js
node --test tests/input.test.js tests/simulation.test.js tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|Pixel Parkour|^traffic' tests/catalog.test.js
npm run check
npm run format:check
npm run build
```
