# Pixel Arcade

A pixel-art island with **23 original browser games**, plus **Pixel Parkour**. Play free on a keyboard or touch screen, in English or Simplified Chinese.

**[Play Pixel Arcade](https://shuaishuai03.github.io/pixel-arcade/)**

No account, downloads, ads, analytics, or CDN dependencies. Personal bests and language preferences are stored only in the current browser.

## The collection

| Game           | What you play                                                           | Players |
| -------------- | ----------------------------------------------------------------------- | ------- |
| Snowball Siege | Freeze, deliberately kick, and clear six frostbound chambers            | 1       |
| Ember Knights  | Jump, strike, and block in a best-of-three castle duel                  | 1 or 2  |
| Bomb Garden    | Plant bombs, clear crates, and escape the blast                         | 1 or 2  |
| Iron Bastion   | Defend a beacon against three waves of enemy tanks                      | 1       |
| Sky Raiders    | Dodge incoming fire and defeat the carrier fleet                        | 1       |
| Neon Snake     | Preserve your growing body through three gardens, gates and underpasses | 1       |
| Starbreaker    | Break through three orbital brick fields                                | 1       |
| Orbit Invaders | Protect the moon colony through four formations                         | 1       |
| River Hop      | Time real hops across traffic, logs, diving turtles and a cable ferry   | 1       |
| Meteor Drift   | Thrust, turn, and blast through five asteroid sectors                   | 1       |
| Blockfall      | Build lines, excavate rubble, and power three city districts            | 1       |
| Gem Match      | Match shapes, collect specimens, and restore garden soil                | 1       |
| Crate Keeper   | Plan eight warehouses with animated pushes, undo, and optional hints    | 1       |
| Minefield      | Deduce safe ground across a camp, split quarry, and ridge sectors       | 1       |
| Memory Grove   | Remember free pairs, ordered pairs, and triples in three clearings      | 1       |
| Pixel Rally    | Steer through traffic, collect coins, and reach the finish              | 1       |
| Paddle Duel    | Win a seven-point match against a friend or the computer                | 1 or 2  |
| Pinball Pocket | Launch three balls, work the flippers, and chase a high score           | 1       |
| Dungeon Dash   | Clear five chambers, collect keys, and reach the vault                  | 1       |
| Bubble Pop     | Bank capsules, match symbols and drain groups across three air tables   | 1       |
| Pixel Parkour  | Run through a three-lane rail yard, upgrade gear, and complete missions | 1       |

The collection uses original code and artwork inspired by classic game mechanics. It does not include the assets or characters of commercial arcade games.

The collection is being expanded and refined in batches of at most three games. Twenty-four games have passed initial acceptance; [batch 8](docs/quality/batch-08/ACCEPTANCE.md) adds Lantern Climber, Gravity Courier, and Grapnel Gorge. The [quality schedule](docs/quality/BATCHES.md) tracks the 100-game target and the required second independent review after development is complete.

## Controls

Each game displays its own controls and goal beside the canvas. The shared controls are:

- **P / Escape:** pause or resume.
- **R:** restart, keeping your personal best.
- **Touch:** use the on-screen buttons or tap the board in pointer games.
- **Local two-player:** choose two players before starting; both players share a keyboard.
- **Sound:** use the header toggle. Sound is off by default.
- **Language:** use the EN / 中文 toggle. Both languages are available in every game.

Leaving the tab automatically pauses the active game. Pixel Parkour has its own menu, save system, and controls explained on its page.

## Run locally

Use Node.js 24 or newer:

```sh
npm ci
npm run dev
```

Open the local address printed by the server. Serve over HTTP; browser modules cannot be played by opening `index.html` directly from the filesystem.

```sh
npm test
npm run test:coverage
npm run check
npm run build
```

`npm run build` copies the static application into `dist/`. The live GitHub Pages site serves the repository's `main` branch from the root; `.nojekyll` preserves the static files. All paths are relative so the site also works below a repository path.

## Organization

```text
pixel-arcade/
  index.html              Arcade hub and shared game screen
  src/app.js              Navigation, input, audio, scores, language
  src/games/              Twenty independent game modules
  src/shared/             Small shared utilities
  src/world.js            Original pixel island illustration
  public/parkour/         Runnable Pixel Parkour WebAssembly port
  vendor/pixel-parkour/   Attributed source snapshot for the web port
  tests/                  Rules, full playthroughs, and host regressions
  tools/                  Local server, static checks, and builds
  docs/                   Integration contract and acceptance evidence
```

The parent `games` directory is not a repository. Pixel Arcade and the original [Pixel Parkour](https://github.com/ShuaiShuai03/pixel-parkour) remain independent repositories. The browser port is an attributed source snapshot rather than a dependency on a mutable branch. See [the port notes](docs/PARKOUR.md) and [the game interface](docs/GAME-CONTRACT.md).

## License

MIT for the original arcade code and artwork. The Pixel Parkour source and its included font license retain their original attribution. See [LICENSE](LICENSE), the licenses in `vendor/pixel-parkour`, and [the browser port's third-party notices](public/parkour/THIRD-PARTY-NOTICES.txt).
