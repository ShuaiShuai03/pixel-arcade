# Batch 17 acceptance: Tide Lock

Verified on 2026-11-09. **Tide Lock** passed initial development, seven rounds of independent review and browser acceptance, bringing the accepted total to 48, Pixel Parkour included. It completes batch 17. The collection target is 50 games, and the required second independent review is still to come.

## What it is

The player sails cargo boats to their docks through 22 canal locks, with lock select and saved progress.

- Water only runs downhill through an open valve, at a speed set by the height difference. A wide chamber drops less than a narrow one for the same volume.
- A gate opens only when the water on both sides is level. A boat sails through only if both sides are at least as deep as its draught.
- Later locks add a tidal sea, drains, pumps, a reservoir that holds just enough water, and two boats that pass each other.
- A boat left aground for three seconds loses a hull, and again every three seconds until it floats. Three hulls are the whole fleet.
- Left and Right pick a valve, X picks a gate, Space opens or closes the selection and Enter resets the lock. Once water is moving, Enter must be pressed twice. Tapping a valve or gate selects it, and a second tap operates it.
- The line at the top always names the next move, from a planner that searches the current water levels. A yellow mark shows the level to wait for. When a boat cannot be saved, the line asks for the reset.

## Automated and independent evidence

All **73 focused tests pass**, with 98.98% line coverage across the five modules. The 28 shared input, fixed-step and lifecycle regressions and three scoped catalog checks also pass. See:

- [game coverage](coverage.txt)
- [shared tests](shared-tests.txt)
- [catalog tests](catalog-tests.txt)
- [independent review](reviews.json)
- [integration checks](integration.json)

The final reviewer drove the game with its own followers and oracle:

- **Mistakes:** prompt followers cleared 1998 of 1998 runs with mistakes at the start and 1600 of 1600 with mistakes mid-play, at 30, 60 and 120 Hz with two reaction delays. No fleet was lost.
- **Idle start:** after waiting up to 60 seconds before the first move, followers cleared all 616 runs with no hull lost.
- **Rescues:** no "stranded" prompt appeared while a one- or two-control rescue existed. The rescue line never reversed the player's last move in 486 runs.
- **Depth:** blind, mashing and sweeping play wins no lock from lock 3. Random play wins at most 13 of 100 runs, on locks 3 to 5. An 8-second look-ahead bot wins 10 of 22 locks, and none from lock 15.

Earlier rounds closed GC pauses from the planner's search, emergency frame spikes, watch-only ruin prompts, rescue reversals, two over-easy late locks and a tide that could ground a waiting boat.

On frame time, replaying each case three times put the worst per-frame work at 3.6 ms at 30 Hz. Three reruns of the three worst cases found no frame over 16 ms; the worst was 14.0 ms, during a major GC. Single 22–50 ms spikes seen only while other sessions loaded the machine were not traced. The reviewer attributes them to GC and contention by inference, not proof.

Open notes, all within the agreed limits:

- About 0.7% of "stuck" prompts fall on a state the oracle can still solve, when the search runs while a gate is still open.
- The "No hint after a long search" reset offer often falls on solvable states. It claims no ruin, and taking it costs only time.
- On lock 17, a boat can lose a hull without warning while a plan still leads home.
- A lock-11 comment and idle skip in the quality test are stale.
- `tide-lock.js` is above the 800-line guideline.

The full list is in the review record. Coverage supports this evidence; it does not establish that the game is bug-free.

## Browser acceptance

Acceptance used the user's stable Google Chrome through the official Claude in Chrome extension, in its own tab-group window. Only visible DOM text and the drawn canvas were read; no game state was read or injected. The served modules were hashed in the page and matched the approved source. See the [browser record](browser.json).

- **English campaign:** a driver that follows only the status line played all 22 locks back to back in 29 minutes. It reached the win screen with a score of 11,361. It never needed a reset, and no hull was lost.
- **Chinese loss:** the lock select listed all 22 locks, and two taps on the canvas entered lock 4. Draining the chamber under the boat showed the rescue line, then the stranded prompt. Ignoring both lost all three hulls and ended the run. Input on the loss screen changed nothing, and Play again returned to lock select.
- **Chinese phone frame:** real taps on the touch buttons alone, following the prompt, cleared locks 1 and 2. On lock 3 the Valve+ button moved the selection, and two taps on Reset reset a lock with water moving. The header fits at 371 px.

Physical devices, other browsers, the English phone header and audio were not tested. These checks do not replace the final independent review.

## Reproduce checks

```sh
node --experimental-test-coverage --test-coverage-include='src/games/tide-lock*.js' \
  --test tests/tide-lock.test.js tests/tide-lock-quality.test.js
node --test tests/input.test.js tests/simulation.test.js tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|Pixel Parkour|^tide' tests/catalog.test.js
npm run check
npm run format:check
npm run build
```
