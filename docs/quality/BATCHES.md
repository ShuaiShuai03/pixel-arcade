# Three-game quality batches

At the user's direction, at most **three games** may be under development and acceptance testing at one time. Do not begin the next batch until all games in the active batch satisfy the gates below. The collection target is 50 games, including Pixel Parkour (reduced from 100 at the user's direction on 2026-11-05). Roster themes are not work assignments.

## Active batch 16

| Game              | Implementation owner | Independent reviewer | Current state                                                        |
| ----------------- | -------------------- | -------------------- | -------------------------------------------------------------------- |
| Snowball Siege    | `owner-snow`         | `review-snow`        | Rebuild carried over from batch 15; all-floor prompt fixes in review |
| Stacksmith        | not started          | not started          | Queued                                                               |
| Traffic Conductor | not started          | not started          | Queued                                                               |

## Completed batch 15

Rail Switch and Tilt Lab passed initial development, independent review, and browser acceptance, bringing the accepted total to 43, Pixel Parkour included. Rail Switch has 20 timetables and Tilt Lab has 22 labs, each with level select and saved progress. All 150 focused tests, 28 shared regressions and four scoped catalog checks pass. A prompt-following driver ran all 20 Rail Switch timetables in English and all 22 Tilt Lab labs in Chinese to their win screens. Both games were played to losses, and touch play was checked on phone layouts. The Snowball Siege rebuild carries over to batch 16. See the [batch 15 evidence](batch-15/ACCEPTANCE.md).

## Completed batch 14

Conveyor Chef and Firefly Trail passed initial development, independent review, and browser acceptance, bringing the accepted total to 41, Pixel Parkour included. Conveyor Chef has 22 shifts and Firefly Trail has 24 meadows, each with level select and saved progress. All 141 focused tests, 28 shared regressions and four scoped catalog checks pass. A prompt-following driver won all 22 Conveyor Chef shifts and played Firefly Trail through its final meadow to the win screen on the approved build. Both games were played to losses, and touch play was checked on phone layouts. The Snowball Siege rebuild and Rail Switch carry over to batch 15. See the [batch 14 evidence](batch-14/ACCEPTANCE.md). Commit `2d1cba3` is live. All five checked assets match, and both published games accepted real input. See the [deployment receipt](batch-14/deployment.json).

## Completed batch 13

Orbit Gardener and Comet Catcher passed initial development, independent review, and browser acceptance, bringing the accepted total to 39, Pixel Parkour included. Mimic Vault, first scheduled here, was released with batch 12. Pixel Parkour is now the first card on the shelf and opens its own page. All 115 focused tests, 28 shared regressions and five scoped catalog checks pass. A prompt-following driver won all 24 Orbit Gardener gardens back to back. A driver that reads only the prompt and the drawn canvas won Comet Catcher's final contract. Both games were played to losses and with touch buttons on Chinese phone layouts. See the [batch 13 evidence](batch-13/ACCEPTANCE.md). Commit `54357f2` is live. All seven checked assets match, and both published games and the Pixel Parkour card accepted real input. See the [deployment receipt](batch-13/deployment.json).

## Completed batch 12

Magnet Marauder, Echo Hunter, and Frost Forge passed initial development, independent review, and browser acceptance. Mimic Vault, scheduled for batch 13, finished in the same window and is released with them, bringing the accepted total to 37. A new user rule requires at least 20 levels in level-based games. All four meet it: they have 20–25 levels each, with level select and saved progress through the new `env.progress` host interface. All 303 focused tests, 28 shared regressions and five scoped catalog checks pass. Magnet Marauder was won through all 25 chambers' final level by a driver that reads only the prompt and the drawn canvas. Mimic Vault was won through all 22 rooms by following its prompts. Echo Hunter and Frost Forge were played across early, middle and late levels to wins and losses. See the [batch 12 evidence](batch-12/ACCEPTANCE.md). Commit `fb03d0e` is live. All eight checked assets match, and the four published games accepted real input. See the [deployment receipt](batch-12/deployment.json).

## Completed batch 11

