# Pixel Parkour browser integration

The arcade includes the actual Rust game as WebAssembly, with the original 320 × 180 pixel render target and nearest-neighbour scaling. It is available at `public/parkour/index.html?lang=en` or `?lang=zh` when serving the repository root. Use the same path under a GitHub Pages project prefix. The wrapper's return link resolves to `../../index.html#games`.

## Provenance and ownership

`vendor/pixel-parkour` is an isolated copy of [ShuaiShuai03/pixel-parkour](https://github.com/ShuaiShuai03/pixel-parkour) revision `a5d147ce782cb8618d03c41a9740e63d77ef5f94`, version 0.4.0. The original worktree was clean when copied and was not modified. `SOURCE.json` records this provenance. Generated targets, screenshots, Git metadata and the upstream screenshot documentation are excluded from the copy. MIT and Ark Pixel Font license notices are retained and shipped with the page.

The initial browser port supplied these platform integrations:

- Save text is read/written through a small miniquad plugin to browser `localStorage` under `pixel-parkour.save.v1`. Browser storage denial falls back to session-only progress; native save files are not accessed.
- The wrapper supports English and Chinese. An explicit `lang` URL parameter selects the initial language; otherwise it uses the saved native preference. Wrapper and native Settings changes stay synchronized through a queued setter and events, preserve the live run, save the chosen language immediately, and replace the URL query without navigating.
- Native-only clock, command-line and screenshot APIs are excluded from the browser build.
- On-screen controls call a one-shot action queue shared with existing keyboard controls. The native menus, shop, missions, track generation, power-ups and revives remain available. The later batch 7 gameplay refinements are described below.
- Leaving the tab/window or moving keyboard focus off the canvas queues a pause. Fullscreen includes the movement/menu buttons and an exit control, with a CSS viewport fallback when the browser rejects native fullscreen. Browser Settings observes actual fullscreen state each frame, including exits through Escape or the wrapper. When the native fullscreen API is unavailable or denied, a viewport-filling fallback provides the same controls, with Escape to exit and contained keyboard focus. Native Quit returns to the arcade. The page includes keyboard-focusable controls and lets Tab leave the game canvas.

## Batch 7 gameplay refinements

The vendored copy now resolves movement, solid contact, pickup collection and power expiration chronologically within each simulation step. A pickup reached before an impact can affect that impact; a later pickup cannot reverse it. Simultaneous solid contact takes precedence. Pickup paths retain the actual approach before a collision changes the runner's position, including active magnet motion.

Invalid elapsed time leaves the run unchanged, opposing lane inputs cancel, and glide expiration grants its intended landing grace. An airborne roll changes posture while preserving the ballistic centre-of-mass path and vertical momentum. Side contact returns toward the prior lane from the actual impact point at finite speed. Vertical obstacle faces cannot become step-ups during a low jump; connected ramps and actual footprint support determine roof access. The HUD identifies the existing rail-yard districts and distance to the next one, with train headlights and roof markers preserving the original pixel-art style.

Save arithmetic saturates at the storage type's limit rather than wrapping, including cumulative mission progress, run banking and revive affordability. The save format and upstream attribution remain unchanged. See the [batch 7 evidence](quality/batch-07/ACCEPTANCE.md) for final tests, reviewed hashes and browser limitations.

## Build

Install Rust 1.88+ and the browser target, then run from the arcade root:

```sh
rustup target add wasm32-unknown-unknown
node tools/build-parkour.mjs
```

The helper builds from the vendored source with its Cargo lockfile and copies `pixel_parkour.wasm`, the matching JavaScript loaders and licenses into `public/parkour`. It records SHA-256 hashes for the artifacts, actual vendored source inputs, and build script, plus exact dependency/compiler versions, in `build-info.json`. The upstream revision remains separate from the digest of the refined source tree. No CDN resources or remote services are required at play time.

Current dependency versions are macroquad 0.4.16, miniquad 0.4.11 and quad-snd 0.2.8. `gl.js` comes from the locked miniquad crate; `audio.js` comes from the locked quad-snd crate. The wrapper validates every WebAssembly import before instantiating and checks the miniquad ABI version. Newer Rust linkers need `--allow-undefined` for the upstream quad-snd JavaScript imports; this is scoped to the vendored WASM target. No missing-import stubs are used by the wrapper.

Official implementation references:

- [macroquad WebAssembly interop and plugins](https://macroquad.rs/articles/wasm/)
- [macroquad source and build instructions](https://github.com/not-fl3/macroquad)
- [upstream Rust linker compatibility discussion](https://github.com/not-fl3/macroquad/issues/1041)

## Verification

```sh
node --test tests/parkour-web.test.js
cd vendor/pixel-parkour
cargo test --locked
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo clippy --locked --target wasm32-unknown-unknown -- -D warnings
```

The fifteen JavaScript tests cover UTF-8 saves, storage denial, language selection, invalid/oversized memory requests, linking the actual shipped WebAssembly against every shipped JavaScript import, live language synchronization, focus loss, and native/fallback fullscreen controls, and exact source/artifact provenance. The 100 Rust tests cover movement, collisions, scoring, power-ups, revives, save parsing, translation glyph coverage, procedural track safety and long autopilot runs. These commands pass on the batch 7 refined source.

Browser acceptance additionally exercised the actual WebGL page: load the title, begin a run, move/jump/roll, pause/resume/restart, inspect Chinese text, save/reload settings, and use the touch controls at a narrow viewport. The final browser run reached 277 metres and verified train roofs, spring shoes, legal loss, and saved best score, coins, language and audio settings. The compact landscape layout keeps movement and action controls beside the game at short viewport heights; portrait remains letterboxed. See the batch 7 browser record for evidence and limits. Native unit tests and successful WASM instantiation alone do not prove browser rendering or audible quality.
