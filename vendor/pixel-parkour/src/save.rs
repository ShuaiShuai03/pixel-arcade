//! Progress and settings, stored as `key=value` lines in the OS config
//! directory (e.g. `~/Library/Application Support/pixel_parkour/save.txt`).

use crate::i18n::Lang;
use crate::meta::{MAX_SET, OUTFITS};
use crate::run::MAX_UPGRADE;
#[cfg(not(target_arch = "wasm32"))]
use std::path::PathBuf;

pub const MAX_VOLUME: u8 = 10;
pub const MAX_SCALE: u8 = 6;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Save {
    pub best: u32,
    /// Coins in the bank.
    pub coins: u32,
    /// Current mission set; the score multiplier is `set + 1`.
    pub set: u32,
    /// Progress toward each mission of the set (for cumulative missions).
    pub progress: [u32; 3],
    /// Bit i set: mission i of the set is done.
    pub done: u8,
    /// Upgrade levels: magnet, glider, spring, double.
    pub upgrades: [u8; 4],
    /// Bit i set: outfit i is owned.
    pub owned: u8,
    /// Hoverboards in the inventory.
    pub boards: u32,
    pub outfit: u8,
    pub music: u8,
    pub sfx: u8,
    pub scale: u8,
    pub fullscreen: bool,
    pub lang: Lang,
}

impl Default for Save {
    fn default() -> Self {
        Self {
            best: 0,
            coins: 0,
            set: 0,
            progress: [0; 3],
            done: 0,
            upgrades: [0; 4],
            owned: 1,
            boards: 0,
            outfit: 0,
            music: 6,
            sfx: 8,
            scale: 3,
            fullscreen: false,
            lang: Lang::En,
        }
    }
}

/// The game's directory under the OS config dir.
#[cfg(not(target_arch = "wasm32"))]
pub fn dir() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("pixel_parkour"))
}

#[cfg(not(target_arch = "wasm32"))]
fn file() -> Option<PathBuf> {
    dir().map(|d| d.join("save.txt"))
}

fn parse_list<const N: usize, T: std::str::FromStr + Copy>(value: &str, mut out: [T; N]) -> [T; N] {
    for (slot, v) in out.iter_mut().zip(value.split(',')) {
        if let Ok(v) = v.trim().parse() {
            *slot = v;
        }
    }
    out
}

fn join<T: ToString>(values: &[T]) -> String {
    values
        .iter()
        .map(T::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

impl Save {
    pub fn multiplier(&self) -> u32 {
        self.set + 1
    }

    /// Parse save text. Unknown keys and malformed values are ignored and
    /// out-of-range values are clamped, so a damaged file never crashes.
    pub fn parse(text: &str) -> Self {
        let mut s = Self::default();
        for line in text.lines() {
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            let value = value.trim();
            match key.trim() {
                "best" => s.best = value.parse().unwrap_or(s.best),
                "coins" => s.coins = value.parse().unwrap_or(s.coins),
                "set" => s.set = value.parse().unwrap_or(s.set).min(MAX_SET),
                "progress" => s.progress = parse_list(value, s.progress),
                "done" => s.done = value.parse().unwrap_or(s.done) & 0b111,
                "upgrades" => {
                    s.upgrades = parse_list(value, s.upgrades).map(|l| l.min(MAX_UPGRADE))
                }
                "owned" => s.owned = value.parse().unwrap_or(s.owned) | 1,
                "outfit" => s.outfit = value.parse().unwrap_or(s.outfit),
                "boards" => s.boards = value.parse().unwrap_or(s.boards),
                "music" => s.music = value.parse().unwrap_or(s.music).min(MAX_VOLUME),
                "sfx" => s.sfx = value.parse().unwrap_or(s.sfx).min(MAX_VOLUME),
                "scale" => s.scale = value.parse().unwrap_or(s.scale).clamp(1, MAX_SCALE),
                "fullscreen" => s.fullscreen = value == "true",
                "lang" => s.lang = Lang::from_code(value).unwrap_or(s.lang),
                _ => {}
            }
        }
        s.owned &= (1 << OUTFITS.len()) - 1;
        if s.outfit as usize >= OUTFITS.len() || s.owned & (1 << s.outfit) == 0 {
            s.outfit = 0;
        }
        s
    }

    pub fn serialize(&self) -> String {
        format!(
            "best={}\ncoins={}\nset={}\nprogress={}\ndone={}\nupgrades={}\nowned={}\noutfit={}\nboards={}\n\
             music={}\nsfx={}\nscale={}\nfullscreen={}\nlang={}\n",
            self.best,
            self.coins,
            self.set,
            join(&self.progress),
            self.done,
            join(&self.upgrades),
            self.owned,
            self.outfit,
            self.boards,
            self.music,
            self.sfx,
            self.scale,
            self.fullscreen,
            self.lang.code()
        )
    }

    #[cfg(target_arch = "wasm32")]
    pub fn load() -> Self {
        let mut save = crate::web::load()
            .map(|text| Self::parse(&text))
            .unwrap_or_default();
        if let Some(lang) = crate::web::language() {
            save.lang = lang;
        }
        save.fullscreen = false;
        save
    }

    #[cfg(target_arch = "wasm32")]
    pub fn store(&self) -> std::io::Result<()> {
        crate::web::store(&self.serialize());
        Ok(())
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn load() -> Self {
        file()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .map(|t| Self::parse(&t))
            .unwrap_or_default()
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn store(&self) -> std::io::Result<()> {
        let path = file().ok_or_else(|| std::io::Error::other("no config directory"))?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, self.serialize())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let s = Save {
            best: 12345,
            coins: 999,
            set: 4,
            progress: [3, 0, 120],
            done: 0b101,
            upgrades: [1, 2, 3, 5],
            owned: 0b1011,
            boards: 7,
            outfit: 3,
            music: 2,
            sfx: 10,
            scale: 5,
            fullscreen: true,
            lang: Lang::Zh,
        };
        assert_eq!(Save::parse(&s.serialize()), s);
    }

    #[test]
    fn empty_or_garbage_gives_defaults() {
        assert_eq!(Save::parse(""), Save::default());
        assert_eq!(Save::parse("nonsense\n=\nbest=abc\n"), Save::default());
    }

    #[test]
    fn values_are_clamped() {
        let s = Save::parse("music=99\nsfx=200\nscale=0\nset=500\nupgrades=9,1,x,2\n");
        assert_eq!((s.music, s.sfx, s.scale), (MAX_VOLUME, MAX_VOLUME, 1));
        assert_eq!(s.set, MAX_SET);
        assert_eq!(s.upgrades, [MAX_UPGRADE, 1, 0, 2]);
        assert_eq!(Save::parse("scale=42").scale, MAX_SCALE);
    }

    #[test]
    fn outfit_must_be_owned() {
        let s = Save::parse("owned=1\noutfit=2\n");
        assert_eq!(s.outfit, 0);
        let s = Save::parse("owned=0\n");
        assert_eq!(s.owned, 1, "the starter outfit is always owned");
    }

    #[test]
    fn tolerates_whitespace_and_unknown_keys() {
        let s = Save::parse(" best = 77 \nfuture_key=1\nfullscreen=true\n");
        assert_eq!(s.best, 77);
        assert!(s.fullscreen);
    }
}
