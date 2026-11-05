# Batch 4 acceptance

Verified on 2026-11-05. This batch upgrades **Sky Raiders, Iron Bastion, and Orbit Invaders**. Twelve games have now passed their initial quality batches. The 100-game collection and the required second independent review of every game remain unfinished.

## Automated and independent evidence

All **130 focused tests pass**, plus four catalog and seeded-input checks restricted to this batch. See the [coverage output](test-coverage.txt), [independent review record](reviews.json), and [browser record](browser.json). Static import/catalog checks, formatting, production build, and `git diff --check` pass. No shared runtime change was needed for this batch.

| Game           | Game tests | Distinct mechanics and verified behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                | Line coverage |
| -------------- | ---------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------: |
| Sky Raiders    |         43 | Six sectors and carrier encounters, finite flight acceleration, weapon heat, recoverable upgrades, and limited expanding interception charges. One event queue orders hull impacts, projectiles, pickups, destroyed parts, and expiration. Persistent contacts handle later third-body impulses; launch and absorption account for mass and momentum. Six complete public-input campaigns pass across two seeds at 30/60/120 Hz, including recovery after spending all initial charges. |        99.46% |
| Iron Bastion   |         25 | Vehicle mass and traction, independently aimed turret, finite ammunition, destructible brick and solid steel, a vulnerable beacon, repairs, and three authored battlefields. Engineer transitions rearm the tank and preserve its position and access. Six keyboard campaigns pass at 30/60/120 Hz, including deliberate damage and repair recovery. Contact conservation, shell chronology, safe spawning and supply access are checked.                                               |        98.16% |
| Orbit Invaders |         35 | Four distinct fleet encounters, continuous formation turns and dives, sprite-matched solid geometry, physical bunker holes, weapon heat, brief guard plating, and crew repairs. Six complete campaigns pass at 30/60/120 Hz, with depleted-cover, overheat and rail-stop recovery. Nearest swept contacts, live warning emitters, diver clearance and separating tangency are checked.                                                                                                  |        99.21% |

The other 27 focused tests cover shared input, fixed-step timing, and platform lifecycle behavior. Reviewers checked reachable losses, reset, one terminal callback, frozen terminal state, and finite deterministic traces. The evidence records identify the final reviewed source and test hashes. Every reported actionable finding in the initial review is closed.

## Browser acceptance

Used installed stable Google Chrome through the Codex Chrome extension at 1440x900, 390x844, and 844x390. Input came from actual keys and visible controls; no gameplay state was injected. Saved screenshots were opened and inspected. Each game's final error/warning log was empty.

- **Sky Raiders:** collected a weapon pod through ordinary flight and activated every Chinese touch action. In landscape fullscreen, tracked the first carrier's core, dodged announced fan attacks, experienced gun cooling, and spent the final interception charge. Defeated the carrier and entered Copper Coast at score 1230. The transition restored one shield, retained weapon two, and preserved empty charge stock. Continued play reached a hostile-fire loss at 1410. Restart restored Cloudbreak, three shields, weapon one, three charges, zero heat and score zero while retaining the best score. All these checks used the final source with projectile absorption momentum.
- **Iron Bastion:** exercised keyboard movement, turret aim, firing and full-health repair refusal; activated every Chinese touch control and direct field aiming. Repair restored armor and nearby beacon health. A beacon-destruction loss and restart reset the battlefield and resources. A second run collected a supply, cleared Courtyard, entered Foundry with rearmed ammunition, and drove through the rebuilt corridor.
- **Orbit Invaders:** exercised movement, firing, guard duration and capacity, gun cooling, all Chinese touch controls, phone layout and landscape fullscreen. Cleared the first fleet, observed crew repair, entered Diving Wings, reached a legitimate loss, and restarted with restored hull, cover, heat and score. Reloaded and checked the final contact and cooldown wording correction in both languages.

Full campaign victories are established by automated public-input playthroughs. The browser evidence establishes the stages and outcomes listed above; it does not claim a manual win in every campaign. Physical touch devices and non-Chrome browsers were not tested. Initial acceptance does not replace the required final review after all 100 games are developed.

## Reproduce

```sh
node --experimental-test-coverage \
  --test-coverage-include='src/games/sky-raiders.js' \
  --test-coverage-include='src/games/iron-bastion.js' \
  --test-coverage-include='src/games/orbit-invaders.js' \
  --test-coverage-include='src/shared/**' \
  --test tests/sky-raiders.test.js tests/iron-bastion.test.js \
  tests/orbit-invaders.test.js tests/input.test.js tests/simulation.test.js \
  tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|^(sky-raiders|iron-bastion|orbit-invaders):' tests/catalog.test.js
npm run check
npm run format:check
npm run build
git diff --check
```
