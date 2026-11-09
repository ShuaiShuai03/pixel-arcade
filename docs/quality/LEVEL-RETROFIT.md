# Level retrofit plan

At the user's direction (2026-11-05), every level-based game must ship at least **20 levels**, and the collection target is **50 accepted games**. This plan tracks the retrofit of already-accepted games. New and in-progress games follow the same rule from the start. The host provides `env.progress` (see [the game contract](../GAME-CONTRACT.md#level-based-games)) for a level select or continue.

Each retrofit goes through the normal gates: owner build, independent review, real-browser acceptance on a sample of levels (the opening levels, a middle level and the final level, all through the level select), and integration.

## Inventory (read-only audit)

Effort: S = level data only, M = data plus some mechanics or tests, L = structural rework.

| Game             | Current levels | Data                      | Effort | Status              |
| ---------------- | -------------: | ------------------------- | :----: | ------------------- |
| crate-keeper     |              8 | `LEVELS`, solver exists   |   S    | queued              |
| wallrunner-relay |              3 | `COURSES`                 |   S    | queued              |
| clockwork-bridge |              3 | `MACHINES`                |   S    | queued              |
| glider-ridge     |              3 | `COURSE_DATA`             |   S    | queued              |
| burrow-rescue    |              3 | `SECTORS`                 |   S    | queued              |
| raft-rush        |              3 | `SECTION_DATA`            |   S    | queued              |
| shield-sentinel  |   3 + Guardian | `WAVES`                   |   S    | queued              |
| dash-duelist     |              3 | `RIVALS`                  |   S    | queued              |
| tether-twins     |              3 | `ROOMS`                   |   S    | queued              |
| vine-warden      |              3 | `PLOTS`                   |   S    | queued              |
| river-hop        |              3 | `STAGES`                  |   S    | queued              |
| snowball-siege   |             30 | `FLOORS`                  |   M    | done (batch 16)     |
| starbreaker      |              3 | hard-coded brick patterns |   M    | queued              |
| meteor-drift     |              5 | wave if-chain             |   M    | queued              |
| ember-knights    |             20 | `STAGES`                  |   M    | done (final review) |
| bomb-garden      |             22 | `GARDENS`                 |   M    | done (final review) |
| sky-raiders      |             24 | `SECTORS`                 |   M    | done (final review) |
| iron-bastion     |             24 | `FIELDS`                  |   M    | done (final review) |
| orbit-invaders   |              4 | fleet if-chain            |   M    | queued              |
| bubble-pop       |              3 | `CAVERNS` (partial)       |   M    | queued              |
| blockfall        |              3 | `DISTRICTS` (partial)     |   M    | queued              |
| gem-match        |              3 | per-stage goal logic      |   M    | queued              |
| minefield        |              3 | field builder branches    |   M    | queued              |
| memory-grove     |              3 | 3 rule types              |   M    | queued              |
| gravity-courier  |              3 | `COURIER_ROOMS`           |   M    | queued              |
| grapnel-gorge    |              3 | inline `plans`            |   M    | queued              |
| dungeon-dash     |              5 | per-room branches         |   L    | queued              |
| neon-snake       |              3 | ~23 per-level branches    |   L    | queued              |

Not level-based (no retrofit needed): pinball-pocket (one table), paddle-duel (single match), pixel-rally (one continuous course), lantern-climber (one continuous tower). Pixel Parkour is a separate project.

In development now with at least 20 levels: Echo Hunter, Mimic Vault and Frost Forge. Magnet Marauder will be reopened for 20 chambers.
