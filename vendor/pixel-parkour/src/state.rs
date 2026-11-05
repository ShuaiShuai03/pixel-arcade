//! Screens and progression: title, missions, shop, how-to-play, settings,
//! playing, paused, revive prompt, and game over.

use crate::art::font::{Font, measure};
use crate::art::palette::{self, GRAY, LIGHT_BLUE, LIGHT_GREEN, ORANGE, RED, WHITE, YELLOW};
use crate::art::sprites::{self, Sprites};
use crate::art::ui::{self, Dimmer};
use crate::audio::{Audio, Sfx};
use crate::background::Background;
use crate::i18n::{self, fill, tr};
use crate::input::Input;
use crate::meta::{self, BOARD_PRICE, MAX_SET, OUTFITS, UPGRADE_NAMES};
use crate::render::{self, View3D, textures::Textures};
use crate::run::runner::{GLIDE_Y, SPEED_MAX, SPEED_MIN};
use crate::run::track::Power;
use crate::run::{Event, MAX_UPGRADE, Phase, Run, autopilot};
use crate::save::{MAX_SCALE, MAX_VOLUME, Save};
use crate::{STEP, VIEW_H, VIEW_W};
use macroquad::prelude::*;

pub struct Assets {
    pub font: Font,
    pub sprites: Sprites,
    pub dimmer: Dimmer,
    pub background: Background,
    pub textures: Textures,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Screen {
    Title,
    Missions,
    Shop,
    HowTo,
    Settings {
        from_pause: bool,
    },
    Playing,
    Paused,
    /// Offer to continue; seconds left to decide.
    Revive(f32),
    GameOver,
}

/// Menu entries as (English, Chinese).
type Entry = (&'static str, &'static str);
const TITLE_MENU: [Entry; 6] = [
    ("PLAY", "开始"),
    ("MISSIONS", "任务"),
    ("SHOP", "商店"),
    ("HOW TO PLAY", "玩法说明"),
    ("SETTINGS", "设置"),
    ("QUIT", "退出"),
];
const PAUSE_MENU: [Entry; 4] = [
    ("RESUME", "继续"),
    ("RESTART", "重新开始"),
    ("SETTINGS", "设置"),
    ("QUIT TO TITLE", "返回标题"),
];
const OVER_MENU: [Entry; 3] = [
    ("RUN AGAIN", "再跑一次"),
    ("SHOP", "商店"),
    ("TITLE", "标题画面"),
];
const REVIVE_MENU: [Entry; 2] = [("CONTINUE", "继续"), ("GIVE UP", "放弃")];
const SETTINGS_ROWS: usize = 6;
/// Upgrades, then the hoverboard, then outfits, then BACK.
const SHOP_ROWS: usize = UPGRADE_NAMES.len() + 1 + OUTFITS.len() + 1;
const BOARD_ROW: usize = UPGRADE_NAMES.len();
const REVIVE_TIME: f32 = 5.0;
/// Seconds a toast message stays up.
const TOAST_TIME: f32 = 2.5;
/// Seconds the controls hint shows at the start of a run.
const HINT_TIME: f32 = 4.0;

/// A fresh run seed from the clock.
#[cfg(not(target_arch = "wasm32"))]
fn new_seed() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(1, |d| d.as_nanos() as u64)
}

#[cfg(target_arch = "wasm32")]
fn new_seed() -> u64 {
    get_time().to_bits()
}

/// Browser exits can happen outside the game's settings menu.
fn fullscreen_target(saved: bool, observed: Option<bool>) -> bool {
    !observed.unwrap_or(saved)
}

/// Price of the next revive in a run.
pub fn revive_cost(revives: u32) -> u32 {
    150 * 2u32.pow(revives.min(10))
}

pub struct App {
    screen: Screen,
    cursor: usize,
    run: Run,
    pub save: Save,
    /// Smoothed camera focus.
    focus: Vec3,
    toasts: Vec<(String, f32)>,
    new_best: bool,
    /// Multiplier reached by finishing a mission set this run, if any.
    level_up: Option<u32>,
    pub quit: bool,
    /// Dev tooling (`--script ...bot`): the autopilot plays real runs.
    pub autopilot: bool,
    frame: u32,
    /// False for scripted dev runs, which must not touch the real save file.
    persist: bool,
    audio: Audio,
}

impl App {
    pub fn new(save: Save, persist: bool, mut audio: Audio) -> Self {
        i18n::set(save.lang);
        audio.set_volumes(save.music, save.sfx);
        audio.start_music(save.music);
        let run = Run::new(new_seed(), save.multiplier(), save.upgrades);
        Self {
            persist,
            audio,
            screen: Screen::Title,
            cursor: 0,
            run,
            save,
            focus: Vec3::ZERO,
            toasts: Vec::new(),
            new_best: false,
            level_up: None,
            quit: false,
            autopilot: false,
            frame: 0,
        }
    }

    fn go(&mut self, screen: Screen) {
        self.screen = screen;
        self.cursor = 0;
    }

