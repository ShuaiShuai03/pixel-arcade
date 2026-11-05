# Batch 6 acceptance

Verified on 2026-11-05. This batch upgrades **Blockfall, Gem Match, and Minefield**. Eighteen games have passed their initial quality batches. The 100-game collection and its required second independent review remain unfinished.

## Automated and independent evidence

All **114 focused tests pass**: 87 game tests and 27 shared input, fixed-step, and lifecycle regressions. Four scoped catalog checks also pass. See [game coverage](coverage.txt), [shared tests](shared-tests.txt), [catalog tests](catalog-tests.txt), and [independent reviews](reviews.json). Static checks, formatting, production build, and `git diff --check` pass. Shared runtime files are unchanged.

| Game      | Tests | Distinct mechanics and verified behavior                                                                                                                                                                                                                                                                                                                                                      | Line coverage |
| --------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------: |
| Blockfall |    35 | Three districts require foundation lines, marked rubble excavation, and a four-line power clear. Fair seven-piece bags, hold, exact gravity/contact clocks, bounded lock resets, score conservation, and deterministic district retry. Nine complete campaigns cover three seeds at 30/60/120 Hz.                                                                                             |        98.51% |
| Gem Match |    25 | Gardens require score, leaf/sun collection, and positional soil restoration. Timed reversible swaps, ballistic column settling, simultaneous clearing, and explicit dead-board recovery preserve event order and resources. Independent review includes nine keyboard campaigns, three pointer campaigns, 45,658 motion samples, and seven timing comparisons.                                |        98.39% |
| Minefield |    27 | Camp, inactive quarry geometry, and ridge sector totals form a fixed-mine deduction expedition. Safe openings, atomic chords, reversible marks, sound visible-clue proofs, finite probes, and explicit travel. Independent review completed 27 campaigns without hints/probes, certified all 738 fallback openings, checked 27,465 deductions, and verified 28 navigation timing comparisons. |        98.12% |

Every actionable review finding is closed on the recorded source and test hashes. Tests cover invalid elapsed time, input boundaries, ordinary-error recovery, reachable loss, restart, terminal callback/freeze, finite state, and meaningful rendering. Coverage supports these checks; it does not establish that a game is bug-free.

## Browser acceptance

Used installed stable Google Chrome through the Codex Chrome extension at 1440x900, 390x844, and 844x390. Interactions used real keys, pointer input, and visible controls; no game state was injected. All 63 referenced screenshots were opened and inspected. Each final error/warning log was empty. See the [browser record](browser.json).

- **Blockfall:** completed all three districts at score 4845. The repair yard cleared all 32 rubble cells; a vertical I completed the final four-line clear. Exercised movement, soft/hard drop, both rotations, hold, and deterministic X retry after a misplacement. All eight Chinese touch actions worked. A separate center-stack run reached a legal top-out at 184; restart restored district one, an empty board and zero score while retaining the best score.
- **Gem Match:** completed all three gardens at score 2360. Bloom cleared at 600, Specimens at 1700, and all 12 soil cells were restored with 26 moves remaining. Exercised invalid-swap return, productive-board remix rejection, and all seven Chinese touch actions. Browser findings led to a localized key guide and visible, correctly positioned soil markers; a fresh campaign verified the final revision. Restart restored garden one and zero score.
- **Minefield:** completed Camp at 1140, Quarry at 2300, and Ridge at 3640. Corrected a deliberately wrong flag using its visible proof. An under-flagged chord was rejected; two correctly inferred flags allowed a chord to reveal an additional safe cell. All nine Chinese touch controls worked. After using every quarry probe, free deductions remained available and completed the site. Ridge renewed the probes and displayed its sector totals. Restart restored a covered Camp board and zero score; deliberately uncovering an inferable mine produced a legal loss at 530. The [visible hint trace](minefield-visible-hints.json) records decisions made from displayed text.

The Gem Match move-budget loss and dead-board recovery were tested through automated legal inputs, not separately observed in the browser. Minefield's browser campaign used explanatory hints; independent automated campaigns also solved its sites without hints or probes. Physical touch devices and other browsers were not tested. These initial checks do not replace the final independent review of all 100 games.

## Reproduce

```sh
node --experimental-test-coverage \
  --test-coverage-include='src/games/blockfall.js' \
  --test-coverage-include='src/games/gem-match.js' \
  --test-coverage-include='src/games/minefield.js' \
  --test tests/blockfall.test.js tests/blockfall-quality.test.js \
  tests/gem-match.test.js tests/gem-match-quality.test.js \
  tests/minefield.test.js tests/minefield-quality.test.js
node --test tests/input.test.js tests/simulation.test.js tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|^(blockfall|gem-match|minefield):' tests/catalog.test.js
npm run check
npm run format:check
npm run build
git diff --check
```
