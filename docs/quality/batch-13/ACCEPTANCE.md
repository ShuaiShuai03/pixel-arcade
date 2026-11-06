# Batch 13 acceptance

Verified on 2026-11-06. This batch adds **Orbit Gardener** and **Comet Catcher**, and lists **Pixel Parkour** first on the game shelf. Both new games passed initial development, independent review and browser acceptance, bringing the accepted total to 39, Pixel Parkour included. The collection target is 50 games, and the required second independent review is still to come.

Mimic Vault, first scheduled for this batch, was accepted early and released with batch 12.

## Automated and independent evidence

All **115 focused tests pass**. Also passing are the 28 shared input, fixed-step and lifecycle regressions, and five scoped catalog checks, including the new featured-listing test. See:

- [game coverage](coverage.txt)
- [shared tests](shared-tests.txt)
- [catalog tests](catalog-tests.txt)
- [independent reviews](reviews.json)
- [integration checks](integration.json)

Both games were built new by separate owners and audited by separate reviewers.

| Game           |       Levels | Tests | Distinct mechanics and verified behavior                                                                                                                                                                                                                                                        | Line coverage |
| -------------- | -----------: | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------: |
| Orbit Gardener |   24 gardens |    60 | A ship moves along concentric orbits around a gem planet only while an orbit key is held, and changes ring only at gates. Seeds are collected in flight and planted by holding Space while stopped on a bed of the matching colour and shape. Debris and the nightfall clock end careless runs. |          100% |
| Comet Catcher  | 22 contracts |    55 | Move and tilt a rooftop net to catch falling comets. A catch needs a matching tilt and a slow enough impact, or the comet bounces off. Hot comets must cool before unloading with X at the right bin, and the net has a limited capacity.                                                       |          100% |

Each game's quality tests include prompt-following bots at 0.15–0.35 s and 0.4–0.6 s reaction delays, crude-policy limits, determinism at 30/60/120 Hz and a scripted solution for every level.

All review findings are closed on the recorded hashes. Coverage supports this evidence; it does not establish that a game is bug-free. Both modules (1332–1531 lines) exceed the 800-line soft ceiling for source files; level data accounts for much of it.

## Pixel Parkour on the shelf

Pixel Parkour, the standalone WebAssembly game already shipped under `public/parkour/`, now appears as the first card in the game list, with a picture taken from its own gameplay. The card opens `public/parkour/index.html` with the shelf's current language. Its game code is unchanged.

## Browser acceptance

Acceptance used the user's stable Google Chrome through the official Claude in Chrome extension, in its own tab-group window. An earlier pass for Comet Catcher used headless Chrome over the DevTools protocol, before the user's browser rule ruled that out. Held keys were sent as synthetic `keydown`/`keyup` events inside the page. Held touch buttons were sent as pointer events on the real touch buttons; taps, clicks, Start, language and full-window buttons were real mouse clicks. Only visible DOM text and the drawn canvas were read; no game state was read or injected.

The Chrome window could not be resized, so phone layouts were checked in a 390x844 portrait frame and an 844x390 landscape frame. Later levels were opened by writing the host's own saved-progress preference, which is what a returning player has. Every referenced screenshot was opened and inspected. See the [browser record](browser.json).

- **Orbit Gardener:** a prompt-following driver won all 24 gardens back to back with hull 3 for 15400. Idle play lost garden 1 with "Night fell on garden 1 before it was restored.", and input on the loss screen changed nothing. In the Chinese portrait layout, the touch buttons alone restored garden 1. The loss screen then offered Play again, which restarted cleanly.
- **Comet Catcher:** a driver that reads only the prompt and the drawn canvas won contract 22 for 260 ("Every contract is fulfilled. The sky is safe!"). An earlier run cleared contracts 1–3 back to back, and headless runs went from contract 12 to 13. Idle play lost in Chinese ("天文台的尝试次数用完了"), with input frozen afterwards. In the Chinese landscape full-window layout, the controls sat in side columns, and holding the right-hand touch button moved the net.
- **Pixel Parkour:** it is the first card, the count shows 39 games, and clicking the card opened the Chinese title menu with no console errors.

The only console exception came from the test itself: a fake touch with no real pointer behind it made `setPointerCapture` throw, and touches with a real pointer id worked. Physical devices, other browsers and audio were not tested. These checks do not replace the final independent review.

## Reproduce checks

```sh
node --experimental-test-coverage \
  --test-coverage-include='src/games/orbit-gardener.js' \
  --test-coverage-include='src/games/comet-catcher.js' \
  --test tests/orbit-gardener.test.js tests/orbit-gardener-quality.test.js \
  tests/comet-catcher.test.js tests/comet-catcher-quality.test.js
node --test tests/input.test.js tests/simulation.test.js tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|Pixel Parkour|^(orbit|comet)' tests/catalog.test.js
npm run check
npm run format:check
npm run build
```