Dash Duelist, Tether Twins, and Vine Warden passed initial development, independent review, and browser acceptance, bringing the accepted total to 33. All 152 focused tests, 27 shared regressions and four scoped catalog checks pass. All three were built new. Dash Duelist was played by a driver that reads only the prompt and the drawn canvas; Tether Twins and Vine Warden by following their prompts and markers. Browser play changed the design of two games: Vine Warden's lanes, third plot and cues, and Tether Twins' layout and copy. See the [batch 11 evidence](batch-11/ACCEPTANCE.md). Commit `be08376` is live. All nine checked assets match, and the three published games accepted real input. See the [deployment receipt](batch-11/deployment.json).

## Completed batch 10

Burrow Rescue, Raft Rush, and Shield Sentinel passed initial development, independent review, and browser acceptance, bringing the accepted total to 30. All 118 focused tests, 27 shared regressions and four scoped catalog checks pass. All three were built new. Raft Rush was played by following only its prompt text; Shield Sentinel by a driver that reads only the prompt and the drawn canvas; Burrow Rescue by following its prompts on the visible mine map. See the [batch 10 evidence](batch-10/ACCEPTANCE.md). Commit `1c8efde` is live. All nine checked assets match, and the three published games accepted real input. See the [deployment receipt](batch-10/deployment.json).

The next batch is Dash Duelist, Tether Twins, and Vine Warden. It began after batch 10 passed integration and publication verification.

## Completed batch 9

Wallrunner Relay, Clockwork Bridge, and Glider Ridge passed initial development, independent review, and browser acceptance, bringing the accepted total to 27. All 112 focused tests, 27 shared regressions and four scoped catalog checks pass. The queued drafts were stubs, so all three were built new. Each completed a full browser campaign on its final source; Glider Ridge was flown by following only its on-screen prompts. See the [batch 9 evidence](batch-09/ACCEPTANCE.md). Commit `d24fbea` is live. All nine checked assets match, and the three published games accepted real input. See the [deployment receipt](batch-09/deployment.json).

The next batch is Burrow Rescue, Raft Rush, and Shield Sentinel. It began after batch 9 passed integration and publication verification.

## Completed batch 8

Lantern Climber, Gravity Courier, and Grapnel Gorge passed initial development, independent review, and browser acceptance, bringing the accepted total to 24. All 106 focused tests, 27 shared regressions and four scoped catalog checks pass. Lantern Climber and Grapnel Gorge completed full browser campaigns on their final sources; Gravity Courier's corrected airborne docking cue was verified in the browser on its final source after a full campaign on the preceding revision. See the [batch 8 evidence](batch-08/ACCEPTANCE.md). Commit `935b1cb` is live. All nine checked assets match, and published Lantern Climber and Grapnel Gorge accepted real input. See the [deployment receipt](batch-08/deployment.json).

The next batch is Wallrunner Relay, Clockwork Bridge, and Glider Ridge. It began after batch 8 passed integration and publication verification.

## Completed batch 7

Crate Keeper, Memory Grove, and Pixel Parkour passed initial development, independent review, and browser acceptance. All 192 focused checks and three scoped catalog checks pass. Crate Keeper and Memory Grove completed full browser campaigns; Pixel Parkour completed a 277-metre run, legal losses, roof and spring-shoe play, and save/reload checks. See the [batch 7 evidence](batch-07/ACCEPTANCE.md). Commit `1693048` is live. All nine checked assets match, and the published Parkour help and keyboard run passed. See the [deployment receipt](batch-07/deployment.json).

Batch 8 began after batch 7 passed integration and publication verification.

## Completed batch 6

Blockfall, Gem Match, and Minefield passed initial development, independent review, and browser acceptance. All 114 focused tests and four scoped catalog checks pass. See the [batch 6 evidence](batch-06/ACCEPTANCE.md). Commit `f8f840a` is live. All eight checked assets matched, and the published Minefield opening and proof check passed. See the [deployment receipt](batch-06/deployment.json).

## Completed batch 5

