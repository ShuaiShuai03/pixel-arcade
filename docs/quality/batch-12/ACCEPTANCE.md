# Batch 12 acceptance

Verified on 2026-11-05. This batch adds **Magnet Marauder, Echo Hunter and Frost Forge**. **Mimic Vault**, scheduled for batch 13, finished development, review and browser acceptance during this batch, so it is released here. All four passed initial development, independent review and browser acceptance, bringing the accepted total to 37. The collection target is now 50 games, and the required second independent review is still to come.

During this batch the user added a rule: level-based games need at least 20 levels. All four games meet it, with level select and saved progress through the host's new `env.progress` interface. Older level-based games are listed for expansion in [LEVEL-RETROFIT.md](../LEVEL-RETROFIT.md).

## Automated and independent evidence

All **303 focused tests pass**. Also passing are the 28 shared input, fixed-step and lifecycle regressions, including the new saved-progress test, and five scoped catalog checks. See:

- [game coverage](coverage.txt)
- [shared tests](shared-tests.txt)
- [catalog tests](catalog-tests.txt)
- [independent reviews](reviews.json)
- [integration checks](integration.json)

All four games were built new by separate owners and audited by separate reviewers.

| Game            |       Levels | Tests | Distinct mechanics and verified behavior                                                                                                                                                                                                                                  | Line coverage |
| --------------- | -----------: | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------: |
| Magnet Marauder |  25 chambers |    94 | Hold Space to pull loose metal into orbit, then lock onto an enemy and throw one piece with X. Armored enemies only crack under fast metal, enemies wind up before striking machinery, and your own fast metal damages machines too.                                      |          100% |
| Echo Hunter     |   20 caverns |    82 | Sonar pings from a limited per-cavern budget leave fading outlines of where beetles were; the net only catches a located target. Pings are loud: crawlers rush to them and a full Noise meter rouses the cave.                                                            |        99.49% |
| Frost Forge     | 22 workshops |    88 | Engine parts are installed only inside their printed temperature window. Furnace, chiller and warm-plate pads drive Newton cooling, held parts burn or freeze your gloves, X cycles torch and frost spray and thaws frozen sockets, and the engine seizes at -30 degrees. |        99.67% |
| Mimic Vault     |     22 rooms |    39 | Record a short walk, then send a solid translucent echo to replay exactly those key presses so it can hold pressure plates while you slip past. Hold, timed and two-plate doors build the puzzles.                                                                        |        99.68% |

Each game's quality tests include prompt-following bots at 0.15–0.35 s and 0.4–0.6 s reaction delays, plus crude-policy limits, determinism at 30/60/120 Hz and a scripted solution for every level.

All review findings are closed on the recorded hashes, except two minor open items:

- Echo Hunter's cavern chooser is not announced in the status line.
- Magnet Marauder's chamber chooser has the same gap.

Coverage supports this evidence; it does not establish that a game is bug-free. All four modules (1261–2347 lines) exceed the 800-line soft ceiling for source files; level data accounts for much of it.

## Browser acceptance

Final acceptance used installed stable Google Chrome 156/157 (headless, temporary profile), driven over the DevTools protocol at 1440x900, 390x844 and 844x390. Magnet Marauder's tap, language, phone and select checks also ran in the Claude desktop app's built-in browser at 375x812. Only trusted keyboard, mouse and touch events were sent. Visible DOM text and screenshots were read; no game state was read or injected, and Playwright was not used.

Later levels were opened by writing the host's own saved-progress preference, which is what a returning player has. Every referenced screenshot was opened and inspected. See the [browser record](browser.json).

- **Magnet Marauder:** a driver that reads only the prompt and the drawn canvas cleared chambers 1 to 16 in one continuous run, then won chamber 25 on the first attempt for 2180. Idle play lost to wrecked machinery, the loss screen ignored input, and Play again restarted cleanly. In the Chinese phone layout, the touch buttons chose and started chamber 24. The chamber select screen showed no overlapping text in either language.
- **Echo Hunter:** a driver that reads the drawn walls and follows the prompt cleared caverns 1–3. On cavern 20 it recovered three of five beacon beetles before crawlers ended the run, and the loss screen froze input.
- **Frost Forge:** workshop 1 was repaired from a fresh start, and workshop 8 after choosing it in the select screen. Workshop 16 and an idle workshop 1 both reached the engine-seize loss, with input frozen afterwards.
- **Mimic Vault:** a prompt-following driver won all 22 rooms for 5400, and the win screen froze input.

Every game passed Chinese portrait touch play and landscape fullscreen with the controls in side columns. No console warnings or errors were observed.

Phone layouts and touch were emulated in Chrome; physical devices, other browsers and audio quality were not tested. These checks do not replace the final independent review.

## Reproduce checks

```sh
node --experimental-test-coverage \
  --test-coverage-include='src/games/magnet-marauder.js' \
  --test-coverage-include='src/games/echo-hunter.js' \
  --test-coverage-include='src/games/frost-forge.js' \
  --test-coverage-include='src/games/mimic-vault.js' \
  --test tests/magnet-marauder.test.js tests/magnet-marauder-quality.test.js \
  tests/echo-hunter.test.js tests/echo-hunter-quality.test.js \
  tests/frost-forge.test.js tests/frost-forge-quality.test.js \
  tests/mimic-vault.test.js tests/mimic-vault-quality.test.js
node --test tests/input.test.js tests/simulation.test.js tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|^(magnet|echo|frost|mimic)' tests/catalog.test.js
npm run check
npm run format:check
npm run build
```
