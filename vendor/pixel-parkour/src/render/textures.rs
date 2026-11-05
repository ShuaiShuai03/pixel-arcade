//! Pixel-art textures for the 3D scene, painted procedurally from the
//! palette at startup (track, trains, barriers, buildings).

use crate::art::palette::{
    self, BLUE, BROWN, DARK_BLUE, DARK_PURPLE, GRAY, INK, LAVENDER, LIGHT_BLUE, ORANGE, PURPLE,
    RED, WHITE, YELLOW,
};
use crate::rng::Rng;
use macroquad::prelude::*;

/// A palette-indexed image.
pub struct Canvas {
    w: usize,
    h: usize,
    px: Vec<u8>,
}

impl Canvas {
    pub fn new(w: usize, h: usize, fill: u8) -> Self {
        Self {
            w,
            h,
            px: vec![fill; w * h],
        }
    }

    pub fn set(&mut self, x: usize, y: usize, c: u8) {
        if x < self.w && y < self.h {
            self.px[y * self.w + x] = c;
        }
    }

    pub fn rect(&mut self, x: usize, y: usize, w: usize, h: usize, c: u8) {
        for yy in y..y + h {
            for xx in x..x + w {
                self.set(xx, yy, c);
            }
        }
    }

    /// Sprinkle `n` random pixels of `colors`.
    fn speckle(&mut self, rng: &mut Rng, n: usize, colors: &[u8]) {
        for i in 0..n {
            let x = rng.below(self.w as u32) as usize;
            let y = rng.below(self.h as u32) as usize;
            self.set(x, y, colors[i % colors.len()]);
        }
    }

    pub fn bake(&self) -> Texture2D {
        let bytes: Vec<u8> = self.px.iter().flat_map(|&c| palette::rgba(c)).collect();
        let tex = Texture2D::from_rgba8(self.w as u16, self.h as u16, &bytes);
        tex.set_filter(FilterMode::Nearest);
        tex
    }

    #[cfg(test)]
    fn colors(&self) -> &[u8] {
        &self.px
    }
}

/// One lane of track, 3 m long: gravel, sleepers, and two rails.
/// `u` runs across the lane, `v` along it.
fn track_tile(rng: &mut Rng) -> Canvas {
    let mut c = Canvas::new(24, 24, DARK_PURPLE);
    c.speckle(rng, 90, &[INK, PURPLE]);
    for y in (2..24).step_by(8) {
        c.rect(2, y, 20, 3, BROWN);
        c.rect(2, y + 2, 20, 1, INK);
    }
    for x in [6, 17] {
        c.rect(x, 0, 2, 24, GRAY);
        c.rect(x, 0, 1, 24, WHITE);
    }
    c
}

fn gravel(rng: &mut Rng) -> Canvas {
    let mut c = Canvas::new(16, 16, INK);
    c.speckle(rng, 40, &[DARK_PURPLE, DARK_PURPLE, PURPLE]);
    c
}

/// Low concrete wall beside the outer lanes.
fn wall() -> Canvas {
    let mut c = Canvas::new(16, 8, GRAY);
    c.rect(0, 0, 16, 1, WHITE);
    c.rect(0, 7, 16, 1, PURPLE);
    for x in [0, 8] {
        c.rect(x, 1, 1, 6, LAVENDER);
    }
    c
}

/// Side of a 3 m train segment in `body` color, with windows and a stripe.
fn train_side(body: u8, rng: &mut Rng) -> Canvas {
    let mut c = Canvas::new(24, 20, body);
    c.rect(0, 0, 24, 1, WHITE);
    for wx in [3, 14] {
        c.rect(wx - 1, 4, 9, 7, INK);
        let glass = if rng.below(3) == 0 {
            YELLOW
        } else {
            LIGHT_BLUE
        };
        c.rect(wx, 5, 7, 5, glass);
        c.rect(wx, 5, 2, 1, WHITE);
    }
    c.rect(0, 13, 24, 2, WHITE);
    c.rect(0, 17, 24, 3, INK);
    c.rect(11, 16, 2, 1, GRAY);
    c
}

/// The cab end of a train.
fn train_front(body: u8) -> Canvas {
    let mut c = Canvas::new(20, 22, body);
    c.rect(0, 0, 20, 1, WHITE);
    c.rect(2, 3, 16, 8, INK);
    c.rect(3, 4, 14, 6, LIGHT_BLUE);
    c.rect(3, 4, 5, 1, WHITE);
    c.rect(0, 13, 20, 2, WHITE);
    c.rect(2, 16, 3, 2, YELLOW);
    c.rect(15, 16, 3, 2, YELLOW);
    c.rect(8, 16, 4, 2, INK);
    c.rect(0, 19, 20, 3, INK);
    c
}

