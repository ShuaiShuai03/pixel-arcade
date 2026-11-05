//! The runner: lane switching, jumping, rolling, and collision with the
//! track. Pure logic, independent of rendering.

use super::track::{Aabb, LANES, TRAIN_SPEED, Track, lane_x};
use macroquad::math::vec3;

pub const SPEED_MIN: f32 = 11.0;
pub const SPEED_MAX: f32 = 23.0;
/// Speed gained per meter run.
pub const SPEED_RAMP: f32 = 0.004;

pub const HALF_W: f32 = 0.35;
pub const DEPTH: f32 = 0.3;
pub const STAND_H: f32 = 1.7;
pub const ROLL_H: f32 = 0.8;
pub const GRAVITY: f32 = 38.0;
pub const JUMP_V: f32 = 11.5;
/// Jump speed with spring shoes: high enough to land on a train roof.
pub const SPRING_V: f32 = 17.5;
/// Pressing roll in the air slams the runner down.
pub const DROP_V: f32 = -30.0;
pub const MAX_FALL: f32 = 40.0;
pub const ROLL_TIME: f32 = 0.6;
/// Sideways speed while changing lanes.
pub const LANE_SPEED: f32 = 16.0;
/// Highest ledge the runner walks up without jumping (ramps rise gradually).
pub const STEP: f32 = 0.6;
/// How long a jump or roll press is remembered before it can be used.
pub const BUFFER: f32 = 0.15;
/// Flight height while gliding.
pub const GLIDE_Y: f32 = 7.0;

