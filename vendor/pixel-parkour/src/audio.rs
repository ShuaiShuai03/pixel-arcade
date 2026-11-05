//! Chiptune sound effects and music, synthesized at startup (square waves and
//! noise) and encoded as in-memory WAV files. No audio assets ship with the game.

use macroquad::audio::{
    PlaySoundParams, Sound, load_sound_from_bytes, play_sound, set_sound_volume,
};

/// quad-snd mixes at 44.1 kHz; matching it avoids resampling artifacts.
pub const RATE: u32 = 44_100;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sfx {
    Jump,
    Glide,
    Stumble,
    Roll,
    Land,
    Coin,
    PowerUp,
    Break,
    Crash,
    Move,
    Select,
    Swish,
}

const ALL_SFX: [Sfx; 12] = [
    Sfx::Jump,
    Sfx::Glide,
    Sfx::Stumble,
    Sfx::Roll,
    Sfx::Land,
    Sfx::Coin,
    Sfx::PowerUp,
    Sfx::Break,
    Sfx::Crash,
    Sfx::Move,
    Sfx::Select,
    Sfx::Swish,
];

/// Encode mono samples in [-1, 1] as a 16-bit PCM WAV file.
pub fn wav(samples: &[f32]) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&RATE.to_le_bytes());
    out.extend_from_slice(&(RATE * 2).to_le_bytes()); // byte rate
    out.extend_from_slice(&2u16.to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

fn samples_for(seconds: f32) -> usize {
    (seconds * RATE as f32) as usize
}

/// Square wave sweeping from `f0` to `f1` Hz with a linear fade-out.
fn square(f0: f32, f1: f32, seconds: f32, duty: f32, vol: f32) -> Vec<f32> {
    let n = samples_for(seconds);
    let mut phase = 0.0f32;
    (0..n)
        .map(|i| {
            let t = i as f32 / n as f32;
            phase = (phase + (f0 + (f1 - f0) * t) / RATE as f32).fract();
            let v = if phase < duty { 1.0 } else { -1.0 };
            v * vol * (1.0 - t)
        })
        .collect()
}

/// Deterministic white noise with a fade-out; `hold` > 1 lowers the pitch.
fn noise(seconds: f32, vol: f32, hold: usize) -> Vec<f32> {
    let n = samples_for(seconds);
    let mut state = 0x1234_5678u32;
    let mut current = 0.0;
    (0..n)
        .map(|i| {
            if i % hold.max(1) == 0 {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                current = (state as f32 / u32::MAX as f32) * 2.0 - 1.0;
            }
            current * vol * (1.0 - i as f32 / n as f32)
        })
        .collect()
}

fn concat(parts: &[Vec<f32>]) -> Vec<f32> {
    parts.concat()
}

/// Sum `b` into `a`, extending `a` if needed.
fn mix_into(a: &mut Vec<f32>, b: &[f32], offset: usize) {
    if a.len() < offset + b.len() {
        a.resize(offset + b.len(), 0.0);
    }
    for (i, s) in b.iter().enumerate() {
        a[offset + i] += s;
    }
}

pub fn synth(sfx: Sfx) -> Vec<f32> {
    match sfx {
        Sfx::Jump => square(300.0, 620.0, 0.12, 0.5, 0.25),
        Sfx::Glide => {
            let mut s = noise(0.5, 0.15, 2);
            mix_into(&mut s, &square(200.0, 900.0, 0.5, 0.25, 0.12), 0);
            s
        }
        Sfx::Stumble => concat(&[noise(0.05, 0.3, 6), square(300.0, 150.0, 0.12, 0.5, 0.25)]),
        Sfx::Roll => noise(0.18, 0.18, 8),
        Sfx::Land => noise(0.06, 0.25, 12),
        Sfx::Coin => concat(&[
            square(988.0, 988.0, 0.05, 0.5, 0.2),
            square(1319.0, 1319.0, 0.12, 0.5, 0.2),
        ]),
        Sfx::PowerUp => concat(&[
            square(523.0, 523.0, 0.06, 0.25, 0.22),
            square(659.0, 659.0, 0.06, 0.25, 0.22),
            square(784.0, 784.0, 0.06, 0.25, 0.22),
            square(1047.0, 1047.0, 0.14, 0.25, 0.22),
        ]),
        Sfx::Break => {
            let mut s = noise(0.25, 0.3, 3);
            mix_into(&mut s, &square(800.0, 200.0, 0.25, 0.5, 0.15), 0);
            s
        }
        Sfx::Crash => {
            let mut s = square(600.0, 60.0, 0.6, 0.5, 0.25);
            mix_into(&mut s, &noise(0.4, 0.2, 6), 0);
            s
        }
        Sfx::Move => square(660.0, 660.0, 0.04, 0.5, 0.15),
        Sfx::Select => concat(&[
            square(660.0, 660.0, 0.05, 0.5, 0.18),
            square(990.0, 990.0, 0.08, 0.5, 0.18),
        ]),
        Sfx::Swish => noise(0.08, 0.12, 2),
    }
}

fn midi_hz(note: u8) -> f32 {
    440.0 * 2f32.powf((note as f32 - 69.0) / 12.0)
}

/// Lead melody, one MIDI note per eighth (0 = rest); 8 bars.
const MELODY: [u8; 64] = [
    76, 0, 74, 76, 72, 0, 69, 72, // Am
    77, 0, 76, 74, 72, 0, 69, 0, // F
    72, 0, 74, 76, 79, 0, 76, 74, // C
    74, 0, 71, 72, 74, 0, 79, 0, // G
    76, 0, 74, 76, 81, 0, 79, 76, // Am
    77, 0, 76, 77, 81, 0, 77, 76, // F
    74, 0, 76, 74, 71, 0, 67, 71, // G
    68, 0, 71, 74, 76, 0, 0, 0, // E
];

/// Bass root per bar.
const BASS: [u8; 8] = [45, 41, 48, 43, 45, 41, 43, 40];

const BPM: f32 = 128.0;

/// A seamless 8-bar loop: square lead, square bass, noise hi-hats.
pub fn music() -> Vec<f32> {
    let eighth = 60.0 / BPM / 2.0;
    let step = samples_for(eighth);
    let mut out = vec![0.0; step * MELODY.len()];
    for (i, &note) in MELODY.iter().enumerate() {
        if note != 0 {
            let f = midi_hz(note);
            mix_into(&mut out, &square(f, f, eighth * 0.9, 0.25, 0.09), i * step);
        }
        let root = BASS[i / 8];
        let b = midi_hz(if i % 2 == 0 { root } else { root + 12 });
        mix_into(&mut out, &square(b, b, eighth * 0.8, 0.5, 0.07), i * step);
        let hat = if i % 2 == 1 { 0.05 } else { 0.025 };
        mix_into(&mut out, &noise(0.03, hat, 1), i * step);
    }
    out.truncate(step * MELODY.len());
    out
}

pub struct Audio {
    sounds: Vec<Sound>,
    music: Option<Sound>,
    sfx_volume: f32,
}

impl Audio {
    /// Synthesize and load everything. Sounds that fail to load (e.g. no
    /// audio device) are skipped so the game still runs silently.
    pub async fn load() -> Self {
        let mut sounds = Vec::with_capacity(ALL_SFX.len());
        for s in ALL_SFX {
            match load_sound_from_bytes(&wav(&synth(s))).await {
                Ok(snd) => sounds.push(snd),
                Err(e) => {
                    eprintln!("audio disabled: {e}");
                    return Self {
                        sounds: Vec::new(),
                        music: None,
                        sfx_volume: 0.0,
                    };
                }
            }
        }
        let music = load_sound_from_bytes(&wav(&music())).await.ok();
        Self {
            sounds,
            music,
            sfx_volume: 1.0,
        }
    }

    pub fn start_music(&self, volume: u8) {
        if let Some(m) = &self.music {
            play_sound(
                m,
                PlaySoundParams {
                    looped: true,
                    volume: volume as f32 / 10.0,
                },
            );
        }
    }

    pub fn set_volumes(&mut self, music: u8, sfx: u8) {
        self.sfx_volume = sfx as f32 / 10.0;
        if let Some(m) = &self.music {
            set_sound_volume(m, music as f32 / 10.0);
        }
    }

    pub fn play(&self, sfx: Sfx) {
        let Some(snd) = self.sounds.get(sfx as usize) else {
            return;
        };
        if self.sfx_volume > 0.0 {
            play_sound(
                snd,
                PlaySoundParams {
                    looped: false,
                    volume: self.sfx_volume,
                },
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_header_is_valid() {
        let w = wav(&[0.0, 1.0, -1.0]);
        assert_eq!(&w[0..4], b"RIFF");
        assert_eq!(&w[8..16], b"WAVEfmt ");
        assert_eq!(u32::from_le_bytes(w[4..8].try_into().unwrap()), 36 + 6);
        assert_eq!(u32::from_le_bytes(w[24..28].try_into().unwrap()), RATE);
        assert_eq!(&w[36..40], b"data");
        assert_eq!(w.len(), 44 + 6);
        assert_eq!(i16::from_le_bytes([w[46], w[47]]), i16::MAX);
    }

    #[test]
    fn every_sfx_is_short_and_in_range() {
        for (i, s) in ALL_SFX.iter().enumerate() {
            assert_eq!(*s as usize, i, "ALL_SFX order matches discriminants");
            let samples = synth(*s);
            assert!(!samples.is_empty());
            assert!(samples.len() < RATE as usize, "{s:?} is under a second");
            assert!(samples.iter().all(|v| v.abs() <= 1.0), "{s:?} clips");
        }
    }

    #[test]
    fn music_loop_has_expected_length_and_headroom() {
        let m = music();
        let expected = samples_for(60.0 / BPM / 2.0) * MELODY.len();
        assert_eq!(m.len(), expected);
        assert!(m.iter().all(|v| v.abs() < 1.0));
    }

    #[test]
    fn a4_is_440() {
        assert!((midi_hz(69) - 440.0).abs() < 1e-3);
    }
}
