//! Custom 5x7 bitmap font for ASCII, plus 12x12 pixel glyphs for Chinese
//! (see `cjk.rs`). Glyphs are baked into white atlas textures and tinted with
//! a palette color when drawn, so text is always pixel art.

use super::{cjk, palette};
use macroquad::prelude::*;

pub const GLYPH_W: usize = 5;
pub const GLYPH_H: usize = 7;
/// Horizontal advance per character (glyph width + 1px spacing).
pub const ADVANCE: f32 = 6.0;

/// Each row is 5 bits, most significant bit on the left.
const GLYPHS: &[(char, [u8; GLYPH_H])] = &[
    (
        'A',
        [
            0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001,
        ],
    ),
    (
        'B',
        [
            0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110,
        ],
    ),
    (
        'C',
        [
            0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110,
        ],
    ),
    (
        'D',
        [
            0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110,
        ],
    ),
    (
        'E',
        [
            0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111,
        ],
    ),
    (
        'F',
        [
            0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000,
        ],
    ),
    (
        'G',
        [
            0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111,
        ],
    ),
    (
        'H',
        [
            0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001,
        ],
    ),
    (
        'I',
        [
            0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110,
        ],
    ),
    (
        'J',
        [
            0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100,
        ],
    ),
    (
        'K',
        [
            0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001,
        ],
    ),
    (
        'L',
        [
            0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111,
        ],
    ),
    (
        'M',
        [
            0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001,
        ],
    ),
    (
        'N',
        [
            0b10001, 0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001,
        ],
    ),
    (
        'O',
        [
            0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110,
        ],
    ),
    (
        'P',
        [
            0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000,
        ],
    ),
    (
        'Q',
        [
            0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101,
        ],
    ),
    (
        'R',
        [
            0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001,
        ],
    ),
    (
        'S',
        [
            0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110,
        ],
    ),
    (
        'T',
        [
            0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100,
        ],
    ),
    (
        'U',
        [
            0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110,
        ],
    ),
    (
        'V',
        [
            0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100,
        ],
    ),
    (
        'W',
        [
            0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010,
        ],
    ),
    (
        'X',
        [
            0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001,
        ],
    ),
    (
        'Y',
        [
            0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100,
        ],
    ),
    (
        'Z',
        [
            0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111,
        ],
    ),
    (
        '0',
        [
            0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110,
        ],
    ),
    (
        '1',
        [
            0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110,
        ],
    ),
    (
        '2',
        [
            0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111,
        ],
    ),
    (
        '3',
        [
            0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110,
        ],
    ),
    (
        '4',
        [
            0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010,
        ],
    ),
    (
        '5',
        [
            0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110,
        ],
    ),
    (
        '6',
        [
            0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110,
        ],
    ),
    (
        '7',
        [
            0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000,
        ],
    ),
    (
        '8',
        [
            0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110,
        ],
    ),
    (
        '9',
        [
            0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100,
        ],
    ),
    (
        '.',
        [
            0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100,
        ],
    ),
    (
        ',',
        [
            0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b00100, 0b01000,
        ],
    ),
    (
        '!',
        [
            0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100,
        ],
    ),
    (
        '?',
        [
            0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b00000, 0b00100,
        ],
    ),
    (
        ':',
        [
            0b00000, 0b01100, 0b01100, 0b00000, 0b01100, 0b01100, 0b00000,
        ],
    ),
    (
        '-',
        [
            0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000,
        ],
    ),
    (
        '+',
        [
            0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000,
        ],
    ),
    (
        '/',
        [
            0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000,
        ],
    ),
    (
        '\'',
        [
            0b00100, 0b00100, 0b01000, 0b00000, 0b00000, 0b00000, 0b00000,
        ],
    ),
    (
        '(',
        [
            0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010,
        ],
    ),
    (
        ')',
        [
            0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000,
        ],
    ),
    (
        '%',
        [
            0b11000, 0b11001, 0b00010, 0b00100, 0b01000, 0b10011, 0b00011,
        ],
    ),
    (
        '<',
        [
            0b00010, 0b00100, 0b01000, 0b10000, 0b01000, 0b00100, 0b00010,
        ],
    ),
    (
        '>',
        [
            0b01000, 0b00100, 0b00010, 0b00001, 0b00010, 0b00100, 0b01000,
        ],
    ),
    (
        '=',
        [
            0b00000, 0b00000, 0b11111, 0b00000, 0b11111, 0b00000, 0b00000,
        ],
    ),
    (
        '_',
        [
            0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b11111,
        ],
    ),
    (
        '*',
        [
            0b00000, 0b10101, 0b01110, 0b11111, 0b01110, 0b10101, 0b00000,
        ],
    ),
];

/// Index of a character's glyph in the atlas. Lowercase maps to uppercase;
/// unknown characters (including space) return `None` and render blank.
pub fn glyph_index(c: char) -> Option<usize> {
    let c = c.to_ascii_uppercase();
    GLYPHS.iter().position(|(g, _)| *g == c)
}

/// Size of a Chinese glyph cell, and its advance (the cell has its own gap).
pub const CJK_SIZE: usize = 12;
/// Chinese glyphs sit this far above the top of the 5x7 glyphs so the
/// baselines line up.
const CJK_RISE: f32 = 3.0;

/// Index of a Chinese glyph in the atlas.
fn cjk_index(c: char) -> Option<usize> {
    cjk::GLYPHS.binary_search_by_key(&c, |(g, _)| *g).ok()
}