pub fn run_speed(distance: f32) -> f32 {
    (SPEED_MIN + distance * SPEED_RAMP).min(SPEED_MAX)
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Controls {
    pub left: bool,
    pub right: bool,
    pub jump: bool,
    pub roll: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HitKind {
    /// Clipped something from the side: bounced back to the old lane.
    Stumble,
    /// Ran into something head-on.
    Crash,
}

/// What happened during one step.
#[derive(Clone, Copy, Debug, Default)]
pub struct Step {
    pub moved: bool,
    pub jumped: bool,
    pub rolled: bool,
    /// Landing speed, when the runner touched down this step.
    pub landed: Option<f32>,
    /// Index of the obstacle hit, and how.
    pub hit: Option<(usize, HitKind)>,
}

#[derive(Clone, Debug)]
pub struct Runner {
    pub lane: i32,
    from_lane: i32,
    pub x: f32,
    pub y: f32,
    pub vy: f32,
    pub z: f32,
    pub grounded: bool,
    /// Time left in the current roll.
    pub roll: f32,
    jump_buffer: f32,
    roll_buffer: f32,
    /// Running animation phase.
    pub anim: f32,
}

impl Runner {
    pub fn new() -> Self {
        Self {
            lane: 1,
            from_lane: 1,
            x: 0.0,
            y: 0.0,
            vy: 0.0,
            z: 0.0,
            grounded: true,
            roll: 0.0,
            jump_buffer: 0.0,
            roll_buffer: 0.0,
            anim: 0.0,
        }
    }

    pub fn rolling(&self) -> bool {
        self.roll > 0.0
    }

    pub fn height(&self) -> f32 {
        if self.rolling() { ROLL_H } else { STAND_H }
    }

    pub fn aabb(&self) -> Aabb {
        Aabb {
            min: vec3(self.x - HALF_W, self.y, self.z - DEPTH),
            max: vec3(self.x + HALF_W, self.y + self.height(), self.z + DEPTH),
        }
    }

    /// Advance one fixed step. `jump_v` is the jump speed (higher with spring
    /// shoes); while `gliding` the runner flies above everything.
    pub fn step(
        &mut self,
        c: Controls,
        dt: f32,
        speed: f32,
        track: &Track,
        jump_v: f32,
        gliding: bool,
    ) -> Step {
        let mut out = Step::default();
        if c.left && self.lane > 0 {
            self.from_lane = self.lane;
            self.lane -= 1;
            out.moved = true;
        }
        if c.right && self.lane < LANES - 1 {
            self.from_lane = self.lane;
            self.lane += 1;
            out.moved = true;
        }
        self.jump_buffer = if c.jump {
            BUFFER
        } else {
            (self.jump_buffer - dt).max(0.0)
        };
        self.roll_buffer = if c.roll {
            BUFFER
        } else {
            (self.roll_buffer - dt).max(0.0)
        };

        let (px, py, pz) = (self.x, self.y, self.z);
        let tx = lane_x(self.lane);
        self.x += (tx - self.x).clamp(-LANE_SPEED * dt, LANE_SPEED * dt);
        self.z += speed * dt;
        self.anim += speed * dt;

        if gliding {
            self.y += (GLIDE_Y - self.y) * (4.0 * dt).min(1.0);
            self.vy = 0.0;
            self.grounded = false;
            self.roll = 0.0;
            self.jump_buffer = 0.0;
            self.roll_buffer = 0.0;
            return out;
        }

        if self.jump_buffer > 0.0 && self.grounded {
            self.vy = jump_v;
            self.grounded = false;
            self.roll = 0.0;
            self.jump_buffer = 0.0;
            out.jumped = true;
        }
        if self.roll_buffer > 0.0 && (self.grounded || self.vy > DROP_V) {
            if !self.grounded {
                self.vy = DROP_V;
            }
            self.roll = ROLL_TIME;
            self.roll_buffer = 0.0;
            out.rolled = true;
        }
        self.roll = (self.roll - dt).max(0.0);

        self.vy = (self.vy - GRAVITY * dt).max(-MAX_FALL);
        self.y += self.vy * dt;

        // Solid obstacles. Tops the runner was already above count as ground.
        let me = self.aabb();
        for (i, o) in track.obstacles.iter().enumerate() {
            let Some(b) = o.solid() else { continue };
            if !b.overlaps(&me) || py >= b.max.y - STEP {
                continue;
            }
            let moved = if o.moving { TRAIN_SPEED * dt } else { 0.0 };
            let head_on = pz + DEPTH <= b.min.z + moved + 0.05;
            if head_on {
                out.hit = Some((i, HitKind::Crash));
            } else {
                self.lane = self.from_lane;
                self.x = px;
                out.hit = Some((i, HitKind::Stumble));
            }
            break;
        }

        // Ground: the highest surface underneath that the runner could reach.
        let ground = track.ground(self.x, HALF_W, self.z, self.y.max(py), STEP);
        if self.y <= ground {
            if !self.grounded {
                out.landed = Some(-self.vy);
            }
            self.y = ground;
            self.vy = self.vy.max(0.0);
            self.grounded = true;
        } else if self.grounded {
            // Walked off an edge (end of a train roof).
            self.grounded = false;
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run::track::{Kind, Obstacle, TRAIN_H};

    const DT: f32 = 1.0 / 60.0;

    fn track_with(obstacles: &[(Kind, i32, f32, f32)]) -> Track {
        let mut t = Track::new(1);
        for &(kind, lane, z0, z1) in obstacles {
            t.obstacles.push(Obstacle {
                kind,
                lane,
                z0,
                z1,
                color: 0,
                moving: false,
                broken: false,
            });
        }
        t
    }

    /// Run with a control script (`press(frame)`) until `frames` pass or a
    /// hit happens.
    fn run(
        r: &mut Runner,
        t: &Track,
        frames: u32,
        press: impl Fn(u32) -> Controls,
    ) -> Option<HitKind> {
        for f in 0..frames {
            let s = r.step(press(f), DT, SPEED_MIN, t, JUMP_V, false);
            if let Some((_, h)) = s.hit {
                return Some(h);
            }
        }
        None
    }

    fn idle(_: u32) -> Controls {
        Controls::default()
    }

    #[test]
    fn lane_change_reaches_neighbour_quickly() {
        let t = track_with(&[]);
        let mut r = Runner::new();
        run(&mut r, &t, 1, |_| Controls {
            left: true,
            ..Default::default()
        });
        run(&mut r, &t, 12, idle);
        assert_eq!(r.lane, 0);
        assert_eq!(r.x, lane_x(0));
    }

    #[test]
    fn lanes_are_clamped() {
        let t = track_with(&[]);
        let mut r = Runner::new();
        let right = |_| Controls {
            right: true,
            ..Default::default()
        };
        run(&mut r, &t, 5, right);
        assert_eq!(r.lane, LANES - 1);
    }

    #[test]
    fn jump_clears_a_hurdle_and_standing_does_not() {
        let t = track_with(&[(Kind::Hurdle, 1, 6.0, 6.4)]);
        let mut r = Runner::new();
        assert_eq!(run(&mut r, &t, 120, idle), Some(HitKind::Crash));

        let mut r = Runner::new();
        // Jump about 3 m before the hurdle.
        let jump_at = ((3.0 / SPEED_MIN) / DT) as u32;
        let hit = run(&mut r, &t, 120, |f| Controls {
            jump: f == jump_at,
            ..Default::default()
        });
        assert_eq!(hit, None);
        assert!(r.z > 10.0);
    }

    #[test]
    fn roll_passes_under_a_bar() {
        let t = track_with(&[(Kind::Bar, 1, 6.0, 6.4)]);
        let mut r = Runner::new();
        assert_eq!(run(&mut r, &t, 120, idle), Some(HitKind::Crash));
        let mut r = Runner::new();
        let hit = run(&mut r, &t, 120, |f| Controls {
            roll: f == 10,
            ..Default::default()
        });
        assert_eq!(hit, None);
    }

    #[test]
    fn jump_apex_is_below_a_train_without_springs() {
        let apex = JUMP_V * JUMP_V / (2.0 * GRAVITY);
        assert!(apex > 1.3 && apex < TRAIN_H - STEP);
        let spring_apex = SPRING_V * SPRING_V / (2.0 * GRAVITY);
        assert!(spring_apex > TRAIN_H + 0.5);
    }

    #[test]
    fn ramp_leads_onto_the_roof_and_off_the_end() {
        let t = track_with(&[(Kind::Ramp, 1, 3.0, 9.0), (Kind::Train, 1, 9.0, 21.0)]);
        let mut r = Runner::new();
        let mut on_roof = false;
        for _ in 0..180 {
            let s = r.step(Controls::default(), DT, SPEED_MIN, &t, JUMP_V, false);
            assert!(s.hit.is_none(), "hit at z={}", r.z);
            if r.z > 12.0 && r.z < 20.0 {
                on_roof |= r.grounded && (r.y - TRAIN_H).abs() < 1e-3;
            }
        }
        assert!(on_roof);
        assert!(r.grounded && r.y == 0.0, "back on the track after the end");
    }

    #[test]
    fn running_into_a_train_front_crashes() {
        let t = track_with(&[(Kind::Train, 1, 5.0, 20.0)]);
        let mut r = Runner::new();
        assert_eq!(run(&mut r, &t, 120, idle), Some(HitKind::Crash));
    }

    #[test]
    fn spring_jump_lands_on_a_train() {
        let t = track_with(&[(Kind::Train, 1, 8.0, 40.0)]);
        let mut r = Runner::new();
        for f in 0..120 {
            let c = Controls {
                jump: f == 5,
                ..Default::default()
            };
            let s = r.step(c, DT, SPEED_MIN, &t, SPRING_V, false);
            assert!(s.hit.is_none());
        }
        assert!(r.grounded && (r.y - TRAIN_H).abs() < 1e-3);
    }

    #[test]
    fn side_swipe_into_a_train_stumbles_back() {
        let t = track_with(&[(Kind::Train, 0, 0.0, 60.0)]);
        let mut r = Runner::new();
        r.z = 10.0;
        let hit = run(&mut r, &t, 20, |f| Controls {
            left: f == 0,
            ..Default::default()
        });
        assert_eq!(hit, Some(HitKind::Stumble));
        assert_eq!(r.lane, 1);
    }

    #[test]
    fn roll_in_the_air_drops_fast() {
        let t = track_with(&[]);
        let mut r = Runner::new();
        run(&mut r, &t, 10, |f| Controls {
            jump: f == 0,
            ..Default::default()
        });
        assert!(!r.grounded);
        let s = r.step(
            Controls {
                roll: true,
                ..Default::default()
            },
            DT,
            SPEED_MIN,
            &t,
            JUMP_V,
            false,
        );
        assert!(s.rolled);
        run(&mut r, &t, 6, idle);
        assert!(r.grounded);
        assert!(r.rolling());
    }

    #[test]
    fn jump_is_buffered_before_landing() {
        let t = track_with(&[]);
        let mut r = Runner::new();
        r.y = 0.3;
        r.grounded = false;
        let s = r.step(
            Controls {
                jump: true,
                ..Default::default()
            },
            DT,
            SPEED_MIN,
            &t,
            JUMP_V,
            false,
        );
        assert!(!s.jumped);
        let mut jumped = false;
        for _ in 0..8 {
            jumped |= r
                .step(Controls::default(), DT, SPEED_MIN, &t, JUMP_V, false)
                .jumped;
        }
        assert!(jumped);
    }

    #[test]
    fn gliding_ignores_obstacles() {
        let t = track_with(&[(Kind::Block, 1, 2.0, 2.6)]);
        let mut r = Runner::new();
        for _ in 0..60 {
            let s = r.step(Controls::default(), DT, SPEED_MIN, &t, JUMP_V, true);
            assert!(s.hit.is_none());
        }
        assert!(r.y > GLIDE_Y - 1.0);
    }

    #[test]
    fn speed_ramps_and_caps() {
        assert_eq!(run_speed(0.0), SPEED_MIN);
        assert!(run_speed(1000.0) > run_speed(500.0));
        assert_eq!(run_speed(1e6), SPEED_MAX);
    }
}
