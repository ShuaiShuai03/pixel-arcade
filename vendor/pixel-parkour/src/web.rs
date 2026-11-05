//! Browser bridge: local progress storage and accessible on-screen controls.

use std::sync::atomic::{AtomicU32, Ordering};

static PENDING: AtomicU32 = AtomicU32::new(0);

unsafe extern "C" {
    fn sapp_is_fullscreen() -> bool;
    fn parkour_save_length() -> usize;
    fn parkour_save_read(ptr: *mut u8, len: usize) -> usize;
    fn parkour_save_write(ptr: *const u8, len: usize) -> u32;
    fn parkour_language() -> i32;
    fn parkour_language_changed(code: u32);
    fn parkour_ready();
    fn parkour_exit();
}

#[unsafe(no_mangle)]
pub extern "C" fn parkour_browser_crate_version() -> u32 {
    1
}

/// Bits: up, down, left, right, confirm, back, board, pause-only.
#[unsafe(no_mangle)]
pub extern "C" fn parkour_action(action: u32) {
    PENDING.fetch_or(action & 255, Ordering::Relaxed);
}

/// Queue an explicit language; setting it twice cannot accidentally toggle back.
#[unsafe(no_mangle)]
pub extern "C" fn parkour_set_language(code: u32) {
    crate::i18n::queue_language(code);
}

pub fn language_changed(lang: crate::i18n::Lang) {
    unsafe {
        parkour_language_changed(lang as u32);
    }
}

/// The page reports both native fullscreen and its accessible CSS fallback.
pub fn is_fullscreen() -> bool {
    unsafe { sapp_is_fullscreen() }
}

pub fn take_actions() -> u32 {
    PENDING.swap(0, Ordering::Relaxed)
}

pub fn load() -> Option<String> {
    let len = unsafe { parkour_save_length() };
    if len == 0 || len > 65_536 {
        return None;
    }
    let mut bytes = vec![0; len];
    if unsafe { parkour_save_read(bytes.as_mut_ptr(), len) } != len {
        return None;
    }
    String::from_utf8(bytes).ok()
}

pub fn store(text: &str) {
    // Restricted browser storage is a supported mode: keep playing in memory.
    unsafe {
        parkour_save_write(text.as_ptr(), text.len());
    }
}

pub fn language() -> Option<crate::i18n::Lang> {
    match unsafe { parkour_language() } {
        0 => Some(crate::i18n::Lang::En),
        1 => Some(crate::i18n::Lang::Zh),
        _ => None,
    }
}

pub fn ready() {
    unsafe {
        parkour_ready();
    }
}

pub fn exit() {
    unsafe {
        parkour_exit();
    }
}
