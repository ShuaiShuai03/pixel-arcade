//! The single fixed 16-color palette. Every pixel the game draws comes from here.

use macroquad::color::Color;

/// Palette entries as 0xRRGGBB. Sprites refer to them by hex digit (`0`-`f`).
pub const PALETTE: [u32; 16] = [
    0x0d0b1a, // 0 ink (outlines, near-black)
    0x2b2147, // 1 dark purple
    0x4a3a73, // 2 purple
    0x7a5fa8, // 3 lavender
    0x1e3a5f, // 4 dark blue
    0x3f6fa6, // 5 blue
    0x7fb3e0, // 6 light blue
    0xf2f0e6, // 7 off-white
    0x8a8a9e, // 8 gray
    0xc23b4b, // 9 red
    0xf07a3c, // a orange
    0xf7c948, // b yellow
    0x3fa85a, // c green
    0x9fe07a, // d light green
    0x7a4a35, // e brown
    0xe8b48a, // f skin
];

pub const INK: u8 = 0;
pub const DARK_PURPLE: u8 = 1;
pub const PURPLE: u8 = 2;
pub const LAVENDER: u8 = 3;
pub const DARK_BLUE: u8 = 4;
pub const BLUE: u8 = 5;
pub const LIGHT_BLUE: u8 = 6;
pub const WHITE: u8 = 7;
pub const GRAY: u8 = 8;
pub const RED: u8 = 9;
pub const ORANGE: u8 = 10;
pub const YELLOW: u8 = 11;
pub const GREEN: u8 = 12;
pub const LIGHT_GREEN: u8 = 13;
pub const BROWN: u8 = 14;
pub const SKIN: u8 = 15;

/// RGBA bytes for a palette index.
pub fn rgba(index: u8) -> [u8; 4] {
    let hex = PALETTE[index as usize & 0xf];
    [(hex >> 16) as u8, (hex >> 8) as u8, hex as u8, 255]
}

/// Palette color as a macroquad `Color`.
pub fn color(index: u8) -> Color {
    let [r, g, b, a] = rgba(index);
    Color::from_rgba(r, g, b, a)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rgba_matches_hex() {
        assert_eq!(rgba(0), [0x0d, 0x0b, 0x1a, 255]);
        assert_eq!(rgba(15), [0xe8, 0xb4, 0x8a, 255]);
    }

    #[test]
    fn palette_entries_are_distinct() {
        for (i, a) in PALETTE.iter().enumerate() {
            assert!(!PALETTE[i + 1..].contains(a), "duplicate entry {i}");
        }
    }
}
