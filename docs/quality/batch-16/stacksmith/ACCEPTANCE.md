# Batch 16 acceptance: Stacksmith

Verified on 2026-11-07. **Stacksmith** passed initial development, five rounds of independent review and browser acceptance, bringing the accepted total to 44, Pixel Parkour included. It is released ahead of Traffic Conductor, the last batch 16 game, which is still in review. The collection target is 50 games, and the required second independent review is still to come.

## What it is

A harbour crane lowers swinging loads onto a dock to build a dashed target silhouette across 22 jobs. Each load hangs from the hook as a real damped pendulum: the arrows move the trolley, and Space releases once the swing settles. A small rigid-body engine moves the loads, which are blocks of different sizes and masses. A tower stands only while the combined centre of mass above each block rests over its support, so loads that overhang too far tip over the edge. Each goal shows a faint picture and mass label of the load it needs. Queues arrive out of order on several jobs and must be fixed with the swap key, and later jobs add wind and a rocking sea. Each job has three tries.

## Automated and independent evidence

All **72 focused tests pass** with 99.65% line coverage. The 28 shared input, fixed-step and lifecycle regressions and three scoped catalog checks also pass. See:

- [game coverage](coverage.txt)
- [shared tests](shared-tests.txt)
- [catalog tests](catalog-tests.txt)
- [independent review](reviews.json)
- [integration checks](integration.json)

The review checked the physics directly:

- No energy is gained over 400 violent random drops.
- Stacks at rest show no creep over 60 s.
- Overhangs tip at the statics boundary: 49.9% stands and 50.5% falls.
- The pendulum period is within 0.3% of theory.

On difficulty and prompt safety:

- Crude policies clear at most 5% per level from job 3 on.
- A no-prompt reader that matches each load to its pictured goal wins 10 of 22 levels at 50% or more, and only 1 of the last 8.
- A literal prompt follower with random start times loses no tries on any job at 0, 0.25 or 0.5 s reaction delay.
- A human-like timer with ±6 px aim clears the late jobs 30 of 30 times.

All findings are closed on the recorded hashes. The remaining notes are low severity and listed in the review record. Coverage supports this evidence; it does not establish that the game is bug-free. The module is about 2280 lines, over the 800-line soft ceiling, and generated level data accounts for much of it.

## Browser acceptance

Acceptance used the user's stable Google Chrome through the official Claude in Chrome extension, in its own tab-group window. Only visible DOM text and the drawn canvas were read; no game state was read or injected. The served module was hashed in the page and matched the approved source. See the [browser record](browser.json).

- A driver that follows only the prompt played all 22 jobs in English back to back and reached the win screen without losing a try, swapping loads six times on the order-trap jobs.
- In Chinese, the job select listed all 22 jobs. Blind drops lost a try with "吊载不够了" and then lost the job with "机会用完了，塔没有立住". Input on the loss screen changed nothing.
- In the Chinese phone frame, the touch buttons alone selected and cleared job 1.
- On job 21 the mass labels are readable on the faint goal pictures.

Physical devices, other browsers and audio were not tested. These checks do not replace the final independent review.

## Reproduce checks

```sh
node --experimental-test-coverage --test-coverage-include='src/games/stacksmith.js' \
  --test tests/stacksmith.test.js tests/stacksmith-quality.test.js
node --test tests/input.test.js tests/simulation.test.js tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|Pixel Parkour|^stacksmith' tests/catalog.test.js
npm run check
npm run format:check
npm run build
```
