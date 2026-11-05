# Batch 3 acceptance

Verified on 2026-11-05. This batch upgrades **Ember Knights, Bomb Garden, and Dungeon Dash**. Nine games have now passed their initial quality batches. Development of the 100-game collection and the required second independent review of every game remain unfinished.

## Automated and independent evidence

All **130 focused tests pass**, plus four catalog and seeded-input checks restricted to this batch. See the [coverage output](test-coverage.txt), [independent review record](reviews.json), and [browser record](browser.json). Static import/catalog checks, formatting, production build, and `git diff --check` pass. No shared runtime change was needed for this batch.

| Game          | Game tests | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                     | Line coverage |
| ------------- | ---------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------: |
| Ember Knights |         47 | Six distinct champions, finite acceleration and braking, fixed ballistic jumps, swept body contact, shared rendered/damaging blade geometry, symmetric simultaneous strikes, impulse recoil, guard/parry timing, and recoverable stamina. Complete campaigns and victories for both local players pass at 30/60/120 Hz. Holding jump across a round boundary cannot create another jump, and interrupted attacks retain their recovery time. |        98.79% |
| Bomb Garden   |         26 | Actual-position movement and damage, destination reservations, bounded owner passage through a newly placed bomb, finite-speed blast fronts, equal-time cover and ownership, harmless embers, wet fuses, barrel chains, and six authored gardens. Six legal campaigns pass across two seeds at 30/60/120 Hz. Independent runs observed no actor overlap or solid penetration. Simultaneous local deaths produce one draw.                    |        99.26% |
| Dungeon Dash  |         30 | Five distinct chambers, real gates and reachable switches, warned spike hazards, finite healing supplies, shared sword geometry, locked attack directions, swept arrows with lifetime and wall occlusion, bounded movement and knockback, and solid actors. Six independent complete campaigns pass at 30/60/120 Hz, including deliberately missed defenses followed by healing and recovery.                                                |        99.65% |

The other 27 focused tests cover shared input, fixed-step timing, and platform lifecycle behavior. Reviewers checked terminal callbacks, frozen terminal state, reset behavior, and finite deterministic input traces. Final reviewed source and test hashes are recorded in the evidence files.

## Browser acceptance

Used installed stable Google Chrome through the Codex Chrome extension at 1440x900, 844x390, and 390x844. Input came from actual keys and visible controls; no gameplay state was injected. Saved screenshots were opened and inspected. The final error/warning log was empty for each game.

- **Ember Knights:** defeated Gate Recruit and reached Copper Guard through ordinary play. Exercised all six solo touch actions and all twelve local-player controls. Completed a local match with Player 1 winning at score 3050; restart restored round one, 0:0, full health/stamina, and score zero while preserving best 3050. Browser testing caught a solo defeat message that incorrectly named “Player 2.” After correction and independent re-review, a new solo loss named Gate Recruit correctly in both English and Chinese; restart passed again.
- **Bomb Garden:** placed and escaped keyboard and touch bombs, broke crates, and collected an upgrade. Deliberate self-blasts verified life loss, a safe retry with stage score/upgrades reset, terminal loss, and clean restart. Exercised all ten local touch controls. Simultaneous self-blasts produced a visible draw; a subsequent match produced a Player 1 victory. Restart restored both actors and inventories. The final duel heading and separate player inventory labels were checked in landscape and portrait.
- **Dungeon Dash:** cleared the first chamber and collected its key. Touch controls opened a supply cache, defeated the remaining guardian, healed one lost heart, and performed the dodge. Entered Arrow Gallery at score 960, then verified a legal loss and restart to five hearts, one flask, and score zero while retaining best 960. The final English `STAMINA` label was reloaded and inspected after its separate display-only review.

Full solo campaign victories are established by automated public-input playthroughs. The browser evidence establishes the stages and local match outcomes listed above; it does not claim a manual win in every campaign. Physical touch devices and non-Chrome browsers were not tested. Initial acceptance does not replace the required final review after all 100 games are developed.

## Reproduce

```sh
node --experimental-test-coverage \
  --test-coverage-include='src/games/ember-knights.js' \
  --test-coverage-include='src/games/bomb-garden.js' \
  --test-coverage-include='src/games/dungeon-dash.js' \
  --test-coverage-include='src/shared/**' \
  --test tests/ember-knights.test.js tests/bomb-garden.test.js \
  tests/dungeon-dash.test.js tests/input.test.js tests/simulation.test.js \
  tests/platform-lifecycle.test.js
node --test --test-name-pattern='release contains|^(ember-knights|bomb-garden|dungeon-dash):' tests/catalog.test.js
npm run check
npm run format:check
npm run build
git diff --check
```