River Hop, Neon Snake, and Bubble Pop passed their initial development, tests, independent review, and browser acceptance. All 119 focused tests and four scoped catalog checks pass. See the [batch 5 evidence](batch-05/ACCEPTANCE.md). Commit `51b9558` is live. All eight checked assets matched, and two keyboard shots cleared groups on the published Bubble Pop page. See the [deployment receipt](batch-05/deployment.json).

## Completed batch 4

Sky Raiders, Iron Bastion, and Orbit Invaders passed their initial development, tests, independent review, and browser acceptance. All 130 focused tests and four catalog checks pass. See the [batch 4 evidence](batch-04/ACCEPTANCE.md). Commit `e776213` is live; all eight checked assets matched and the published Sky Raiders flight/fire/interception check passed. See the [deployment receipt](batch-04/deployment.json).

## Completed batch 3

Ember Knights, Bomb Garden, and Dungeon Dash passed their initial development, tests, independent review, and browser acceptance. See the [batch 3 evidence](batch-03/ACCEPTANCE.md). All 130 focused tests and four catalog checks pass. Commit `a9d376b` is live; all eight checked assets matched and the published Bomb Garden placement/escape check passed. See the [deployment receipt](batch-03/deployment.json).

## Completed batch 2

Paddle Duel, Meteor Drift, and Pixel Rally passed their initial development, tests, independent review, and browser acceptance. See the [batch 2 evidence](batch-02/ACCEPTANCE.md). Commit `37691b5` is live; the published assets matched the accepted source and Rally passed its public-site launch check. See the [deployment receipt](batch-02/deployment.json).

## Completed batch 1

Snowball Siege, Pinball Pocket, and Starbreaker passed implementation, testing, independent review, and browser acceptance. See the [batch 1 evidence](batch-01/ACCEPTANCE.md). Its deployment is live at commit `c3d1bc7`; the published assets matched the accepted source, and the Snowball kick behavior passed a public-site browser check.

The authoritative schedule and accepted-game list are in [batches.json](batches.json). A queued game is not accepted merely because a draft or older released version exists.

## Required final review

Once all 50 games are developed and initially accepted, run a second independent review of every game in groups of no more than three. Each result must identify the reviewed revision, tests and browser evidence, findings, remediation, and final verdict. Fix and re-review all actionable findings before recording a pass. Changes to shared code require rechecking affected games. The project remains incomplete until all 50 games pass this final review. Track this separate gate in `finalReview` in [batches.json](batches.json).

## Acceptance gates for each game

1. **Physical consistency:** visible collision geometry agrees with contact; forces, momentum, friction, gravity, and support have explicit causes. Passive contact does not create energy. Moving or powered surfaces account for their work. Fast objects cannot tunnel. Non-attacking contact cannot silently activate damage.
2. **Control and gameplay:** keyboard and touch controls expose all essential actions, discrete inputs do not unintentionally repeat, objectives and feedback are readable, progression has distinct challenges, and avoidable mistakes have clear causes.
3. **Automated evidence:** meaningful regression tests, public-input complete playthroughs, reachable failure when applicable, clean restart, one terminal callback, frozen terminal state, deterministic finite-state checks, and appropriate frame-rate/physics invariants. Coverage supports this evidence; it does not replace it.
4. **Independent review:** a reviewer checks current source and tests, and verifies the resolution of every actionable finding.
5. **Browser acceptance:** use stable Chrome through the approved Chrome plugin. Exercise real keyboard and touch controls, inspect saved screenshots, verify English and Chinese, check phone and desktop layouts, and review console errors. Do not substitute injected game state for player interaction.
6. **Batch integration:** focused tests, static checks, formatting, build, and shared lifecycle regressions pass. Record evidence and limitations before advancing the schedule.

No acceptance record should claim absolute absence of bugs or superiority to a commercial original. Record what was actually verified.

## Preserved drafts

Work started before the three-game policy is preserved in the adjacent local `pixel-arcade-queued` checkout. [QUEUED-FILES.json](QUEUED-FILES.json) records the copied paths and verified hashes. The active checkout contains only the current batch's game changes and the shared host work needed to test it. Move a draft back only when its game enters the active batch. Unfinished drafts must not enter a release.