    /// Play the menu confirm sound and switch screens.
    fn select(&mut self, screen: Screen) {
        self.audio.play(Sfx::Select);
        self.go(screen);
    }

    fn new_run(&mut self) {
        self.run = Run::new(new_seed(), self.save.multiplier(), self.save.upgrades);
        self.focus = Vec3::ZERO;
        self.toasts.clear();
        self.new_best = false;
        self.level_up = None;
    }

    fn start_run(&mut self) {
        self.new_run();
        self.select(Screen::Playing);
    }

    fn toast(&mut self, text: String) {
        self.toasts.push((text, TOAST_TIME));
    }

    fn move_cursor(&mut self, input: &Input, len: usize) {
        if input.up {
            self.cursor = (self.cursor + len - 1) % len;
            self.audio.play(Sfx::Move);
        }
        if input.down {
            self.cursor = (self.cursor + 1) % len;
            self.audio.play(Sfx::Move);
        }
    }

    fn play_run_sounds(&self) {
        for e in &self.run.events {
            let sfx = match *e {
                Event::Jump => Sfx::Jump,
                Event::Roll => Sfx::Roll,
                Event::Move => Sfx::Swish,
                Event::Land(v) if v > 8.0 => Sfx::Land,
                Event::Land(_) => continue,
                Event::Coin => Sfx::Coin,
                Event::PowerUp(Power::Glider) => Sfx::Glide,
                Event::PowerUp(_) => Sfx::PowerUp,
                Event::Stumble => Sfx::Stumble,
                Event::BoardBreak | Event::Smash => Sfx::Break,
                Event::Crash => Sfx::Crash,
            };
            self.audio.play(sfx);
        }
    }

    fn store_save(&self) {
        if !self.persist {
            return;
        }
        if let Err(e) = self.save.store() {
            eprintln!("could not write save file: {e}");
        }
    }

    fn toggle_fullscreen(&mut self) {
        #[cfg(target_arch = "wasm32")]
        let observed = Some(crate::web::is_fullscreen());
        #[cfg(not(target_arch = "wasm32"))]
        let observed = None;
        self.save.fullscreen = fullscreen_target(self.save.fullscreen, observed);
        self.apply_display();
    }

    fn apply_display(&self) {
        set_fullscreen(self.save.fullscreen);
        if !self.save.fullscreen {
            let s = self.save.scale as f32;
            request_new_screen_size(VIEW_W * s, VIEW_H * s);
        }
    }

    /// Mark missions finished by the run so far.
    fn check_missions(&mut self) {
        let set = meta::missions(self.save.set);
        let (meters, score) = (self.run.meters(), self.run.score());
        for (i, m) in set.iter().enumerate() {
            if self.save.done & (1 << i) != 0 {
                continue;
            }
            let v = m.progress(&self.run.stats, meters, score, self.save.progress[i]);
            if v >= m.target {
                self.save.done |= 1 << i;
                self.audio.play(Sfx::PowerUp);
                self.toast(tr("MISSION COMPLETE!", "任务完成！").into());
                if self.save.done == 0b111 {
                    self.toast(tr("ALL MISSIONS DONE!", "全部任务完成！").into());
                }
            }
        }
    }

    /// Bank the run: coins, best score, mission progress and set rollover.
    fn finish_run(&mut self) {
        if !self.run.end() {
            return;
        }
        let set = meta::missions(self.save.set);
        for (i, m) in set.iter().enumerate() {
            if self.save.done & (1 << i) == 0 && m.cumulative() {
                let v = m.value(&self.run.stats, self.run.meters(), self.run.score());
                self.save.progress[i] = (self.save.progress[i].saturating_add(v)).min(m.target);
            }
        }
        if self.save.done == 0b111 && self.save.set < MAX_SET {
            self.save.set += 1;
            self.save.progress = [0; 3];
            self.save.done = 0;
            self.level_up = Some(self.save.multiplier());
        }
        self.new_best = self.save.bank_run(self.run.coins, self.run.score());
        self.store_save();
        self.go(Screen::GameOver);
    }

    fn update_camera(&mut self) {
        let r = &self.run.runner;
        let k = |rate: f32| (rate * STEP).min(1.0);
        let ty = if self.run.active(Power::Glider) {
            r.y - 2.0
        } else if r.grounded {
            r.y
        } else {
            self.focus.y.min(r.y)
        };
        self.focus.x += (r.x * 0.85 - self.focus.x) * k(10.0);
        self.focus.y += (ty.min(GLIDE_Y) - self.focus.y) * k(5.0);
        self.focus.z = r.z;
    }

    /// The title-screen demo: the autopilot runs behind the menus.
    fn update_demo(&mut self) {
        let c = if self.frame.is_multiple_of(4) {
            autopilot::choose(&self.run)
        } else {
            Default::default()
        };
        self.run.update(c, STEP);
        self.update_camera();
        if matches!(self.run.phase, Phase::Down(t) if t > 1.0) {
            self.new_run();
        }
    }

