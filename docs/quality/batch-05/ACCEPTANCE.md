# Batch 5 acceptance

Verified on 2026-11-05. This batch upgrades **River Hop, Neon Snake, and Bubble Pop**. Fifteen games have now passed their initial quality batches. The 100-game collection and the required second independent review of every game remain unfinished.

## Automated and independent evidence

All **119 focused tests pass**, plus four catalog and seeded-input checks restricted to this batch. See the [coverage output](test-coverage.txt), [independent review record](reviews.json), and [browser record](browser.json). Static import/catalog checks, formatting, the production build, and `git diff --check` pass. No shared runtime change was needed.

| Game       | Game tests | Distinct mechanics and verified behavior                                                                                                                                                                                                                                                                                                                                                      | Line coverage |
| ---------- | ---------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------: |
| River Hop  |         36 | Finite ballistic hops, inherited platform motion, full-foot landing support, swept traffic, and three crossings introducing diving turtles and a reversing cable ferry. Exact event-interval integration prevents false losses at support edges. Complete 12-rescue campaigns pass at 30/60/120 Hz, including a campaign after a real traffic loss and a separate occupied-home return route. |        99.13% |
| Neon Snake |         26 | Three gardens preserve body growth through explicit travel. Move-clock gates stay open while occupied; underpasses use adjacent cells. Buffered turns, stable Focus depletion/recovery, and visible Calm/Normal modes support controlled play. Twelve complete campaigns pass across two seeds, three frame rates, and Normal/Calm recovery scenarios.                                        |        99.63% |
| Bubble Pop |         30 | Three authored air tables introduce matching pairs, fixed anchor bolts, and hanging groups. Linear bank shots enter collision-free guided capture paths and commit a cell only on arrival. Physical drains interlock launches and stage completion; a warned powered pusher moves the rack continuously. Complete keyboard-only campaigns pass at 30/60/120 Hz, plus a pointer campaign.      |        93.97% |

The other 27 focused tests cover shared input, fixed-step timing, and platform lifecycle behavior. Reviewers checked scoring, illegal inputs, reachable losses, reset, terminal callback/freeze, and finite bounded state. Every reported actionable finding is closed. The review records identify the exact final source and test hashes.

## Browser acceptance

Used installed stable Google Chrome through the Codex Chrome extension at 1440x900, 390x844, and 844x390. All interaction used actual keys and visible controls; no gameplay state was injected. All 98 referenced screenshots were opened and inspected. Each game's final error/warning log was empty.

- **River Hop:** crossed traffic using deliberate waits and a lateral hop, landed on moving logs, waited for the next log to align, and rescued a frog into home 2 at score 530 with all four lives. The first art pass exposed instruction text covering the frog on the middle bank. The final revision moves instructions into the HUD and host status; a fresh crossing verified clear frog visibility. Final Chinese phone/landscape checks exercised every touch direction, an unsupported landing, a terminal loss, and restart. The earlier rescue evidence remains applicable because the final correction changes only rendering and status text.
- **Neon Snake:** collected all six Orchard fruit, including obstacle detours and Focus corrections, ending at score 800 and length 10. Chinese phone travel preserved that growth into Ruin Gates. Passed a gate while the occupied body held it open, reached a legitimate border loss, and restarted with length four, full Focus, Normal pace, and score zero. Every touch action and a canvas swipe were exercised on the final source.
- **Bubble Pop:** completed all three caverns in the browser at score 4790. The run used keyboard aim/fire/swap, pointer targeting, a bank shot, fixed-bolt clearance, hanging-group detachment, and recovery from a nonmatching shot. Every Chinese touch control was used, including a successful touch-fired match, and the campaign finished in landscape. A separate run showed the pressure warning, the pusher partway through its motion, and a safety-line loss after deliberate nonmatches. Restart restored the first cavern, 41 capsules, five misses available, and score zero while preserving the best score.

Full River Hop and Neon Snake victories are established by automated public-input campaigns; their browser evidence covers the progress and outcomes listed above. Physical touch devices and non-Chrome browsers were not tested. Initial acceptance does not replace the required final review after all 100 games are developed.

## Reproduce

```sh
node --experimental-test-coverage \
  --test-coverage-include='src/games/river-hop.js' \
  --test-coverage-include='src/games/neon-snake.js' \
  --test-coverage-include='src/games/bubble-pop.js' \
  --test-coverage-include='src/shared/**' \
  --test tests/river-hop.test.js tests/neon-snake.test.js \
  tests/bubble-pop.test.js tests/input.test.js tests/simulation.test.js \
  tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|^(river-hop|neon-snake|bubble-pop):' tests/catalog.test.js
npm run check
npm run format:check
npm run build
git diff --check
```
