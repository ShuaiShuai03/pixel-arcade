//! Small seeded xorshift64* PRNG, so runs and tests are reproducible.

#[derive(Clone)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed.max(1))
    }

    pub fn next_u32(&mut self) -> u32 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        (self.0.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 32) as u32
    }

    /// Uniform integer in `0..n` (n > 0).
    pub fn below(&mut self, n: u32) -> u32 {
        self.next_u32() % n
    }

    /// Uniform float in [-1, 1].
    pub fn unit(&mut self) -> f32 {
        self.below(2001) as f32 / 1000.0 - 1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_and_in_range() {
        let (mut a, mut b) = (Rng::new(7), Rng::new(7));
        for _ in 0..100 {
            let v = a.below(5);
            assert_eq!(v, b.below(5));
            assert!(v < 5);
            assert!((-1.0..=1.0).contains(&a.unit()));
            b.unit();
        }
    }
}
