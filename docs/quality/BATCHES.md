# Three-game quality batches

At the user's direction, at most **three games** may be under development and acceptance testing at one time. Do not begin the next batch until all games in the active batch satisfy the gates below. The 100-game target includes Pixel Parkour. Roster themes are not work assignments.

## Completed batch 1

Snowball Siege, Pinball Pocket, and Starbreaker passed implementation, testing, independent review, and browser acceptance. See the [batch 1 evidence](batch-01/ACCEPTANCE.md). The next scheduled batch is Paddle Duel, Meteor Drift, and Pixel Rally.

The authoritative schedule and accepted-game list are in [batches.json](batches.json). A queued game is not accepted merely because a draft or older released version exists.

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
