# Batch 7 acceptance

Verified on 2026-11-05. This batch upgrades **Crate Keeper, Memory Grove, and Pixel Parkour**. All three passed initial development, independent review and browser acceptance, bringing the accepted total to 21. The 100-game collection and its required second independent review remain unfinished.

## Automated and independent evidence

All **192 focused checks pass**: 22 Crate Keeper tests, 28 Memory Grove tests, 100 Parkour Rust tests, 15 Parkour web tests, and 27 shared input, fixed-step and lifecycle regressions. Three scoped catalog checks also pass. See [game coverage](coverage.txt), [shared tests](shared-tests.txt), [catalog tests](catalog-tests.txt), and [independent reviews](reviews.json).

| Game          | Tests | Distinct mechanics and verified behavior                                                                                                                                                                                                                                                                                                        |         Line coverage |
| ------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------: |
| Crate Keeper  |    22 | Eight authored warehouses, animated walking and crate pushes, one buffered move, undo during motion, honest bounded hints, proven dead squares, and explicit room confirmation. Legal campaigns pass at 30/60/120 Hz. Independent review undoes and replays every step in a full campaign: 168 moves, 40 pushes, 7080 points, one terminal win. |                  100% |
| Memory Grove  |    28 | Free pairs, ordered pairs, and triples across three clearings. Exact feedback timing, a decision clock, reusable Study assistance, one-way relaxed recovery and bounded streak scoring. Nine independent keyboard campaigns observe only revealed faces and win across three seeds at 30/60/120 Hz.                                             |                99.14% |
| Pixel Parkour |   115 | Chronological contact, pickup and power expiry; continuous side recovery; momentum-preserving air tuck; real ramp/roof support; guarded banking and revive input; saturating save arithmetic. Four seeded 4000-metre legal autopilot runs, render-rate replay invariance and 612 additional independent boundary cases pass.                    | Not measured for Rust |

All findings for all three games are closed on the recorded source and test hashes. The JavaScript tests cover invalid elapsed time, input boundaries, ordinary-error recovery, restart, terminal callback/freeze, finite state and rendering. Coverage supports this evidence; it does not establish that a game is bug-free.

Parkour also passes native and WASM clippy, Rust formatting and an optimized WebAssembly rebuild. The [build receipt](parkour-build.json) records exact input and artifact hashes; the final CSS change was independently reviewed and all 15 web/provenance checks were repeated after rebuilding. Detailed logs: [Rust tests](parkour-cargo-test.txt), [web tests](parkour-wrapper-tests.txt), [native clippy](parkour-clippy-native.txt), [WASM clippy](parkour-clippy-wasm.txt), [Rust format](parkour-cargo-fmt.txt), and [final build](parkour-final-build.txt).

## Browser acceptance

Used installed stable Google Chrome through the Codex Chrome extension at 1440x900, 390x844, 844x390, 812x375, and 736x414. Interactions use actual keys, pointer input and visible controls; no game state is injected. Every referenced screenshot is opened and inspected. See the [browser record](browser.json).

- **Crate Keeper:** completed all eight warehouses at score 7080 with 168 committed moves and 40 pushes. Used hints, undid a completed room, deliberately pushed a crate onto a proven dead square, and recovered with undo and reset. All eight Chinese touch actions worked; the two-crate third room was completed entirely with touch buttons. Every room waited for explicit confirmation before committing its score. The final room remained reviewable at score 6840 until confirmed. Enter on the focused Play Again button restored warehouse one, zero score and zero moves while preserving best score 7080. Pause discarded a movement input; resume kept the keeper still. Final error/warning log empty.
- **Memory Grove:** completed Fern pairs at score 1000, Lantern ordered pairs at 2000, and the final triples at 2600. Started with a keyboard mismatch, recovered into relaxed mode, and used visible Study assistance. All seven Chinese touch actions worked. An early matching leaf pair in Lantern was rejected without progress or score; following the displayed symbol route succeeded. Two matching acorns in the last clearing did not score until the third was turned. Post-win gameplay inputs preserved the result. Restart restored Timed mode, 90 decision seconds, hidden cards and zero score while retaining the best. A separate timed run exhausted the clock through repeated legal Study use and reached a loss. Final error/warning log empty.

- **Pixel Parkour:** exercised the actual WebGL title, missions, shop, help, keyboard movement/jump/air tuck/roll, pause and repeated runs. Chinese game and wrapper controls remained synchronized. A fresh origin began with zero coins and no boards. Legal runs ended at 37, 49 and 67 metres; the 67-metre run added 17 coins and showed bank 18. A later run weaved around barriers, used two ramps and train roofs, returned to ground, collected spring shoes, and jumped with them before a legal crash at 277 metres. Its 78 coins brought the bank to 96. Changing native language also changed wrapper text and the URL. Reloading without a language query preserved English, music 5, effects 7, bank 96 and best 277. All eight wrapper controls were exercised, including the unavailable-board action. Final error/warning log empty.

The initial landscape layout left the game too small. The revised layout places movement and menu controls in side columns, with a 640-pixel playfield at the checked landscape sizes. Portrait still letterboxes the original 320x180 game and is less readable. Parkour is an endless runner, so meaningful progress and legal losses replace a terminal campaign win. Later districts, every mission, purchases and paid revives were not completed in the browser; automated tests cover those rule boundaries and long runs. Audible quality and physical touch devices were not independently measured.

Crate Keeper's browser campaign followed authored legal routes through actual player input; it has no terminal loss, so reversible dead-square recovery was checked. Memory Grove's browser campaign used relaxed recovery and visible Study assistance; independent automated campaigns also won Timed mode using only learned revealed faces. Physical touch devices and other browsers were not tested. These initial checks do not replace the final independent review of all 100 games.

## Reproduce checks

```sh
node --experimental-test-coverage \
  --test-coverage-include='src/games/crate-keeper.js' \
  --test-coverage-include='src/games/memory-grove.js' \
  --test tests/crate-keeper.test.js tests/crate-keeper-quality.test.js \
  tests/memory-grove.test.js tests/memory-grove-quality.test.js
node --test tests/input.test.js tests/simulation.test.js tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|^(crate-keeper|memory-grove):' tests/catalog.test.js
node --test tests/parkour-web.test.js
node tools/build-parkour.mjs
(cd vendor/pixel-parkour && cargo test --locked && cargo fmt --check && cargo clippy --locked --all-targets -- -D warnings && cargo clippy --locked --target wasm32-unknown-unknown -- -D warnings)
npm run check
npm run format:check
npm run build
```
