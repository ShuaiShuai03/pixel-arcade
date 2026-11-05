# Batch 2 acceptance

Verified on 2026-11-05. This batch upgrades **Paddle Duel, Meteor Drift, and Pixel Rally**. It also adds an explicit, opt-in touch layout for local multiplayer. Six games have now passed their initial quality batches. The 100-game collection and the required second review of all 100 games remain unfinished.

## Automated and independent evidence

All **154 focused tests pass**, plus four catalog and seeded-input checks restricted to this batch. See the [coverage output](test-coverage.txt), [independent review record](reviews.json), and [browser record](browser.json). Static import/catalog checks, formatting, production build, and `git diff --check` pass.

| Game         | Focused game tests | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Line coverage |
| ------------ | -----------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------: |
| Paddle Duel  |                 29 | Finite motor acceleration and braking; identical rendered and colliding paddle outlines; passive total-energy conservation including spin; explicit motor work; separate players; first-to-seven, win-by-two, eleven-point cap; visible non-scoring lets. Only P1 returns earn a capped bonus, banked on a completed point and discarded on a let. Public-input solo and local wins, losses, reset, and terminal freezing pass.                                                                            |        94.78% |
| Meteor Drift |                 39 | Inertial translation and rotation, finite thrusters, inherited shot velocity and recoil, chronological swept contacts, conserved material/momentum, and explicit fracture energy budgets. Internal ammunition reserves, visible charged rounds, safe spawning, and distinct asteroid materials are tested. The reviewer completed six five-sector keyboard campaigns on two seeds at 30/60/120 Hz and checked 1,500 spawn scenarios.                                                                       |        99.65% |
| Pixel Rally  |                 59 | Metres and seconds throughout, explicit km/h conversion, bounded tyre forces and side-slip, body rotation that respects solids, dissipative vehicle impacts, simultaneous traffic contact handling, safe spawning, six different road sections, and recoverable shoulders. The extended review completed 40 visibility-limited drives and checked 842 spawns without overlap. After the shoulder fix, public-input stop/recovery runs at 60/120 Hz rejoined the road and finished with full car condition. |        98.69% |

The remaining 27 focused tests cover shared input, fixed-step timing, and platform lifecycle behavior. Dedicated multiplayer touch controls retain separate pointer ownership and survive language changes and restarting. Games without an opt-in multiplayer layout retain their prior behavior. All final source and test hashes are recorded in the review and browser records.

## Browser acceptance

Used installed stable Google Chrome through the Codex Chrome extension at 1440×900, 844×390, and 390×844. Input came from actual keys and visible buttons, with no injected gameplay state. Saved screenshots were opened and inspected. Pausing was used between observations.

- **Paddle Duel:** verified W/S, arrow keys, serving, simultaneous opposing player movement, solo touch controls, and both sets of local touch controls. On the final scoring build, P1 won a local match 7–5 with 705 points. Restart returned to 0–0 and score zero while retaining best 705. English desktop and Chinese portrait/landscape layouts were checked.
- **Meteor Drift:** exercised rotation, thrust, braking, firing, charged rounds, and all six touch actions. Verified visible hull/resource feedback and stone, ice, and iron sectors. A full run on the final reviewed physics build reached sector four before a legal loss at 20,160 points. Restart restored the first sector, four rocks, full hull, 400 magazine rounds, and zero score; the prior best remained saved.
- **Pixel Rally:** verified starting at rest, gas, steering, braking, the four touch actions, and language/layout changes. Browser testing exposed a genuine shoulder stall that the initial automated drives had missed. Acceptance was withheld until it was fixed. On the corrected build, a deliberate stop at 918 m on the right gravel shoulder recovered through gas plus left steering: the car rejoined the road at about 935 m and 31 km/h, then continued past 1,260 m into the bridge section. A later collision ended the run at 1,863 points. Restart restored score zero and full car condition. The final `CAR`/`车况` label was checked in English desktop and Chinese phone views.
- The final Chrome error/warning log was empty. Full-window layouts kept the game and all action buttons visible.

Full solo campaign wins are established by automated legal-input playthroughs. Browser sessions establish the interactions and outcomes listed above, including one completed local Paddle match; they do not claim a manual win in every campaign. Physical touch devices and non-Chrome browsers were not tested. Passing this initial batch does not substitute for the required final review after all 100 games are developed.

## Reproduce

```sh
node --experimental-test-coverage \
  --test-coverage-include='src/games/paddle-duel.js' \
  --test-coverage-include='src/games/meteor-drift.js' \
  --test-coverage-include='src/games/pixel-rally.js' \
  --test-coverage-include='src/shared/**' \
  --test tests/paddle-duel.test.js tests/meteor-drift.test.js \
  tests/pixel-rally.test.js tests/input.test.js tests/simulation.test.js \
  tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|^(paddle-duel|meteor-drift|pixel-rally):' tests/catalog.test.js
npm run check
npm run format:check
npm run build
git diff --check
```
