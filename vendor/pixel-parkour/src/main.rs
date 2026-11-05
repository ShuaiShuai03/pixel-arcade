#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod art;
mod audio;
mod background;
mod i18n;
mod input;
mod meta;
mod particles;
mod render;
mod rng;
mod run;
mod save;
mod script;
mod state;
#[cfg(target_arch = "wasm32")]
mod web;

use art::{font::Font, palette, sprites::Sprites, ui::Dimmer};
use audio::Audio;
use background::Background;
use input::Input;
use macroquad::prelude::*;
use render::textures::Textures;
use save::Save;
use script::{Action, Script};
use state::{App, Assets};

/// Logical (virtual) resolution. Everything renders at this size and is then
/// integer-scaled to the window.
pub const VIEW_W: f32 = 320.0;
pub const VIEW_H: f32 = 180.0;

/// Fixed simulation step (60 Hz).
pub const STEP: f32 = 1.0 / 60.0;
/// Cap on catch-up steps per frame so a long stall cannot spiral.
const MAX_STEPS_PER_FRAME: u32 = 5;

fn window_conf() -> Conf {
    let save = Save::load();
    Conf {
        window_title: "Pixel Parkour".to_owned(),
        window_width: (VIEW_W * save.scale as f32) as i32,
        window_height: (VIEW_H * save.scale as f32) as i32,
        window_resizable: true,
        fullscreen: save.fullscreen,
        high_dpi: false,
        ..Default::default()
    }
}

/// Blit the logical render target to the window at the largest integer scale
/// that fits, letterboxed and centered.
fn present(target: &RenderTarget) {
    set_default_camera();
    clear_background(palette::color(palette::INK));
    let scale = (screen_width() / VIEW_W)
        .min(screen_height() / VIEW_H)
        .floor()
        .max(1.0);
    let (w, h) = (VIEW_W * scale, VIEW_H * scale);
    let x = ((screen_width() - w) / 2.0).floor();
    let y = ((screen_height() - h) / 2.0).floor();
    draw_texture_ex(
        &target.texture,
        x,
        y,
        WHITE,
        DrawTextureParams {
            dest_size: Some(vec2(w, h)),
            flip_y: true,
            ..Default::default()
        },
    );
}

/// Save the logical frame (3x nearest-neighbour upscale) as a PNG under the
/// game's config directory. Returns the written path.
#[cfg(not(target_arch = "wasm32"))]
fn save_screenshot(target: &RenderTarget) -> Option<std::path::PathBuf> {
    const UP: usize = 3;
    let src = target.texture.get_texture_data();
    let (w, h) = (src.width as usize, src.height as usize);
    let mut bytes = vec![0u8; w * h * UP * UP * 4];
    for y in 0..h * UP {
        for x in 0..w * UP {
            let s = ((y / UP) * w + x / UP) * 4;
            let d = (y * w * UP + x) * 4;
            bytes[d..d + 4].copy_from_slice(&src.bytes[s..s + 4]);
        }
    }
    let image = Image {
        width: (w * UP) as u16,
        height: (h * UP) as u16,
        bytes,
    };
    let dir = save::dir()?.join("screenshots");
    std::fs::create_dir_all(&dir).ok()?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis();
    let path = dir.join(format!("shot-{stamp}.png"));
    image.export_png(path.to_str()?);
    Some(path)
}

#[macroquad::main(window_conf)]
async fn main() {
    // The 3D scene needs a depth buffer in the low-res target.
    let target = render_target_ex(
        VIEW_W as u32,
        VIEW_H as u32,
        RenderTargetParams {
            sample_count: 1,
            depth: true,
        },
    );
    target.texture.set_filter(FilterMode::Nearest);
    let mut camera = Camera2D::from_display_rect(Rect::new(0.0, 0.0, VIEW_W, VIEW_H));
    camera.render_target = Some(target.clone());

    let assets = Assets {
        font: Font::new(),
        sprites: Sprites::new(),
        dimmer: Dimmer::new(),
        background: Background::new(),
        textures: Textures::new(&run::track::TRAIN_COLORS),
    };
    let script = Script::from_args();
    let mut app = App::new(Save::load(), !script.is_active(), Audio::load().await);
    #[cfg(target_arch = "wasm32")]
    {
        app.set_language(app.save.lang);
        web::ready();
    }
    let mut input = Input::default();
    let mut step: u64 = 0;
    let mut acc = 0.0;

    loop {
        input.poll();
        #[cfg(target_arch = "wasm32")]
        if let Some(lang) = i18n::take_language() {
            app.set_language(lang);
        }
        let mut shot = is_key_pressed(KeyCode::F12);

        acc += get_frame_time().min(0.25);
        let mut steps = 0;
        while acc >= STEP && steps < MAX_STEPS_PER_FRAME {
            step += 1;
            // Scripted actions are keyed to simulation steps for reproducibility.
            for action in script.actions_at(step) {
                match action {
                    Action::Shot => shot = true,
                    Action::Quit => app.quit = true,
                    Action::Bot => app.autopilot = !app.autopilot,
                    Action::Key(k) => input.press(k),
                }
            }
            app.update(&input);
            input.end_step();
            acc -= STEP;
            steps += 1;
        }
        if steps == MAX_STEPS_PER_FRAME {
            acc = 0.0;
        }
        if app.quit {
            #[cfg(target_arch = "wasm32")]
            web::exit();
            break;
        }

        app.draw(&assets, &camera, &target.render_pass);
        // Presenting switches cameras, which flushes the target's draw batch.
        present(&target);
        #[cfg(target_arch = "wasm32")]
        let _ = shot;
        #[cfg(not(target_arch = "wasm32"))]
        if shot && let Some(path) = save_screenshot(&target) {
            println!("screenshot: {}", path.display());
        }
        next_frame().await;
    }
}
