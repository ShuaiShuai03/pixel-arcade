//! Pixel UI widgets: 9-slice panels, menus, and a dithered screen dimmer.
//! The dimmer uses a checkerboard of ink pixels instead of alpha blending so
//! no off-palette colors are ever produced.

use super::font::{Font, measure};
use super::palette;
use super::sprites::{self, PANEL_CORNER, Sprites};
use crate::i18n::{self, Lang};
use macroquad::prelude::*;

/// Draw a 9-slice panel. Size is snapped to whole pixels.
pub fn draw_panel(sprites: &Sprites, x: f32, y: f32, w: f32, h: f32) {
    let tex = &sprites.panel;
    let c = PANEL_CORNER;
    let (x, y, w, h) = (x.round(), y.round(), w.round(), h.round());
    let (tw, th) = (tex.width(), tex.height());
    let xs = [
        (0.0, c, x, c),
        (c, tw - 2.0 * c, x + c, w - 2.0 * c),
        (tw - c, c, x + w - c, c),
    ];
    let ys = [
        (0.0, c, y, c),
        (c, th - 2.0 * c, y + c, h - 2.0 * c),
        (th - c, c, y + h - c, c),
    ];
    for (sx, sw, dx, dw) in xs {
        for (sy, sh, dy, dh) in ys {
            draw_texture_ex(
                tex,
                dx,
                dy,
                WHITE,
                DrawTextureParams {
                    source: Some(Rect::new(sx, sy, sw, sh)),
                    dest_size: Some(vec2(dw, dh)),
                    ..Default::default()
                },
            );
        }
    }
}

/// Row height for menus: Chinese glyphs are taller than the 5x7 font.
pub fn menu_spacing() -> f32 {
    match i18n::current() {
        Lang::En => 12.0,
        Lang::Zh => 14.0,
    }
}

/// Vertical menu centered on `cx`; the selected row is highlighted with a
/// blinking cursor.
pub fn draw_menu(font: &Font, items: &[String], selected: usize, cx: f32, y: f32, frame: u32) {
    for (i, item) in items.iter().enumerate() {
        let iy = y + i as f32 * menu_spacing();
        let x = (cx - measure(item, 1) / 2.0).floor();
        if i == selected {
            font.draw_shadowed(item, x, iy, 1, palette::YELLOW, palette::INK);
            if (frame / 20).is_multiple_of(2) {
                font.draw_shadowed(">", x - 10.0, iy, 1, palette::YELLOW, palette::INK);
            }
        } else {
            font.draw_shadowed(item, x, iy, 1, palette::WHITE, palette::INK);
        }
    }
}

/// A full-view 50% checkerboard of ink, baked once.
pub struct Dimmer {
    tex: Texture2D,
}

impl Dimmer {
    pub fn new() -> Self {
        let (w, h) = (crate::VIEW_W as usize, crate::VIEW_H as usize);
        let ink = palette::rgba(palette::INK);
        let mut bytes = vec![0u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                if (x + y) % 2 == 0 {
                    bytes[(y * w + x) * 4..][..4].copy_from_slice(&ink);
                }
            }
        }
        let tex = Texture2D::from_rgba8(w as u16, h as u16, &bytes);
        tex.set_filter(FilterMode::Nearest);
        Self { tex }
    }

    pub fn draw(&self) {
        sprites::draw(&self.tex, 0.0, 0.0, false);
    }
}