/// Red and white stripes, for barrier boards.
fn stripes(w: usize, h: usize, a: u8, b: u8) -> Canvas {
    let mut c = Canvas::new(w, h, a);
    for y in 0..h {
        for x in 0..w {
            if (x + y) / 4 % 2 == 1 {
                c.set(x, y, b);
            }
        }
    }
    c.rect(0, 0, w, 1, INK);
    c.rect(0, h - 1, w, 1, INK);
    c
}

/// Full-height barrier sign.
fn block_sign() -> Canvas {
    let mut c = stripes(20, 20, YELLOW, INK);
    c.rect(3, 6, 14, 8, INK);
    c.rect(4, 7, 12, 6, RED);
    c.rect(6, 9, 8, 2, WHITE);
    c
}

/// Tunnel bricks.
fn brick() -> Canvas {
    let mut c = Canvas::new(16, 16, PURPLE);
    for row in 0..4 {
        let y = row * 4;
        c.rect(0, y, 16, 1, DARK_PURPLE);
        let off = if row % 2 == 0 { 0 } else { 4 };
        for x in [off, off + 8] {
            c.rect(x, y, 1, 4, DARK_PURPLE);
        }
        c.rect(off + 2, y + 1, 3, 1, LAVENDER);
    }
    c
}

/// Ramp plate with ridges.
fn ramp() -> Canvas {
    let mut c = Canvas::new(16, 24, GRAY);
    for y in (1..24).step_by(4) {
        c.rect(0, y, 16, 1, PURPLE);
    }
    c.rect(0, 0, 1, 24, WHITE);
    c.rect(15, 0, 1, 24, INK);
    c
}

/// A building face (4 px per meter) with a grid of lit and dark windows.
fn facade(rng: &mut Rng, wall: u8, w: usize, h: usize) -> Canvas {
    let mut c = Canvas::new(w, h, wall);
    c.rect(0, 0, w, 2, INK);
    for y in (5..h - 3).step_by(7) {
        for x in (3..w - 3).step_by(6) {
            let lit = match rng.below(10) {
                0..=3 => YELLOW,
                4 => ORANGE,
                5 => LIGHT_BLUE,
                _ => INK,
            };
            c.rect(x, y, 3, 4, lit);
        }
    }
    c
}

pub struct Textures {
    pub track: Texture2D,
    pub gravel: Texture2D,
    pub wall: Texture2D,
    /// Train side and front textures, by palette color.
    pub train_side: Vec<(u8, Texture2D)>,
    pub train_front: Vec<(u8, Texture2D)>,
    pub hurdle: Texture2D,
    pub bar: Texture2D,
    pub block: Texture2D,
    pub ramp: Texture2D,
    pub brick: Texture2D,
    pub facades: Vec<Texture2D>,
}

/// Facade texture size in pixels.
pub const FACADE_W: usize = 48;
pub const FACADE_H: usize = 64;

impl Textures {
    pub fn new(train_colors: &[u8]) -> Self {
        let mut rng = Rng::new(42);
        let facades = [DARK_PURPLE, DARK_BLUE, PURPLE, BLUE, DARK_PURPLE, PURPLE]
            .iter()
            .map(|&w| facade(&mut rng, w, FACADE_W, FACADE_H).bake())
            .collect();
        Self {
            track: track_tile(&mut rng).bake(),
            gravel: gravel(&mut rng).bake(),
            wall: wall().bake(),
            train_side: train_colors
                .iter()
                .map(|&c| (c, train_side(c, &mut rng).bake()))
                .collect(),
            train_front: train_colors
                .iter()
                .map(|&c| (c, train_front(c).bake()))
                .collect(),
            hurdle: stripes(16, 6, RED, WHITE).bake(),
            bar: stripes(16, 5, WHITE, RED).bake(),
            block: block_sign().bake(),
            ramp: ramp().bake(),
            brick: brick().bake(),
            facades,
        }
    }

    pub fn side(&self, color: u8) -> &Texture2D {
        lookup(&self.train_side, color)
    }

    pub fn front(&self, color: u8) -> &Texture2D {
        lookup(&self.train_front, color)
    }
}

fn lookup(list: &[(u8, Texture2D)], color: u8) -> &Texture2D {
    list.iter()
        .find(|(c, _)| *c == color)
        .map_or(&list[0].1, |(_, t)| t)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canvases_only_use_palette_indices() {
        let mut rng = Rng::new(1);
        let all = [
            track_tile(&mut rng),
            gravel(&mut rng),
            wall(),
            train_side(RED, &mut rng),
            train_front(BLUE),
            stripes(16, 6, RED, WHITE),
            block_sign(),
            ramp(),
            brick(),
            facade(&mut rng, DARK_PURPLE, FACADE_W, FACADE_H),
        ];
        for c in &all {
            assert!(
                c.colors()
                    .iter()
                    .all(|&i| (i as usize) < palette::PALETTE.len())
            );
        }
    }
}