/// Unscaled horizontal advance of a character.
fn advance(c: char) -> f32 {
    if c.is_ascii() {
        ADVANCE
    } else {
        CJK_SIZE as f32
    }
}

/// Width in logical pixels of `text` drawn at integer `scale`.
pub fn measure(text: &str, scale: u32) -> f32 {
    let w: f32 = text.chars().map(advance).sum();
    if w == 0.0 {
        0.0
    } else {
        (w - 1.0) * scale as f32
    }
}

fn bake(w: usize, h: usize, lit: impl Fn(usize, usize) -> bool) -> Texture2D {
    let mut bytes = vec![0u8; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            if lit(x, y) {
                bytes[(y * w + x) * 4..][..4].copy_from_slice(&[255; 4]);
            }
        }
    }
    let atlas = Texture2D::from_rgba8(w as u16, h as u16, &bytes);
    atlas.set_filter(FilterMode::Nearest);
    atlas
}

pub struct Font {
    atlas: Texture2D,
    cjk: Texture2D,
}

impl Font {
    pub fn new() -> Self {
        let atlas = bake(GLYPHS.len() * GLYPH_W, GLYPH_H, |x, y| {
            GLYPHS[x / GLYPH_W].1[y] & (1 << (GLYPH_W - 1 - x % GLYPH_W)) != 0
        });
        let cjk = bake(cjk::GLYPHS.len() * CJK_SIZE, CJK_SIZE, |x, y| {
            cjk::GLYPHS[x / CJK_SIZE].1[y] & (1 << (CJK_SIZE - 1 - x % CJK_SIZE)) != 0
        });
        Self { atlas, cjk }
    }

    /// Draw text with the top-left corner of its 5x7 cells at (x, y),
    /// snapped to whole pixels. Chinese glyphs extend above and below.
    pub fn draw(&self, text: &str, x: f32, y: f32, scale: u32, color: u8) {
        let tint = palette::color(color);
        let s = scale as f32;
        let (mut x, y) = (x.round(), y.round());
        for c in text.chars() {
            let cell = if let Some(g) = glyph_index(c) {
                Some((&self.atlas, g * GLYPH_W, GLYPH_W, GLYPH_H, 0.0))
            } else {
                cjk_index(c).map(|g| (&self.cjk, g * CJK_SIZE, CJK_SIZE, CJK_SIZE, CJK_RISE))
            };
            if let Some((tex, sx, w, h, rise)) = cell {
                draw_texture_ex(
                    tex,
                    x,
                    y - rise * s,
                    tint,
                    DrawTextureParams {
                        source: Some(Rect::new(sx as f32, 0.0, w as f32, h as f32)),
                        dest_size: Some(vec2(w as f32 * s, h as f32 * s)),
                        ..Default::default()
                    },
                );
            }
            x += advance(c) * s;
        }
    }

    /// Draw text with a 1px (scaled) drop shadow in `shadow` color.
    pub fn draw_shadowed(&self, text: &str, x: f32, y: f32, scale: u32, color: u8, shadow: u8) {
        self.draw(text, x + scale as f32, y + scale as f32, scale, shadow);
        self.draw(text, x, y, scale, color);
    }

    /// Draw shadowed text horizontally centered on `cx`.
    pub fn draw_centered(&self, text: &str, cx: f32, y: f32, scale: u32, color: u8) {
        let x = (cx - measure(text, scale) / 2.0).floor();
        self.draw_shadowed(text, x, y, scale, color, palette::INK);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glyph_rows_fit_width() {
        for (c, rows) in GLYPHS {
            for row in rows {
                assert!(*row < (1 << GLYPH_W), "glyph {c:?} row too wide");
            }
        }
    }

    #[test]
    fn glyphs_are_unique_and_cover_alphanumerics() {
        for (i, (a, _)) in GLYPHS.iter().enumerate() {
            assert!(
                GLYPHS[i + 1..].iter().all(|(b, _)| a != b),
                "duplicate {a:?}"
            );
        }
        for c in ('A'..='Z').chain('0'..='9') {
            assert!(glyph_index(c).is_some(), "missing {c:?}");
        }
        assert_eq!(glyph_index('a'), glyph_index('A'));
        assert_eq!(glyph_index(' '), None);
    }

    #[test]
    fn chinese_glyphs_are_sorted_and_fit() {
        assert!(cjk::GLYPHS.windows(2).all(|w| w[0].0 < w[1].0));
        for (c, rows) in cjk::GLYPHS {
            assert!(
                rows.iter().all(|r| *r < 1 << CJK_SIZE),
                "glyph {c:?} too wide"
            );
        }
        assert_eq!(measure("中文", 1), 23.0);
        assert_eq!(measure("X中", 2), 34.0);
    }

    /// Every non-ASCII character in the game's text must have a glyph
    /// (rerun `tools/gen_cjk.py` after changing strings).
    #[test]
    fn every_chinese_character_has_a_glyph() {
        let sources = [
            include_str!("../state.rs"),
            include_str!("../meta.rs"),
            include_str!("../i18n.rs"),
        ];
        for src in sources {
            for c in src.chars().filter(|c| !c.is_ascii()) {
                assert!(cjk_index(c).is_some(), "no glyph for {c:?}");
            }
        }
    }

    #[test]
    fn measure_accounts_for_spacing_and_scale() {
        assert_eq!(measure("", 1), 0.0);
        assert_eq!(measure("A", 1), 5.0);
        assert_eq!(measure("AB", 2), 22.0);
    }
}
