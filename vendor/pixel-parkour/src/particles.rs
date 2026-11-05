//! Small cube particles (dust, sparkles, debris) in palette colors.

use crate::art::palette::{GRAY, LAVENDER, LIGHT_BLUE, ORANGE, RED, WHITE, YELLOW};
use crate::rng::Rng;
use macroquad::math::Vec3;

#[derive(Clone)]
pub struct Particle {
    pub pos: Vec3,
    vel: Vec3,
    gravity: f32,
    life: f32,
    pub color: u8,
    pub size: f32,
}

#[derive(Clone)]
pub struct Particles {
    pub list: Vec<Particle>,
    rng: Rng,
}

impl Particles {
    pub fn new(seed: u64) -> Self {
        Self {
            list: Vec::new(),
            rng: Rng::new(seed ^ 0x9e37_79b9),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn emit(
        &mut self,
        at: Vec3,
        n: usize,
        speed: f32,
        up: f32,
        gravity: f32,
        life: f32,
        colors: &[u8],
    ) {
        for i in 0..n {
            let vel = Vec3::new(self.rng.unit(), self.rng.unit() + up, self.rng.unit()) * speed;
            let size = if self.rng.below(3) == 0 { 0.2 } else { 0.12 };
            let life = life * (0.7 + 0.3 * (self.rng.unit() + 1.0));
            self.list.push(Particle {
                pos: at,
                vel,
                gravity,
                life,
                color: colors[i % colors.len()],
                size,
            });
        }
    }

    pub fn dust(&mut self, at: Vec3) {
        self.emit(at, 6, 1.5, 0.5, 4.0, 0.35, &[LAVENDER, GRAY]);
    }

    pub fn sparkle(&mut self, at: Vec3) {
        self.emit(at, 5, 2.0, 0.6, 3.0, 0.3, &[YELLOW, WHITE, ORANGE]);
    }

    pub fn board_break(&mut self, at: Vec3) {
        self.emit(at, 18, 5.0, 0.4, 8.0, 0.6, &[LIGHT_BLUE, WHITE]);
    }

    pub fn debris(&mut self, at: Vec3, color: u8) {
        self.emit(at, 14, 6.0, 0.6, 14.0, 0.7, &[color, GRAY, WHITE]);
    }

    pub fn crash(&mut self, at: Vec3) {
        self.emit(at, 24, 5.0, 0.8, 14.0, 0.8, &[RED, ORANGE, YELLOW, WHITE]);
    }

    pub fn update(&mut self, dt: f32) {
        for p in &mut self.list {
            p.vel.y -= p.gravity * dt;
            p.pos += p.vel * dt;
            p.life -= dt;
        }
        self.list.retain(|p| p.life > 0.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn particles_expire() {
        let mut p = Particles::new(1);
        p.crash(Vec3::ZERO);
        assert!(!p.list.is_empty());
        for _ in 0..120 {
            p.update(1.0 / 60.0);
        }
        assert!(p.list.is_empty());
    }
}
