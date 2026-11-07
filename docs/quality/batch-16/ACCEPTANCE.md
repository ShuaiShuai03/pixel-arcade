# Batch 16 acceptance (Snowball Siege rebuild)

Verified on 2026-11-07. This release replaces the batch 1 **Snowball Siege** with a rebuilt, original one- or two-player snow platformer. It passed development, ten rounds of independent review and browser acceptance. The accepted total stays at 43, Pixel Parkour included, because Snowball Siege was already counted. Stacksmith and Traffic Conductor, the other batch 16 games, are still in development.

## What changed

The rebuild was requested to give the game proper physics, enemies that can be snowed into balls and rolled into chains, bosses, and same-screen co-op for two players. It uses none of another game's names, characters, art or stage layouts.

- 30 single-screen floors with level select and saved progress, and bosses on floors 10, 20 and 30.
- Four hits pack an enemy into a snowball, and a half-coated enemy thaws. Walking into a snowball rolls it: it defeats what it touches, bounces off walls and sets other balls rolling for chain bonuses.
- One-way planks to jump up through, and Down + Jump to drop through them.
- Fruit, power-ups and a letter bonus. An Ember Wraith hunts players who linger.
- Two players share the screen with their own keys, lives and touch layout, and the catalog now lists the game for 1–2 players.
- A contextual bilingual prompt names the next action and a direction: walk under, jump, throw, push, step back, step off, and dodge incoming fire.

## Automated and independent evidence

All **114 focused tests pass** with 99.76% line coverage. The 28 shared input, fixed-step and lifecycle regressions and three scoped catalog checks also pass. See:

- [game coverage](coverage.txt)
- [shared tests](shared-tests.txt)
- [catalog tests](catalog-tests.txt)
- [independent review](reviews.json)
- [integration checks](integration.json)

The review covered physics first, then prompt safety and depth. After the last round, a literal prompt follower that dodges when told to clears every non-boss floor at least 18 times in 20 at 0 and 0.25 s reaction delay, within the lives-lost bars. Crude bots clear at most 15% on the sampled floors at n=40. Floor 9's blind pulse rate is 29 in 100, above the 25% flag but under the 50% gate. Fast and slow bots clear the boss floors (30/30/29 and 27/30/29).

All blocking findings are closed on the recorded hashes, and the remaining notes are low severity and listed in the review record. Coverage supports this evidence; it does not establish that the game is bug-free. The module is about 3300 lines, over the 800-line soft ceiling.

## Browser acceptance

Acceptance used the user's stable Google Chrome through the official Claude in Chrome extension, in its own tab-group window. Held keys were synthetic in-page events, and touch buttons and floor taps were pointer events. Only visible DOM text and the drawn canvas were read; no game state was read or injected. The served module was hashed in the page and matched the approved source. See the [browser record](browser.json).

- A driver that follows only the prompt cleared floors 1 to 9 back to back in English, losing one life on floor 6 and earning it back. In another run on the same build it beat the floor 10 Kiln Golem, then ran out of lives early on floor 11. The loss screen read "Out of lives on floor 11", and input on it changed nothing.
- In two-player co-op, each player's keys moved only their own hero, and the HUD showed both players' lives.
- In the Chinese phone frame, the touch buttons moved the floor cursor, tapping floor 1 started it, and the touch buttons cleared floor 1. One Down + Jump drop used the keyboard Jump, because a second synthetic touch cannot be captured.
- An earlier acceptance pass found the floor 9 imp-fire blocker that the last review round fixed.

Floors 11 to 30 and the later bosses were not played in the browser. They are covered by the reviewed bot and follower sweeps. Real multi-touch, physical devices, other browsers and audio were not tested. Two low notes are recorded rather than fixed: the floor-select prompt mentions Space even on touch, where tapping a floor starts it, and prompts name keyboard keys on the touch layout. These checks do not replace the final independent review.

## Reproduce checks

```sh
node --experimental-test-coverage \
  --test-coverage-include='src/games/snowball-siege.js' \
  --test tests/snowball-siege.test.js tests/snowball-siege-quality.test.js
node --test tests/input.test.js tests/simulation.test.js tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|Pixel Parkour|^snowball' tests/catalog.test.js
npm run check
npm run format:check
npm run build
```