    pub fn update(&mut self, input: &Input) {
        // Keep the Settings label in step with wrapper/ESC/native browser exits.
        #[cfg(target_arch = "wasm32")]
        {
            self.save.fullscreen = crate::web::is_fullscreen();
        }
        self.frame = self.frame.wrapping_add(1);
        if self.in_menus() {
            self.update_demo();
        }
        for t in &mut self.toasts {
            t.1 -= STEP;
        }
        self.toasts.retain(|t| t.1 > 0.0);
        if input.fullscreen {
            self.toggle_fullscreen();
            self.store_save();
        }
        match self.screen {
            Screen::Title => {
                self.move_cursor(input, TITLE_MENU.len());
                if input.confirm {
                    match self.cursor {
                        0 => self.start_run(),
                        1 => self.select(Screen::Missions),
                        2 => self.select(Screen::Shop),
                        3 => self.select(Screen::HowTo),
                        4 => self.select(Screen::Settings { from_pause: false }),
                        _ => self.quit = true,
                    }
                }
            }
            Screen::Missions | Screen::HowTo => {
                if input.confirm || input.back {
                    let back_to = if self.screen == Screen::Missions {
                        1
                    } else {
                        3
                    };
                    self.select(Screen::Title);
                    self.cursor = back_to;
                }
            }
            Screen::Shop => self.update_shop(input),
            Screen::Settings { from_pause } => self.update_settings(input, from_pause),
            Screen::Playing => {
                if input.pause {
                    self.select(Screen::Paused);
                    return;
                }
                let controls = if self.autopilot {
                    if self.frame.is_multiple_of(4) {
                        autopilot::choose(&self.run)
                    } else {
                        Default::default()
                    }
                } else {
                    input.controls()
                };
                if input.board && self.save.boards > 0 && self.run.use_board() {
                    self.save.boards -= 1;
                    self.store_save();
                    self.audio.play(Sfx::PowerUp);
                }
                self.run.update(controls, STEP);
                self.play_run_sounds();
                self.check_missions();
                self.update_camera();
                if self.run.awaiting_revive() {
                    let cost = revive_cost(self.run.revives);
                    if self.save.coins.saturating_add(self.run.coins) >= cost {
                        self.go(Screen::Revive(REVIVE_TIME));
                    } else {
                        self.finish_run();
                    }
                }
            }
            Screen::Paused => {
                self.move_cursor(input, PAUSE_MENU.len());
                if input.back {
                    self.select(Screen::Playing);
                } else if input.confirm {
                    match self.cursor {
                        0 => self.select(Screen::Playing),
                        1 => {
                            self.finish_run();
                            self.start_run();
                        }
                        2 => self.select(Screen::Settings { from_pause: true }),
                        _ => {
                            self.finish_run();
                            self.new_run();
                            self.select(Screen::Title);
                        }
                    }
                }
            }
            Screen::Revive(t) => {
                self.run.update(input.controls(), STEP);
                self.move_cursor(input, REVIVE_MENU.len());
                let t = t - STEP;
                if input.confirm && self.cursor == 0 {
                    let cost = revive_cost(self.run.revives);
                    let from_run = cost.min(self.run.coins);
                    self.run.coins -= from_run;
                    self.save.coins -= cost - from_run;
                    self.run.revive();
                    self.audio.play(Sfx::PowerUp);
                    self.go(Screen::Playing);
                } else if t <= 0.0 || input.back || input.confirm {
                    self.audio.play(Sfx::Select);
                    self.finish_run();
                } else {
                    self.screen = Screen::Revive(t);
                }
            }
            Screen::GameOver => {
                self.run.update(input.controls(), STEP);
                self.move_cursor(input, OVER_MENU.len());
                if input.back {
                    self.new_run();
                    self.select(Screen::Title);
                } else if input.confirm {
                    match self.cursor {
                        0 => self.start_run(),
                        1 => {
                            self.new_run();
                            self.select(Screen::Shop);
                        }
                        _ => {
                            self.new_run();
                            self.select(Screen::Title);
                        }
                    }
                }
            }
        }
    }

    fn update_shop(&mut self, input: &Input) {
        self.move_cursor(input, SHOP_ROWS);
        if input.back || input.confirm && self.cursor == SHOP_ROWS - 1 {
            self.store_save();
            self.select(Screen::Title);
            self.cursor = 2;
            return;
        }
        if !input.confirm {
            return;
        }
        let ok = if self.cursor < UPGRADE_NAMES.len() {
            let level = &mut self.save.upgrades[self.cursor];
            match meta::upgrade_cost(*level) {
                Some(cost) if self.save.coins >= cost => {
                    self.save.coins -= cost;
                    *level += 1;
                    true
                }
                _ => false,
            }
        } else if self.cursor == BOARD_ROW {
            let ok = self.save.coins >= BOARD_PRICE && self.save.boards < u32::MAX;
            if ok {
                self.save.coins -= BOARD_PRICE;
                self.save.boards += 1;
            }
            ok
        } else {
            let i = self.cursor - BOARD_ROW - 1;
            if self.save.owned & (1 << i) != 0 {
                self.save.outfit = i as u8;
                true
            } else if self.save.coins >= OUTFITS[i].price {
                self.save.coins -= OUTFITS[i].price;
                self.save.owned |= 1 << i;
                self.save.outfit = i as u8;
                true
            } else {
                false
            }
        };
        if ok {
            self.audio.play(Sfx::PowerUp);
            self.store_save();
            self.run = Run::new(new_seed(), self.save.multiplier(), self.save.upgrades);
        } else {
            self.audio.play(Sfx::Stumble);
        }
    }

