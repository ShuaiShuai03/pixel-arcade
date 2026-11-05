# Three-game quality batches

At the user's direction, at most **three games** may be under development and acceptance testing at one time. Do not begin the next batch until all games in the active batch satisfy the gates below. The 100-game target includes Pixel Parkour. Roster themes are not work assignments.

## Completed batch 6

Blockfall, Gem Match, and Minefield passed initial development, independent review, and browser acceptance. All 114 focused tests and four scoped catalog checks pass. See the [batch 6 evidence](batch-06/ACCEPTANCE.md). Publication verification is pending.

The next batch is Crate Keeper, Memory Grove, and Pixel Parkour. It remains queued until batch 6 publication is verified.

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

Once all 100 games are developed and initially accepted, run a second independent review of every game in groups of no more than three. Each result must identify the reviewed revision, tests and browser evidence, findings, remediation, and final verdict. Fix and re-review all actionable findings before recording a pass. Changes to shared code require rechecking affected games. The project remains incomplete until all 100 games pass this final review. Track this separate gate in `finalReview` in [batches.json](batches.json).

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
