//! Pixel-art UI icons and panels, authored as ASCII grids where each hex
//! digit is a palette index and `.` is transparent. Baked to textures once.

use super::palette;
use macroquad::prelude::*;

// ---- HUD icons -------------------------------------------------------------------

const COIN: [&[&str]; 3] = [
    &[
        "..0000..", //
        ".0bbbb0.", "0b7bbba0", "0b7bbba0", "0bbbbba0", "0bbbbba0", ".0aaaa0.", "..0000..",
    ],
    &[
        "...00...", //
        "..0bb0..", ".0b7ba0.", ".0b7ba0.", ".0bbba0.", ".0bbba0.", "..0aa0..", "...00...",
    ],
    &[
        "...00...", //
        "...0a0..", "...0b0..", "...0b0..", "...0b0..", "...0b0..", "...0a0..", "...00...",
    ],
];

const MAGNET: &[&str] = &[
    ".00....00.",
    "0770..0770",
    "0770..0770",
    "0990..0990",
    "0990..0990",
    "0990000990",
    "0999999990",
    ".09999990.",
    "..000000..",
];

const BOARD: &[&str] = &[
    "..........",
    "....000000",
    "..00aaaab0",
    ".0aabaaa0.",
    "0aaaaba0..",
    "0b77770...",
    ".0000.....",
    ".0660.....",
    "..00......",
    "..........",
];

const GLIDER: &[&str] = &[
    "....00....",
    "...0660...",
    "0006776000",
    "0666666660",
    "0555665550",
    ".00.66.00.",
    "....55....",
    "...0aa0...",
    "...0bb0...",
    "....00....",
];

const SPRING: &[&str] = &[
    "..000000..",
    ".0dddddd0.",
    "..0cccc0..",
    ".0dddddd0.",
    "..0cccc0..",
    ".0dddddd0.",
    "..0cccc0..",
    "0777777770",
    "0888888880",
    ".00000000.",
];

const DOUBLE: &[&str] = &[
    "0000000000",
    "0bbbbbbbb0",
    "0b77bb7b70",
    "0bbb7bb7b0",
    "0bb7bb7bb0",
    "0b7bbb7b70",
    "0b77b7bbb0",
    "0aaaaaaaa0",
    "0000000000",
];

// ---- UI --------------------------------------------------------------------------

/// 9-slice panel with 4px corners.
pub const PANEL: &[&str] = &[
    ".0000000000.",
    "033333333330",
    "031111111120",
    "031111111120",
    "031111111120",
    "031111111120",
    "031111111120",
    "031111111120",
    "031111111120",
    "031111111120",
    "032222222220",
    ".0000000000.",
];
pub const PANEL_CORNER: f32 = 4.0;

/// Map a grid character to a pixel: `.` is transparent, hex digits index the
/// palette, anything else is invalid.
fn pixel(c: char) -> Option<Option<u8>> {
    match c {
        '.' => Some(None),
        _ => c.to_digit(16).map(|d| Some(d as u8)),
    }
}

/// Convert a rectangular grid to RGBA bytes. Panics on malformed input,
/// which the unit tests rule out for every shipped sprite.
fn grid_to_rgba<S: AsRef<str>>(rows: &[S]) -> (u16, u16, Vec<u8>) {
    let h = rows.len();
    let w = rows[0].as_ref().len();
    let mut bytes = Vec::with_capacity(w * h * 4);
    for row in rows {
        assert_eq!(row.as_ref().len(), w, "ragged sprite row");
        for c in row.as_ref().chars() {
            match pixel(c).expect("invalid sprite character") {
                Some(i) => bytes.extend_from_slice(&palette::rgba(i)),
                None => bytes.extend_from_slice(&[0, 0, 0, 0]),
            }
        }
    }
    (w as u16, h as u16, bytes)
}

pub fn bake<S: AsRef<str>>(rows: &[S]) -> Texture2D {
    let (w, h, bytes) = grid_to_rgba(rows);
    let tex = Texture2D::from_rgba8(w, h, &bytes);
    tex.set_filter(FilterMode::Nearest);
    tex
}

pub struct Sprites {
    pub coin: [Texture2D; 4],
    pub magnet: Texture2D,
    pub board: Texture2D,
    pub glider: Texture2D,
    pub spring: Texture2D,
    pub double: Texture2D,
    pub panel: Texture2D,
}

impl Sprites {
    pub fn new() -> Self {
        Self {
            coin: [bake(COIN[0]), bake(COIN[1]), bake(COIN[2]), bake(COIN[1])],
            magnet: bake(MAGNET),
            board: bake(BOARD),
            glider: bake(GLIDER),
            spring: bake(SPRING),
            double: bake(DOUBLE),
            panel: bake(PANEL),
        }
    }
}

/// Draw a texture with its top-left at a whole-pixel position.
pub fn draw(tex: &Texture2D, x: f32, y: f32, flip_x: bool) {
    draw_texture_ex(
        tex,
        x.round(),
        y.round(),
        WHITE,
        DrawTextureParams {
            flip_x,
            ..Default::default()
        },
    );
}

#[cfg(test)]
const ALL: &[&[&str]] = &[
    COIN[0], COIN[1], COIN[2], MAGNET, BOARD, GLIDER, SPRING, DOUBLE, PANEL,
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_grids_are_rectangular_and_use_palette_chars() {
        for (i, grid) in ALL.iter().enumerate() {
            let w = grid[0].len();
            for row in grid.iter() {
                assert_eq!(row.len(), w, "sprite #{i} has a ragged row: {row:?}");
                assert!(
                    row.chars().all(|c| pixel(c).is_some()),
                    "sprite #{i} has a non-palette character: {row:?}"
                );
            }
        }
    }

    #[test]
    fn panel_is_12x12() {
        assert_eq!(PANEL.len(), 12);
        assert!(PANEL.iter().all(|r| r.len() == 12));
    }
}