    pub fn set_language(&mut self, lang: i18n::Lang) {
        self.save.lang = lang;
        i18n::set(lang);
        self.store_save();
        #[cfg(target_arch = "wasm32")]
        crate::web::language_changed(lang);
    }

    fn toggle_language(&mut self) {
        self.set_language(self.save.lang.other());
    }

    fn update_settings(&mut self, input: &Input, from_pause: bool) {
        self.move_cursor(input, SETTINGS_ROWS);
        let delta: i32 = match (input.left, input.right) {
            (true, false) => -1,
            (false, true) => 1,
            _ => 0,
        };
        let step = |v: u8, max: u8, min: u8| (v as i32 + delta).clamp(min as i32, max as i32) as u8;
        if delta != 0 {
            self.audio.play(Sfx::Move);
            match self.cursor {
                0 => self.save.music = step(self.save.music, MAX_VOLUME, 0),
                1 => self.save.sfx = step(self.save.sfx, MAX_VOLUME, 0),
                2 => {
                    self.save.scale = step(self.save.scale, MAX_SCALE, 1);
                    self.apply_display();
                }
                3 => {
                    self.toggle_fullscreen();
                }
                4 => self.toggle_language(),
                _ => {}
            }
        } else if input.confirm && self.cursor == 4 {
            self.toggle_language();
        }
        if input.confirm && self.cursor == 3 {
            self.toggle_fullscreen();
        }
        self.audio.set_volumes(self.save.music, self.save.sfx);
        if input.back || (input.confirm && self.cursor == SETTINGS_ROWS - 1) {
            self.store_save();
            self.select(if from_pause {
                Screen::Paused
            } else {
                Screen::Title
            });
            self.cursor = if from_pause { 2 } else { 4 };
        }
    }

    // ---- Drawing -------------------------------------------------------------

    fn in_menus(&self) -> bool {
        matches!(
            self.screen,
            Screen::Title
                | Screen::Missions
                | Screen::Shop
                | Screen::HowTo
                | Screen::Settings { from_pause: false }
        )
    }

