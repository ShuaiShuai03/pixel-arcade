//! Keyboard and mouse-swipe input, collected once per rendered frame and
//! consumed by fixed update steps, so presses are never lost or doubled.

use crate::run::runner::Controls;
use crate::script::ScriptKey;
use macroquad::prelude::*;

/// Minimum mouse drag, in window pixels, that counts as a swipe.
const SWIPE_MIN: f32 = 30.0;
/// Two clicks within this many seconds make a double click.
const DOUBLE_CLICK: f64 = 0.3;

#[derive(Default)]
pub struct Input {
    /// Menu up (also jumps).
    pub up: bool,
    pub jump: bool,
    pub down: bool,
    pub left: bool,
    pub right: bool,
    pub confirm: bool,
    pub back: bool,
    pub pause: bool,
    pub fullscreen: bool,
    /// Use a hoverboard (B, or a double click).
    pub board: bool,
    drag_start: Option<Vec2>,
    /// Time of the last click, for double clicks.
    last_click: f64,
}

fn any_pressed(keys: &[KeyCode]) -> bool {
    keys.iter().any(|&k| is_key_pressed(k))
}

impl Input {
    /// Merge this frame's input into the pending presses. Flags accumulate
    /// until a step consumes them.
    pub fn poll(&mut self) {
        #[cfg(target_arch = "wasm32")]
        {
            let actions = crate::web::take_actions();
            for (bit, key) in [
                (1, ScriptKey::Up),
                (2, ScriptKey::Down),
                (4, ScriptKey::Left),
                (8, ScriptKey::Right),
                (16, ScriptKey::Confirm),
                (32, ScriptKey::Back),
                (64, ScriptKey::Board),
            ] {
                if actions & bit != 0 {
                    self.press(key);
                }
            }
            self.pause |= actions & 128 != 0;
        }
        self.up |= any_pressed(&[KeyCode::Up, KeyCode::W]);
        self.jump |= self.up || is_key_pressed(KeyCode::Space);
        self.down |= any_pressed(&[KeyCode::Down, KeyCode::S]);
        self.left |= any_pressed(&[KeyCode::Left, KeyCode::A]);
        self.right |= any_pressed(&[KeyCode::Right, KeyCode::D]);
        self.confirm |= any_pressed(&[KeyCode::Enter, KeyCode::KpEnter, KeyCode::Space]);
        self.back |= any_pressed(&[KeyCode::Escape, KeyCode::Backspace]);
        self.pause |= any_pressed(&[KeyCode::Escape, KeyCode::P]);
        self.fullscreen |= is_key_pressed(KeyCode::F11);

        self.board |= is_key_pressed(KeyCode::B);
        let mouse = Vec2::from(mouse_position());
        if is_mouse_button_pressed(MouseButton::Left) {
            self.drag_start = Some(mouse);
            let now = get_time();
            self.board |= now - self.last_click < DOUBLE_CLICK;
            self.last_click = now;
        }
        if let Some(start) = self.drag_start {
            let d = mouse - start;
            if d.length() >= SWIPE_MIN {
                if d.x.abs() > d.y.abs() {
                    self.left |= d.x < 0.0;
                    self.right |= d.x > 0.0;
                } else {
                    self.up |= d.y < 0.0;
                    self.jump |= d.y < 0.0;
                    self.down |= d.y > 0.0;
                }
                self.drag_start = None;
            } else if !is_mouse_button_down(MouseButton::Left) {
                self.drag_start = None;
            }
        }
    }

    /// Apply a scripted key press for the coming step.
    pub fn press(&mut self, key: ScriptKey) {
        match key {
            ScriptKey::Up => {
                self.up = true;
                self.jump = true;
            }
            ScriptKey::Down => self.down = true,
            ScriptKey::Left => self.left = true,
            ScriptKey::Right => self.right = true,
            ScriptKey::Confirm => self.confirm = true,
            ScriptKey::Back => {
                self.back = true;
                self.pause = true;
            }
            ScriptKey::Board => self.board = true,
        }
    }

    pub fn controls(&self) -> Controls {
        Controls {
            left: self.left,
            right: self.right,
            jump: self.jump,
            roll: self.down,
        }
    }

    /// Clear one-shot presses after a fixed step has seen them.
    pub fn end_step(&mut self) {
        *self = Self {
            drag_start: self.drag_start,
            last_click: self.last_click,
            ..Self::default()
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pending_actions_survive_render_only_frames_and_are_consumed_once() {
        let mut pending = Input::default();
        pending.press(ScriptKey::Left);
        pending.press(ScriptKey::Up);
        for _ in 0..2 {
            assert!(pending.controls().left && pending.controls().jump);
        }
        pending.end_step();
        assert!(!pending.controls().left && !pending.controls().jump);
        pending.press(ScriptKey::Board);
        pending.press(ScriptKey::Confirm);
        assert!(pending.board && pending.confirm && !pending.controls().jump);
        pending.end_step();
        assert!(!pending.board && !pending.confirm);
    }
}
