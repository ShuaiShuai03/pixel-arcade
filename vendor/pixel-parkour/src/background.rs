//! Parallax night skyline: a dithered sky plus three tileable building
//! layers, generated pixel by pixel from the palette at startup.

use crate::art::palette::{
    self, DARK_BLUE, DARK_PURPLE, INK, LAVENDER, ORANGE, PURPLE, WHITE, YELLOW,
};
use crate::art::sprites;
use crate::rng::Rng;
use crate::{VIEW_H, VIEW_W};
use macroquad::prelude::*;

const W: usize = VIEW_W as usize;
const H: usize = VIEW_H as usize;

/// A palette-indexed canvas (`None` = transparent).
struct Canvas(Vec<Option<u8>>);

impl Canvas {
    fn new() -> Self {
        Self(vec![None; W * H])
    }

    fn set(&mut self, x: i32, y: i32, c: u8) {
        if (0..H as i32).contains(&y) {
            let x = x.rem_euclid(W as i32) as usize;
            self.0[y as usize * W + x] = Some(c);
        }
    }

    fn rect(&mut self, x: i32, y: i32, w: i32, h: i32, c: u8) {
        for yy in y..y + h {
            for xx in x..x + w {
                self.set(xx, yy, c);
            }
        }
    }

    fn bake(&self) -> Texture2D {
        let mut bytes = Vec::with_capacity(W * H * 4);
        for px in &self.0 {
            match px {
                Some(i) => bytes.extend_from_slice(&palette::rgba(*i)),
                None => bytes.extend_from_slice(&[0, 0, 0, 0]),
            }
        }
        let tex = Texture2D::from_rgba8(W as u16, H as u16, &bytes);
        tex.set_filter(FilterMode::Nearest);
        tex
    }
}

/// 4x4 Bayer threshold in [0, 1).
fn bayer(x: usize, y: usize) -> f32 {
    const M: [[u8; 4]; 4] = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
    M[y % 4][x % 4] as f32 / 16.0
}

/// Sky color bands (top y, color); rows between bands are ordered-dithered.
const SKY: [(usize, u8); 3] = [(0, DARK_BLUE), (64, DARK_PURPLE), (116, PURPLE)];
const BLEND: usize = 16;

fn sky() -> Canvas {
    let mut c = Canvas::new();
    for y in 0..H {
        let band = SKY.iter().rposition(|(top, _)| y >= *top).unwrap_or(0);
        let color = SKY[band].1;
        if let Some(&(next_top, next)) = SKY.get(band + 1) {
            let start = next_top - BLEND;
            if y >= start {
                let t = (y - start) as f32 / BLEND as f32;
                for x in 0..W {
                    let col = if t > bayer(x, y) { next } else { color };
                    c.set(x as i32, y as i32, col);
                }
                continue;
            }
        }
        c.rect(0, y as i32, W as i32, 1, color);
    }
    // Stars and moon.
    let mut rng = Rng::new(0x5ca1ab1e);
    for _ in 0..60 {
        let (x, y) = (rng.below(W as u32) as i32, rng.below(90) as i32);
        c.set(x, y, if rng.below(4) == 0 { WHITE } else { LAVENDER });
    }
    let (mx, my, r) = (292i32, 40i32, 10i32);
    for y in -r..=r {
        for x in -r..=r {
            if x * x + y * y <= r * r {
                c.set(mx + x, my + y, WHITE);
            }
        }
    }
    for (x, y, cr) in [(-3, -3, 2), (4, 2, 2)] {
        for dy in -cr..=cr {
            for dx in -cr..=cr {
                if dx * dx + dy * dy <= cr * cr {
                    c.set(mx + x + dx, my + y + dy, LAVENDER);
                }
            }
        }
    }
    c
}

struct LayerStyle {
    color: u8,
    min_h: u32,
    max_h: u32,
    windows: bool,
    roof_details: bool,
}