    fn view(&self, pass: &RenderPass) -> View3D {
        let pull = match self.run.phase {
            Phase::Running => 0.0,
            Phase::Down(t) => (t / 0.6).min(1.0),
            Phase::Over => 1.0,
        };
        let (eye, target) = render::camera_for(self.focus, self.run.shake, self.run.time, pull);
        let k = (self.run.speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
        View3D {
            eye,
            target,
            fov: render::FOV_MIN + (render::FOV_MAX - render::FOV_MIN) * k.clamp(0.0, 1.0),
            pass: pass.clone(),
        }
    }

    pub fn draw(&self, a: &Assets, cam2d: &Camera2D, pass: &RenderPass) {
        set_camera(cam2d);
        clear_background(palette::color(palette::INK));
        let view = self.view(pass);
        let far = vec3(view.eye.x, 0.0, view.eye.z + render::DRAW_AHEAD);
        let horizon = view
            .project(far)
            .map_or(VIEW_H / 2.0, |p| p.y.clamp(0.0, VIEW_H));
        a.background
            .draw(self.run.runner.x * 6.0 + self.run.time * 2.0, horizon + 1.0);
        set_camera(&view);
        render::draw_run(
            &self.run,
            &a.textures,
            view.eye.z,
            self.save.outfit as usize,
        );
        set_camera(cam2d);

        match self.screen {
            Screen::Title => self.draw_title(a),
            Screen::Missions => self.draw_missions(a),
            Screen::Shop => self.draw_shop(a),
            Screen::HowTo => self.draw_how_to(a),
            Screen::Settings { from_pause } => {
                if from_pause {
                    a.dimmer.draw();
                }
                self.draw_settings(a);
            }
            Screen::Playing => self.draw_hud(a),
            Screen::Paused => {
                self.draw_hud(a);
                a.dimmer.draw();
                let h = 44.0 + PAUSE_MENU.len() as f32 * ui::menu_spacing();
                ui::draw_panel(&a.sprites, 100.0, 46.0, 120.0, h);
                a.font
                    .draw_centered(tr("PAUSED", "暂停"), VIEW_W / 2.0, 56.0, 2, YELLOW);
                self.draw_menu(a, &PAUSE_MENU, 82.0);
            }
            Screen::Revive(t) => self.draw_revive(a, t),
            Screen::GameOver => self.draw_game_over(a),
        }
    }

    fn draw_menu(&self, a: &Assets, items: &[Entry], y: f32) {
        let items: Vec<String> = items
            .iter()
            .map(|&(en, zh)| tr(en, zh).to_string())
            .collect();
        ui::draw_menu(&a.font, &items, self.cursor, VIEW_W / 2.0, y, self.frame);
    }

    fn draw_coins(&self, a: &Assets, n: u32, right: f32, y: f32) {
        let text = n.to_string();
        let x = right - measure(&text, 1);
        a.font.draw_shadowed(&text, x, y, 1, YELLOW, palette::INK);
        sprites::draw(
            &a.sprites.coin[(self.frame / 6 % 4) as usize],
            x - 11.0,
            y - 1.0,
            false,
        );
    }

    fn draw_hud(&self, a: &Assets) {
        let (f, r) = (&a.font, &self.run);
        let score = format!("{:07}", r.score());
        f.draw_shadowed(
            &score,
            VIEW_W - 4.0 - measure(&score, 2),
            4.0,
            2,
            WHITE,
            palette::INK,
        );
        self.draw_coins(a, r.coins, VIEW_W - 4.0, 22.0);

        let mult = r.total_multiplier();
        let color = if r.active(Power::Double) {
            ORANGE
        } else {
            LIGHT_GREEN
        };
        let text = format!("X{mult}");
        ui::draw_panel(&a.sprites, 4.0, 4.0, measure(&text, 1) + 10.0, 15.0);
        f.draw(&text, 9.0, 8.0, 1, color);

        // Active power-ups with time left.
        let mut y = 24.0;
        for (power, icon) in [
            (Power::Magnet, &a.sprites.magnet),
            (Power::Glider, &a.sprites.glider),
            (Power::Spring, &a.sprites.spring),
            (Power::Double, &a.sprites.double),
            (Power::Board, &a.sprites.board),
        ] {
            if !r.active(power) {
                continue;
            }
            sprites::draw(icon, 5.0, y, false);
            let frac = r.timer(power) / r.full_duration(power);
            draw_rectangle(18.0, y + 3.0, 32.0, 4.0, palette::color(palette::INK));
            draw_rectangle(
                18.0,
                y + 3.0,
                (32.0 * frac).ceil(),
                4.0,
                palette::color(YELLOW),
            );
            y += 13.0;
        }

        if self.save.boards > 0 {
            let text = format!("B X{}", self.save.boards);
            let x = VIEW_W - 4.0 - measure(&text, 1);
            f.draw_shadowed(&text, x, 33.0, 1, LIGHT_BLUE, palette::INK);
            sprites::draw(&a.sprites.board, x - 12.0, 31.0, false);
        }
        if r.chase > 0.0 && (self.frame / 8).is_multiple_of(2) {
            f.draw_centered(tr("WATCH OUT!", "小心！"), VIEW_W / 2.0, 28.0, 1, RED);
        }
        for (i, (text, _)) in self.toasts.iter().enumerate() {
            f.draw_centered(text, VIEW_W / 2.0, 44.0 + i as f32 * 13.0, 1, YELLOW);
        }
        // These are the existing pattern unlocks, not additional difficulty
        // changes. Show the next landmark without obscuring the approach lanes.
        if r.time >= HINT_TIME {
            let district = crate::run::track::max_difficulty(r.runner.z) as usize;
            let label = match district {
                0 => tr("YARD", "站场"),
                1 => tr("SIDINGS", "岔道"),
                2 => tr("ROOFLINE", "车顶"),
                _ => tr("EXPRESS", "快线"),
            };
            let boundaries = [0.0, 300.0, 900.0, 1800.0];
            let next = boundaries.get(district + 1).copied();
            let caption = if let Some(end) = next {
                format!("{} {}/{}M", label, r.meters(), end as u32)
            } else {
                format!("{} {}M", label, r.meters())
            };
            let width = measure(&caption, 1) + 12.0;
            ui::draw_panel(&a.sprites, 4.0, 154.0, width, 22.0);
            f.draw(&caption, 10.0, 158.0, 1, LIGHT_BLUE);
            let frac = next.map_or(1.0, |end| {
                ((r.runner.z - boundaries[district]) / (end - boundaries[district])).clamp(0.0, 1.0)
            });
            draw_rectangle(
                10.0,
                171.0,
                width - 12.0,
                2.0,
                palette::color(palette::DARK_BLUE),
            );
            draw_rectangle(
                10.0,
                171.0,
                (width - 12.0) * frac,
                2.0,
                palette::color(LIGHT_GREEN),
            );
        }
        if r.time < HINT_TIME {
            ui::draw_panel(&a.sprites, 30.0, 150.0, VIEW_W - 60.0, 24.0);
            let lines = [
                tr("LEFT/RIGHT: CHANGE LANE", "左 / 右：换道"),
                tr("UP: JUMP   DOWN: ROLL", "上：跳跃   下：下滑"),
            ];
            f.draw_centered(lines[0], VIEW_W / 2.0, 153.0, 1, WHITE);
            f.draw_centered(lines[1], VIEW_W / 2.0, 165.0, 1, WHITE);
        }
    }

    fn draw_title(&self, a: &Assets) {
        let f = &a.font;
        f.draw_centered(
            tr("PIXEL PARKOUR", "像素跑酷"),
            VIEW_W / 2.0,
            12.0,
            3,
            YELLOW,
        );
        f.draw_centered(
            tr("RAIL YARD RUSH", "铁轨狂奔"),
            VIEW_W / 2.0,
            44.0,
            1,
            LIGHT_BLUE,
        );
        let h = TITLE_MENU.len() as f32 * ui::menu_spacing() + 12.0;
        ui::draw_panel(&a.sprites, 6.0, 56.0, 100.0, h);
        let items: Vec<String> = TITLE_MENU
            .iter()
            .map(|&(en, zh)| tr(en, zh).to_string())
            .collect();
        ui::draw_menu(&a.font, &items, self.cursor, 56.0, 63.0, self.frame);
        self.draw_coins(a, self.save.coins, VIEW_W - 6.0, 6.0);
        f.draw_shadowed(
            &format!("X{}", self.save.multiplier()),
            6.0,
            6.0,
            1,
            LIGHT_GREEN,
            palette::INK,
        );
        if self.save.best > 0 {
            f.draw_shadowed(
                &fill(tr("BEST {}", "最高分 {}"), &[&self.save.best]),
                8.0,
                146.0,
                1,
                ORANGE,
                palette::INK,
            );
        }
        f.draw_centered(
            tr("ARROWS: MOVE   ENTER: SELECT", "方向键：移动   回车：确认"),
            VIEW_W / 2.0,
            168.0,
            1,
            GRAY,
        );
    }

    fn draw_missions(&self, a: &Assets) {
        let f = &a.font;
        a.dimmer.draw();
        ui::draw_panel(&a.sprites, 12.0, 12.0, VIEW_W - 24.0, 150.0);
        f.draw_centered(tr("MISSIONS", "任务"), VIEW_W / 2.0, 22.0, 2, YELLOW);
        f.draw_centered(
            &fill(
                tr("SET {}   SCORE MULTIPLIER X{}", "第 {} 组   分数倍率 X{}"),
                &[&(self.save.set + 1), &self.save.multiplier()],
            ),
            VIEW_W / 2.0,
            42.0,
            1,
            LIGHT_GREEN,
        );
        for (i, m) in meta::missions(self.save.set).iter().enumerate() {
            let y = 62.0 + i as f32 * 24.0;
            let done = self.save.done & (1 << i) != 0;
            f.draw(
                if done { "+" } else { "-" },
                24.0,
                y,
                1,
                if done { LIGHT_GREEN } else { GRAY },
            );
            f.draw(
                &m.text(),
                34.0,
                y,
                1,
                if done { LIGHT_GREEN } else { WHITE },
            );
            let status = if done {
                tr("DONE", "已完成").to_string()
            } else if m.cumulative() {
                format!("{}/{}", self.save.progress[i], m.target)
            } else {
                tr("IN ONE RUN", "需在一局内完成").to_string()
            };
            f.draw(&status, 34.0, y + 11.0, 1, GRAY);
        }
        f.draw_centered(
            tr(
                "FINISH ALL THREE TO RAISE YOUR MULTIPLIER",
                "完成全部三个任务可提高倍率",
            ),
            VIEW_W / 2.0,
            134.0,
            1,
            ORANGE,
        );
        f.draw_centered(
            tr("PRESS ENTER", "按回车键"),
            VIEW_W / 2.0,
            149.0,
            1,
            LIGHT_BLUE,
        );
    }

    fn draw_shop(&self, a: &Assets) {
        let f = &a.font;
        a.dimmer.draw();
        ui::draw_panel(&a.sprites, 12.0, 6.0, VIEW_W - 24.0, 168.0);
        f.draw_centered(tr("SHOP", "商店"), VIEW_W / 2.0, 12.0, 2, YELLOW);
        self.draw_coins(a, self.save.coins, VIEW_W - 22.0, 14.0);
        let mut rows = Vec::new();
        for (i, name) in UPGRADE_NAMES.iter().enumerate() {
            let level = self.save.upgrades[i];
            let pips: String = (0..MAX_UPGRADE)
                .map(|l| if l < level { '#' } else { '-' })
                .collect();
            let price = meta::upgrade_cost(level)
                .map_or(tr("MAX", "满级").to_string(), |c| c.to_string());
            rows.push((tr(name.0, name.1).to_string(), pips, price));
        }
        rows.push((
            tr("HOVERBOARD", "悬浮滑板").to_string(),
            fill(tr("OWN {}", "持有 {}"), &[&self.save.boards]),
            BOARD_PRICE.to_string(),
        ));
        for (i, o) in OUTFITS.iter().enumerate() {
            let state = if self.save.outfit as usize == i {
                tr("WEARING", "穿戴中").to_string()
            } else if self.save.owned & (1 << i) != 0 {
                tr("OWNED", "已拥有").to_string()
            } else {
                o.price.to_string()
            };
            rows.push((
                fill(tr("OUTFIT {}", "服装 {}"), &[&o.name]),
                String::new(),
                state,
            ));
        }
        rows.push((tr("BACK", "返回").to_string(), String::new(), String::new()));
        for (i, (name, mid, right)) in rows.iter().enumerate() {
            let gap = if i > BOARD_ROW { 6.0 } else { 0.0 };
            let y = 30.0 + i as f32 * 13.0 + gap;
            let sel = i == self.cursor;
            let c = if sel { YELLOW } else { WHITE };
            if sel && (self.frame / 20).is_multiple_of(2) {
                f.draw(">", 20.0, y, 1, YELLOW);
            }
            f.draw(name, 28.0, y, 1, c);
            f.draw(mid, 150.0, y, 1, LIGHT_GREEN);
            f.draw(right, VIEW_W - 24.0 - measure(right, 1), y, 1, c);
        }
        let help = if self.cursor < BOARD_ROW {
            tr(
                "UPGRADES MAKE POWER-UPS LAST LONGER",
                "升级可延长道具的持续时间",
            )
        } else if self.cursor == BOARD_ROW {
            tr("PRESS B IN A RUN TO RIDE ONE", "跑步时按 B 键使用")
        } else {
            tr(
                "ENTER: BUY OR WEAR   ESC: BACK",
                "回车：购买或穿戴   ESC：返回",
            )
        };
        f.draw_centered(help, VIEW_W / 2.0, 164.0, 1, GRAY);
    }

    fn draw_how_to(&self, a: &Assets) {
        let (f, s) = (&a.font, &a.sprites);
        a.dimmer.draw();
        ui::draw_panel(s, 12.0, 6.0, VIEW_W - 24.0, 168.0);
        f.draw_centered(tr("HOW TO PLAY", "玩法说明"), VIEW_W / 2.0, 12.0, 1, YELLOW);
        let lines = [
            (
                ("LANES", "换道"),
                (
                    "LEFT / RIGHT  (A / D, OR SWIPE)",
                    "左 / 右（A / D，或用鼠标滑动）",
                ),
            ),
            (
                ("JUMP", "跳跃"),
                (
                    "UP / W / SPACE - OVER LOW BARRIERS",
                    "上 / W / 空格：跳过低栏",
                ),
            ),
            (
                ("ROLL", "下滑"),
                ("DOWN / S - UNDER HIGH BARRIERS", "下 / S：从高栏下钻过"),
            ),
            (
                ("", ""),
                ("AIR TUCK KEEPS YOUR FLIGHT PATH", "空中收身不改变飞行轨迹"),
            ),
            (
                ("TRAINS", "火车"),
                ("RUN UP RAMPS ONTO THE ROOFS", "沿坡道跑上车顶"),
            ),
            (
                ("", ""),
                ("CLIPPING THINGS SIDEWAYS IS A STUMBLE:", "侧面擦撞会绊倒，"),
            ),
            (
                ("", ""),
                (
                    "STUMBLE TWICE AND THE DRONE GETS YOU",
                    "连续绊倒两次会被无人机抓住",
                ),
            ),
        ];
        for (i, ((k_en, k_zh), (v_en, v_zh))) in lines.iter().enumerate() {
            let y = 26.0 + i as f32 * 12.0;
            f.draw(tr(k_en, k_zh), 20.0, y, 1, ORANGE);
            f.draw(tr(v_en, v_zh), 70.0, y, 1, WHITE);
        }
        let items = [
            (
                &s.magnet,
                tr("MAGNET: PULLS IN COINS", "磁铁：吸取附近的金币"),
            ),
            (
                &s.glider,
                tr("GLIDER: FLY OVER EVERYTHING", "飞翼：飞越一切障碍"),
            ),
            (
                &s.spring,
                tr("SPRING SHOES: HUGE JUMPS", "弹簧鞋：超级跳跃"),
            ),
            (&s.double, tr("DOUBLE: TWICE THE SCORE", "双倍：分数翻倍")),
            (
                &s.board,
                tr("HOVERBOARD: SURVIVE ONE CRASH", "悬浮滑板：抵挡一次撞击"),
            ),
        ];
        for (i, (icon, text)) in items.iter().enumerate() {
            let y = 112.0 + i as f32 * 12.0;
            sprites::draw(icon, 22.0, y - 2.0, false);
            f.draw(text, 38.0, y, 1, WHITE);
        }
        let back = tr("ENTER: BACK", "回车：返回");
        f.draw(back, VIEW_W - 22.0 - measure(back, 1), 12.0, 1, GRAY);
    }

    fn draw_settings(&self, a: &Assets) {
        ui::draw_panel(&a.sprites, 70.0, 14.0, 180.0, 150.0);
        a.font
            .draw_centered(tr("SETTINGS", "设置"), VIEW_W / 2.0, 26.0, 2, YELLOW);
        let onoff = |b: bool| if b { tr("ON", "开") } else { tr("OFF", "关") };
        let rows = [
            fill(tr("MUSIC  < {} >", "音乐 < {} >"), &[&self.save.music]),
            fill(tr("SFX    < {} >", "音效 < {} >"), &[&self.save.sfx]),
            fill(tr("WINDOW < {}X >", "缩放 < {}X >"), &[&self.save.scale]),
            fill(
                tr("FULLSCREEN < {} >", "全屏 < {} >"),
                &[&onoff(self.save.fullscreen)],
            ),
            fill(
                tr("LANGUAGE < {} >", "语言 < {} >"),
                &[&self.save.lang.name()],
            ),
            tr("BACK", "返回").to_string(),
        ];
        ui::draw_menu(&a.font, &rows, self.cursor, VIEW_W / 2.0, 56.0, self.frame);
        a.font.draw_centered(
            tr("LEFT/RIGHT: CHANGE", "左 / 右：调整"),
            VIEW_W / 2.0,
            148.0,
            1,
            GRAY,
        );
    }

    fn draw_revive(&self, a: &Assets, t: f32) {
        let f = &a.font;
        a.dimmer.draw();
        ui::draw_panel(&a.sprites, 80.0, 34.0, 160.0, 112.0);
        f.draw_centered(tr("SAVE ME?", "要复活吗？"), VIEW_W / 2.0, 46.0, 2, YELLOW);
        let cost = revive_cost(self.run.revives);
        f.draw_centered(
            &fill(tr("COSTS {} COINS", "花费 {} 金币"), &[&cost]),
            VIEW_W / 2.0,
            70.0,
            1,
            WHITE,
        );
        self.draw_coins(
            a,
            self.save.coins.saturating_add(self.run.coins),
            212.0,
            83.0,
        );
        f.draw(tr("YOU HAVE", "持有"), 100.0, 83.0, 1, GRAY);
        let w = 128.0 * (t / REVIVE_TIME).max(0.0);
        draw_rectangle(96.0, 96.0, 128.0, 4.0, palette::color(palette::INK));
        draw_rectangle(96.0, 96.0, w.ceil(), 4.0, palette::color(ORANGE));
        self.draw_menu(a, &REVIVE_MENU, 108.0);
    }

    fn draw_game_over(&self, a: &Assets) {
        let f = &a.font;
        a.dimmer.draw();
        ui::draw_panel(&a.sprites, 64.0, 8.0, 192.0, 168.0);
        let title = if self.run.caught {
            tr("CAUGHT!", "被抓住了！")
        } else {
            tr("CRASHED!", "撞车了！")
        };
        f.draw_centered(title, VIEW_W / 2.0, 18.0, 2, RED);
        let r = &self.run;
        let rows = [
            (tr("SCORE", "分数"), r.score().to_string()),
            (tr("BEST", "最高分"), self.save.best.to_string()),
            (
                tr("DISTANCE", "距离"),
                fill(tr("{}M", "{} 米"), &[&r.meters()]),
            ),
            (tr("COINS", "金币"), format!("+{}", r.coins)),
        ];
        for (i, (k, v)) in rows.iter().enumerate() {
            let y = 40.0 + i as f32 * 12.0;
            f.draw(k, 80.0, y, 1, LIGHT_BLUE);
            f.draw(v, 240.0 - measure(v, 1), y, 1, WHITE);
        }
        if self.new_best && (self.frame / 15).is_multiple_of(2) {
            f.draw_centered(tr("NEW BEST!", "新纪录！"), VIEW_W / 2.0, 90.0, 1, YELLOW);
        }
        if let Some(m) = self.level_up {
            f.draw_centered(
                &fill(tr("MULTIPLIER UP: X{}", "倍率提升：X{}"), &[&m]),
                VIEW_W / 2.0,
                103.0,
                1,
                LIGHT_GREEN,
            );
        } else {
            let done = self.save.done.count_ones();
            f.draw_centered(
                &fill(
                    tr("MISSIONS {}/3   MULTIPLIER X{}", "任务 {}/3   倍率 X{}"),
                    &[&done, &self.save.multiplier()],
                ),
                VIEW_W / 2.0,
                103.0,
                1,
                LIGHT_GREEN,
            );
        }
        self.draw_coins(a, self.save.coins, 240.0, 116.0);
        f.draw(tr("BANK", "存款"), 80.0, 116.0, 1, GRAY);
        self.draw_menu(a, &OVER_MENU, 132.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fullscreen_toggle_uses_browser_state_after_external_exit() {
        // Native entry recorded ON, then the wrapper or Escape exited fullscreen.
        let stale_saved = true;
        let enter_again = fullscreen_target(stale_saved, Some(false));
        assert!(
            enter_again,
            "one activation must re-enter after external exit"
        );
        assert!(
            !fullscreen_target(enter_again, Some(true)),
            "next activation exits"
        );
        assert!(
            fullscreen_target(false, Some(false)),
            "re-entry remains one activation"
        );
        assert!(
            fullscreen_target(false, None),
            "native builds use stored state"
        );
        assert!(!fullscreen_target(true, None));
    }

    #[test]
    fn revive_cost_doubles() {
        assert_eq!(revive_cost(0), 150);
        assert_eq!(revive_cost(1), 300);
        assert_eq!(revive_cost(2), 600);
    }
}
