//! Interface language. Every visible string is written as an English and
//! Simplified Chinese pair at its call site and picked with [`tr`].

use std::fmt::Display;
use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lang {
    En,
    Zh,
}

impl Lang {
    /// The language's own name, shown in settings.
    pub fn name(self) -> &'static str {
        match self {
            Lang::En => "ENGLISH",
            Lang::Zh => "中文",
        }
    }

    pub fn other(self) -> Lang {
        match self {
            Lang::En => Lang::Zh,
            Lang::Zh => Lang::En,
        }
    }

    /// Save-file code.
    pub fn code(self) -> &'static str {
        match self {
            Lang::En => "en",
            Lang::Zh => "zh",
        }
    }

    pub fn from_code(code: &str) -> Option<Lang> {
        match code {
            "en" => Some(Lang::En),
            "zh" => Some(Lang::Zh),
            _ => None,
        }
    }
}

static CURRENT: AtomicU8 = AtomicU8::new(0);

pub fn set(lang: Lang) {
    CURRENT.store(lang as u8, Ordering::Relaxed);
}

pub fn current() -> Lang {
    if CURRENT.load(Ordering::Relaxed) == Lang::Zh as u8 {
        Lang::Zh
    } else {
        Lang::En
    }
}

/// The string for the current language.
pub fn tr(en: &'static str, zh: &'static str) -> &'static str {
    match current() {
        Lang::En => en,
        Lang::Zh => zh,
    }
}

/// Replace each `{}` in `template` with the next argument.
pub fn fill(template: &str, args: &[&dyn Display]) -> String {
    let mut out = String::new();
    let mut args = args.iter();
    let mut rest = template;
    while let Some(i) = rest.find("{}") {
        out.push_str(&rest[..i]);
        if let Some(a) = args.next() {
            out.push_str(&a.to_string());
        }
        rest = &rest[i + 2..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fill_replaces_in_order() {
        assert_eq!(fill("{} OF {}", &[&1, &"TWO"]), "1 OF TWO");
        assert_eq!(fill("花费 {} 金币", &[&150]), "花费 150 金币");
        assert_eq!(fill("NONE", &[]), "NONE");
    }

    #[test]
    fn codes_round_trip() {
        for l in [Lang::En, Lang::Zh] {
            assert_eq!(Lang::from_code(l.code()), Some(l));
            assert_eq!(l.other().other(), l);
        }
        assert_eq!(Lang::from_code("xx"), None);
    }
}

/// A browser language request is applied by the frame loop, never during a callback.
#[cfg(any(target_arch = "wasm32", test))]
static PENDING_LANGUAGE: AtomicU8 = AtomicU8::new(2);

#[cfg(any(target_arch = "wasm32", test))]
pub fn queue_language(code: u32) {
    if code <= 1 {
        PENDING_LANGUAGE.store(code as u8, Ordering::Relaxed);
    }
}

#[cfg(any(target_arch = "wasm32", test))]
pub fn take_language() -> Option<Lang> {
    match PENDING_LANGUAGE.swap(2, Ordering::Relaxed) {
        0 => Some(Lang::En),
        1 => Some(Lang::Zh),
        _ => None,
    }
}

#[cfg(test)]
mod browser_language_tests {
    use super::*;
    #[test]
    fn explicit_language_queue_is_one_shot_and_rejects_invalid_codes() {
        assert_eq!(take_language(), None);
        queue_language(1);
        queue_language(99);
        assert_eq!(take_language(), Some(Lang::Zh));
        assert_eq!(take_language(), None);
        queue_language(1);
        queue_language(0);
        assert_eq!(take_language(), Some(Lang::En));
        assert_eq!(take_language(), None);
    }
}