/// A horizontally tileable strip of buildings.
fn skyline(seed: u64, style: LayerStyle) -> Canvas {
    let mut c = Canvas::new();
    let mut rng = Rng::new(seed);
    let mut x = 0i32;
    while x < W as i32 {
        let w = 16 + rng.below(28) as i32;
        let h = (style.min_h + rng.below(style.max_h - style.min_h)) as i32;
        let top = H as i32 - h;
        c.rect(x, top, w, h, style.color);
        if style.windows {
            for wy in (top + 4..H as i32 - 2).step_by(6) {
                for wx in (x + 3..x + w - 3).step_by(5) {
                    let lit = match rng.below(10) {
                        0..=2 => Some(YELLOW),
                        3 => Some(ORANGE),
                        4..=6 => Some(INK),
                        _ => None,
                    };
                    if let Some(col) = lit {
                        c.rect(wx, wy, 2, 3, col);
                    }
                }
            }
        }
        if style.roof_details {
            match rng.below(3) {
                0 => {
                    // Antenna with a red light.
                    let ax = x + 3 + rng.below((w - 6).max(1) as u32) as i32;
                    c.rect(ax, top - 10, 1, 10, style.color);
                    c.set(ax, top - 11, palette::RED);
                }
                1 => {
                    // Water tank on legs.
                    let tx = x + 2 + rng.below((w - 12).max(1) as u32) as i32;
                    c.rect(tx, top - 9, 8, 6, style.color);
                    c.rect(tx + 1, top - 3, 1, 3, style.color);
                    c.rect(tx + 6, top - 3, 1, 3, style.color);
                }
                _ => c.rect(x + 2, top - 2, w - 4, 2, style.color),
            }
        }
        x += w + rng.below(6) as i32;
    }
    c
}

pub struct Background {
    sky: Texture2D,
    layers: [(Texture2D, f32); 3],
}

impl Background {
    pub fn new() -> Self {
        let far = skyline(
            11,
            LayerStyle {
                color: LAVENDER,
                min_h: 40,
                max_h: 96,
                windows: false,
                roof_details: false,
            },
        );
        let mid = skyline(
            23,
            LayerStyle {
                color: DARK_PURPLE,
                min_h: 34,
                max_h: 80,
                windows: true,
                roof_details: false,
            },
        );
        let near = skyline(
            37,
            LayerStyle {
                color: INK,
                min_h: 14,
                max_h: 44,
                windows: false,
                roof_details: true,
            },
        );
        Self {
            sky: sky().bake(),
            layers: [(far.bake(), 0.1), (mid.bake(), 0.25), (near.bake(), 0.5)],
        }
    }

    /// Draw the sky and skyline layers scrolled by `scroll` pixels, with the
    /// skyline standing on `ground_y` (the horizon of the 3D scene).
    pub fn draw(&self, scroll: f32, ground_y: f32) {
        sprites::draw(&self.sky, 0.0, 0.0, false);
        let y = (ground_y - VIEW_H).round();
        for (tex, factor) in &self.layers {
            let offset = -((scroll * factor).floor().rem_euclid(VIEW_W));
            sprites::draw(tex, offset, y, false);
            sprites::draw(tex, offset + VIEW_W, y, false);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sky_is_fully_opaque() {
        assert!(sky().0.iter().all(Option::is_some));
    }

    #[test]
    fn skyline_touches_the_bottom_and_leaves_sky() {
        let c = skyline(
            1,
            LayerStyle {
                color: INK,
                min_h: 10,
                max_h: 40,
                windows: true,
                roof_details: true,
            },
        );
        let bottom = &c.0[(H - 1) * W..];
        assert!(bottom.iter().filter(|p| p.is_some()).count() > W / 2);
        assert!(c.0[..W].iter().all(Option::is_none), "top row stays clear");
    }

    #[test]
    fn bayer_is_in_unit_range() {
        for y in 0..4 {
            for x in 0..4 {
                assert!((0.0..1.0).contains(&bayer(x, y)));
            }
        }
    }
}
