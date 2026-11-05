# Pixel Parkour

[![CI](https://github.com/ShuaiShuai03/pixel-parkour/actions/workflows/ci.yml/badge.svg)](https://github.com/ShuaiShuai03/pixel-parkour/actions/workflows/ci.yml)

An original three-lane endless runner through a night-time rail yard, drawn
entirely in pixel art. Dodge trains, barriers and an oncoming security drone,
run across train roofs, grab power-ups, finish missions to raise your score
multiplier, and spend your coins in the shop. It runs on macOS, Windows and
Linux and is written in Rust with
[macroquad](https://github.com/not-fl3/macroquad).

![Title screen](docs/title.png)

![Dodging an oncoming train](docs/gameplay.png)

## Features

- **Three lanes, four moves.** Switch lanes, jump over low barriers, roll
  under high ones, and roll in mid-air to drop down fast.
- **Trains.** Parked trains block a lane; ramps lead up onto their roofs so you
  can run across the top. Oncoming trains drive straight at you.
- **The drone.** Clip something from the side and you stumble: the security
  drone closes in. Stumble again before it backs off and it catches you.
- **Power-ups.** Magnet (pulls in coins), glider (fly above everything along
  a trail of coins), spring shoes (jump onto train roofs), double score, and a
  hoverboard that survives one crash.
- **Hoverboards.** Find them on the track, or buy them in the shop and ride
  one whenever you like (B, or double-click).
- **Speed.** The run starts at 11 m/s and builds to 23 m/s, and the view
  widens as you speed up. Every so often the track runs through a brick
  tunnel.
- **Revive.** After a crash, spend coins to keep going. Each revive in a run
  costs twice as much as the last.
- **Missions.** Three missions at a time, such as "collect 90 coins in one
  run" or "jump 20 times". Finish all three to raise your permanent score
  multiplier, up to x30.
- **Shop.** Upgrade how long each power-up lasts (five levels each), stock up
  on hoverboards, and buy new outfits for your runner.
- **Title demo.** An autopilot plays a run behind the menus.
- **English and Chinese.** Switch the language under Settings → Language
  (设置 → 语言). The choice is saved.
- Chiptune music and sound effects generated in code, particles, and screen
  shake. Progress and settings are saved between sessions.

![The title screen in Chinese](docs/title-zh.png)

![Gliding over the trains](docs/glider.png)

![Running between two trains](docs/trains.png)

![Through a tunnel](docs/tunnel.png)

### Everything is pixel art

- The game renders at **320×180** into an offscreen target, which is scaled up
  to the window by whole-number factors with nearest-neighbour filtering and
  letterboxed. Nothing is drawn at window resolution.
- The 3D scene is made of flat-shaded blocks and small pixel textures, with
  no lighting or blending. Every pixel comes from one fixed **16-color
  palette** ([`src/art/palette.rs`](src/art/palette.rs)). Menus darken the
  view with a checkerboard dither instead of transparency.
- Textures are painted in code at startup
  ([`src/render/textures.rs`](src/render/textures.rs)). Icons are ASCII grids
  ([`src/art/sprites.rs`](src/art/sprites.rs)). English text uses a custom
  5×7 bitmap font ([`src/art/font.rs`](src/art/font.rs)). Chinese text uses
  12×12 pixel glyphs from [Ark Pixel Font](https://github.com/TakWolf/ark-pixel-font),
  stored as bitmaps in [`src/art/cjk.rs`](src/art/cjk.rs) (only the
  characters the game uses). The repository has no image or font files apart
  from the screenshots in `docs/`.

## Controls

| Action | Keys |
|---|---|
| Change lane | ← / → or A / D |
| Jump | ↑ / W / Space |
| Roll (in the air: drop down) | ↓ / S |
| Ride a hoverboard | B or double-click |
| Pause | Esc / P |
| Menus | Arrow keys or W / S, Enter or Space to confirm, Esc to go back |
| Toggle fullscreen | F11 |
| Save a screenshot | F12 |

You can also swipe with the mouse: drag left, right, up or down.

## Download

Prebuilt binaries for each platform are attached to
[GitHub Releases](https://github.com/ShuaiShuai03/pixel-parkour/releases).
The macOS binary is universal: it runs on both Apple silicon and Intel Macs.

The binaries are unsigned. On macOS, right-click the binary and choose
**Open** the first time you run it. On Windows, choose **More info → Run
anyway** in SmartScreen.

## Build from source

Install a recent stable Rust toolchain from [rustup.rs](https://rustup.rs)
(Rust 1.88 or newer), then run:

```sh
cargo run --release
```

- **macOS / Windows:** no extra dependencies.
- **Linux (Debian/Ubuntu):** install the system libraries first:

  ```sh
  sudo apt-get install libasound2-dev libx11-dev libxi-dev libgl1-mesa-dev
  ```

  On Fedora, install `alsa-lib-devel libX11-devel libXi-devel mesa-libGL-devel`.

## Save data

Your coins, best score, missions, upgrades, hoverboards, outfits and settings
(including the language) are saved as
plain `key=value` text in `save.txt`, and F12 screenshots go into
`screenshots/`. Both live in the OS config directory:

| OS | Location |
|---|---|
| macOS | `~/Library/Application Support/pixel_parkour/` |
| Windows | `%APPDATA%\pixel_parkour\` |
| Linux | `~/.config/pixel_parkour/` |

## Development

```sh
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

The tests cover:

- **Track patterns.** Every hand-made pattern has a way through. The check
  allows a lane change only with a cell's gap since the last one, and never
  in the same cell as a barrier to jump or roll. There are no traps: you are
  never doomed while open track still lies ahead of you, whichever lane you
  enter in. Oncoming trains have room to approach.
- **Autopilot playtest.** The autopilot survives 4,000 m, at every speed up
  to the maximum, on several seeds.
- **Movement.** Lane changes, jump, roll, the fast drop, ramps and roofs,
  spring jumps, stumbles and crashes.
- **Runs.** Scoring, coins, the magnet, power-up timers, hoverboards, revives,
  getting caught, and the glider.
- **Progress.** Missions, shop prices, save-file parsing, the WAV encoding,
  and palette-only textures.
- **Text.** Every Chinese character in the game's strings has a glyph.

After adding or changing Chinese text, regenerate the glyphs from the Ark
Pixel Font 12px monospaced `zh_hans` BDF file (from its
[releases](https://github.com/TakWolf/ark-pixel-font/releases)):

```sh
python3 tools/gen_cjk.py path/to/ark-pixel-12px-monospaced-zh_hans.bdf
```

For reproducible captures, `--script` replays timed input at fixed simulation
steps. It also turns off save-file writes for that run:

```sh
cargo run --release -- --script "1:enter,2:bot,600:shot,601:quit"
```

Actions: `up`/`jump`, `down`/`roll`, `left`, `right`, `board`, `enter`,
`esc`, `shot`, `bot` (toggle the autopilot), `quit`.

| Path | Purpose |
|---|---|
| `src/main.rs` | Window setup, fixed 60 Hz loop, integer-scaled presentation |
| `src/state.rs` | Screens, menus, missions and shop flow |
| `src/run/` | One run: runner physics, track patterns, power-ups, drone, autopilot |
| `src/render/` | 3D camera, block models, procedural textures |
| `src/meta.rs` | Mission sets, upgrade prices, outfits |
| `src/art/` | Palette, icons, bitmap fonts, 9-slice UI |
| `src/i18n.rs` | English and Chinese text selection |
| `src/background.rs` | Procedural sky and skyline |
| `src/particles.rs` | Cube particles |
| `src/audio.rs` | Square-wave and noise synthesis to WAV |
| `src/save.rs` | Save file |

## License

MIT. See [LICENSE](LICENSE).

The Chinese glyphs in `src/art/cjk.rs` come from Ark Pixel Font, Copyright
(c) 2021 TakWolf, under the SIL Open Font License 1.1. See
[LICENSE-ARK-PIXEL-FONT.txt](LICENSE-ARK-PIXEL-FONT.txt).
