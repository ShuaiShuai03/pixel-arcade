//! The runner: lane switching, jumping, rolling, and collision with the
//! track. Pure logic, independent of rendering.

use super::track::{Aabb, Kind, LANES, TRAIN_SPEED, TRAIN_TRIGGER, Track, lane_x, sweep_point};
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
    /// Time consumed before contact (the full dt when unobstructed).
    pub elapsed: f32,
    /// Foot positions along the continuous approach segment.
    pub path_start: macroquad::math::Vec3,
    /// Endpoint before any posture change at the interval boundary.
    pub path_end: macroquad::math::Vec3,
    /// Collision/pickup height during this interval, before a roll expires.
    pub body_height: f32,
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

    /// Recovery never replays a buffered pre-crash action.
    pub fn clear_actions(&mut self) {
        self.jump_buffer = 0.0;
        self.roll_buffer = 0.0;
        self.roll = 0.0;
        self.from_lane = self.lane;
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
        if !dt.is_finite() || dt <= 0.0 {
            return out;
        }
        if c.left && !c.right && self.lane > 0 {
            self.from_lane = self.lane;
            self.lane -= 1;
            out.moved = true;
        }
        if c.right && !c.left && self.lane < LANES - 1 {
            self.from_lane = self.lane;
            self.lane += 1;
            out.moved = true;
        }
        self.jump_buffer = if c.jump { BUFFER } else { self.jump_buffer };
        self.roll_buffer = if c.roll { BUFFER } else { self.roll_buffer };

        out.elapsed = dt;
        let (px, pz) = (self.x, self.z);
        let was_grounded = self.grounded;
        let old_height = self.height();
        let tx = lane_x(self.lane);
        self.x += (tx - self.x).clamp(-LANE_SPEED * dt, LANE_SPEED * dt);
        self.z += speed * dt;
        self.anim += speed * dt;

        if gliding {
            if !was_grounded {
                self.y += (old_height - STAND_H) / 2.0;
            }
            out.path_start = vec3(px, self.y, pz);
            self.y += (GLIDE_Y - self.y) * (1.0 - (-4.0 * dt).exp());
            self.vy = 0.0;
            self.grounded = false;
            self.roll = 0.0;
            self.jump_buffer = 0.0;
            self.roll_buffer = 0.0;
            out.body_height = STAND_H;
            out.path_end = vec3(self.x, self.y, self.z);
            return out;
        }

        if self.jump_buffer > 0.0 && self.grounded {
            self.vy = jump_v;
            self.grounded = false;
            self.roll = 0.0;
            self.jump_buffer = 0.0;
            out.jumped = true;
        }
        if self.roll_buffer > 0.0 {
            // An unpowered air tuck changes posture, never vertical momentum.
            self.roll = ROLL_TIME;
            self.roll_buffer = 0.0;
            out.rolled = true;
        }
        if !was_grounded {
            self.y += (old_height - self.height()) / 2.0;
        }
        let py = self.y;
        out.path_start = vec3(px, py, pz);
        let initial_vy = self.vy;
        let initial_roll = self.roll;
        let final_vy = (initial_vy - GRAVITY * dt).max(-MAX_FALL);
        self.y += (initial_vy + final_vy) * 0.5 * dt;
        let body_height = self.height();
        out.body_height = body_height;
        let end = vec3(self.x, self.y, self.z);
        let start = vec3(px, py, pz);
        let delta = end - start;
        let mut earliest = 1.0;
        let mut ramp_ground = 0.0_f32;
        for (i, o) in track.obstacles.iter().enumerate() {
            let Some(b) = o.solid() else { continue };
            let moving = o.kind == Kind::Oncoming && (o.moving || o.z0 - pz < TRAIN_TRIGGER);
            let relative = delta + vec3(0.0, 0.0, if moving { TRAIN_SPEED * dt } else { 0.0 });
            if pz + relative.z.max(0.0) + DEPTH < b.min.z
                || pz + relative.z.min(0.0) - DEPTH > b.max.z
                || px.max(self.x) + HALF_W < b.min.x
                || px.min(self.x) - HALF_W > b.max.x
            {
                continue;
            }
            // A continuous ramp supports the leading foot as it reaches its
            // joined roof. This exception never applies to standalone solids.
            let ramp_join = self.grounded
                && track.obstacles.iter().any(|r| {
                    !r.broken
                        && r.kind == Kind::Ramp
                        && r.lane == o.lane
                        && (r.z1 - o.z0).abs() < 0.01
                        && pz >= r.z0
                        && pz <= r.z1
                        && r.surface(pz)
                            .is_some_and(|h| py >= h - 0.02 && py <= h + STEP)
                });
            if ramp_join
                && self.z + DEPTH >= o.z0
                && self.x + HALF_W > b.min.x
                && self.x - HALF_W < b.max.x
            {
                ramp_ground = ramp_ground.max(b.max.y);
                continue;
            }
            if py >= b.max.y - 0.001 {
                continue;
            }
            let min = b.min - vec3(HALF_W, body_height, DEPTH);
            let max = b.max + vec3(HALF_W, 0.0, DEPTH);
            if let Some(at) = sweep_point(start, relative, min, max)
                && at <= earliest
            {
                earliest = at;
                let front = pz + DEPTH <= b.min.z + 0.001;
                let side_entry = (self.x - px).abs() > 0.001
                    && (px + HALF_W <= b.min.x || px - HALF_W >= b.max.x);
                out.hit = Some((
                    i,
                    if front || !side_entry {
                        HitKind::Crash
                    } else {
                        HitKind::Stumble
                    },
                ));
            }
        }
        out.elapsed = dt * earliest;
        self.x = px + delta.x * earliest;
        self.y = py + delta.y * earliest;
        self.z = pz + delta.z * earliest;
        self.anim -= speed * (dt - out.elapsed);
        self.vy = (initial_vy - GRAVITY * out.elapsed).max(-MAX_FALL);
        self.roll = (initial_roll - out.elapsed).max(0.0);
        self.jump_buffer = (self.jump_buffer - out.elapsed).max(0.0);
        self.roll_buffer = (self.roll_buffer - out.elapsed).max(0.0);
        if matches!(out.hit, Some((_, HitKind::Stumble))) {
            // Contact reverses the lane target; position never rewinds.
            self.lane = self.from_lane;
        }
        // Ground is reached from above, or through a physically joined ramp.
        let ground = track
            .ground(self.x, HALF_W, self.z, self.y.max(py), STEP)
            .max(ramp_ground);
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
        out.path_end = vec3(self.x, self.y, self.z);
        if initial_roll > 0.0 && self.roll == 0.0 {
            let tucked_y = self.y;
            if !self.grounded {
                self.y -= (STAND_H - ROLL_H) / 2.0;
            }
            let standing = self.aabb();
            let blocked = track.obstacles.iter().enumerate().find_map(|(i, o)| {
                let b = o.solid()?;
                // Feet extending down onto a roof are a landing contact.
                let landing = o.kind != Kind::Bar
                    && !self.grounded
                    && tucked_y >= b.max.y - 0.001
                    && self.y <= b.max.y;
                (standing.min.x < b.max.x
                    && b.min.x < standing.max.x
                    && standing.min.y < b.max.y
                    && b.min.y < standing.max.y
                    && standing.min.z < b.max.z
                    && b.min.z < standing.max.z
                    && !landing)
                    .then_some(i)
            });
            if let Some(i) = blocked {
                // Keep the compact pose at the contact boundary. A shield can
                // clear the obstruction before the next attempt to stand.
                self.y = tucked_y;
                self.roll = f32::EPSILON;
                out.hit = Some((i, HitKind::Crash));
            } else if !self.grounded {
                let ground = track.ground(self.x, HALF_W, self.z, tucked_y, 0.0);
                if self.y <= ground {
                    self.y = ground;
                    self.vy = 0.0;
                    self.grounded = true;
                    out.landed = Some(-initial_vy);
                }
            }
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
    fn zero_and_invalid_steps_preserve_runner_and_ignore_controls() {
        let t = track_with(&[]);
        for dt in [0.0, -0.1, f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut r = Runner::new();
            let before = format!("{r:?}");
            let out = r.step(
                Controls {
                    left: true,
                    jump: true,
                    roll: true,
                    ..Default::default()
                },
                dt,
                SPEED_MIN,
                &t,
                JUMP_V,
                false,
            );
            assert_eq!(format!("{r:?}"), before, "dt={dt}");
            assert!(!out.moved && !out.jumped && !out.rolled && out.hit.is_none());
        }
    }

    #[test]
    fn opposing_lane_presses_are_neutral_even_at_edges() {
        let t = track_with(&[]);
        for lane in 0..LANES {
            let mut r = Runner::new();
            r.lane = lane;
            r.x = lane_x(lane);
            let out = r.step(
                Controls {
                    left: true,
                    right: true,
                    ..Default::default()
                },
                DT,
                SPEED_MIN,
                &t,
                JUMP_V,
                false,
            );
            assert!(!out.moved);
            assert_eq!(r.lane, lane);
            assert_eq!(r.x, lane_x(lane));
        }
    }

    #[test]
    fn partial_jump_cannot_step_up_through_a_solid_hurdle_front() {
        let t = track_with(&[(Kind::Hurdle, 1, 1.0, 1.4)]);
        let mut r = Runner::new();
        r.z = 0.65;
        r.y = 0.5;
        r.vy = 3.0;
        r.grounded = false;
        let out = r.step(Controls::default(), DT, SPEED_MIN, &t, JUMP_V, false);
        assert_eq!(out.hit, Some((0, HitKind::Crash)));
        assert!(r.y < 0.7, "cannot snap feet onto the hurdle top");
    }

    #[test]
    fn free_jump_trajectory_and_lane_shift_match_at_30_60_120_hz() {
        let t = track_with(&[]);
        let mut outcomes = Vec::new();
        for hz in [30, 60, 120] {
            let mut r = Runner::new();
            for frame in 0..hz * 2 / 5 {
                r.step(
                    Controls {
                        left: frame == 0,
                        jump: frame == 0,
                        ..Default::default()
                    },
                    1.0 / hz as f32,
                    SPEED_MIN,
                    &t,
                    JUMP_V,
                    false,
                );
            }
            outcomes.push((r.x, r.y, r.vy, r.z));
        }
        for a in &outcomes[1..] {
            let b = outcomes[0];
            assert!(
                (a.0 - b.0).abs() < 1e-4
                    && (a.1 - b.1).abs() < 1e-4
                    && (a.2 - b.2).abs() < 1e-4
                    && (a.3 - b.3).abs() < 1e-4,
                "{outcomes:?}"
            );
        }
    }

    #[test]
    fn fast_thin_solids_use_swept_contact_and_choose_the_nearest_first() {
        for reverse in [false, true] {
            let mut pieces = vec![(Kind::Block, 1, 0.4, 0.41), (Kind::Block, 1, 0.6, 0.61)];
            if reverse {
                pieces.reverse();
            }
            let t = track_with(&pieces);
            let mut r = Runner::new();
            let out = r.step(
                Controls::default(),
                1.0 / 30.0,
                SPEED_MAX,
                &t,
                JUMP_V,
                false,
            );
            assert_eq!(out.hit, Some((usize::from(reverse), HitKind::Crash)));
            assert!((r.z - 0.1).abs() < 1e-5);
            assert!((out.elapsed - 0.1 / SPEED_MAX).abs() < 1e-5);
        }
    }

    #[test]
    fn joined_ramp_and_roof_edges_are_supported_at_each_step_rate() {
        let t = track_with(&[(Kind::Ramp, 1, 3.0, 9.0), (Kind::Train, 1, 9.0, 21.0)]);
        for hz in [30, 60, 120] {
            let mut r = Runner::new();
            let mut roof = false;
            for _ in 0..hz * 3 {
                let step = r.step(
                    Controls::default(),
                    1.0 / hz as f32,
                    SPEED_MIN,
                    &t,
                    JUMP_V,
                    false,
                );
                assert!(step.hit.is_none(), "hz{hz} z{}", r.z);
                roof |= r.z > 10.0 && r.z < 20.0 && r.grounded && (r.y - TRAIN_H).abs() < 0.001;
            }
            assert!(roof && r.grounded && r.y == 0.0);
        }
    }

    #[test]
    fn landing_tucked_then_standing_and_jumping_from_roll_remain_valid() {
        let t = track_with(&[]);
        let mut r = Runner::new();
        let mut tucked_landing = false;
        for frame in 0..90 {
            let out = r.step(
                Controls {
                    jump: frame == 0,
                    roll: frame == 10,
                    ..Default::default()
                },
                DT,
                SPEED_MIN,
                &t,
                JUMP_V,
                false,
            );
            tucked_landing |= out.landed.is_some() && r.rolling();
        }
        assert!(tucked_landing && r.grounded && !r.rolling() && r.y == 0.0);
        r.step(
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
        let out = r.step(
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
        assert!(out.jumped && !r.grounded && r.y > 0.0 && r.vy > 0.0);
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
    fn air_tuck_and_expiry_preserve_ballistic_center_and_vertical_momentum() {
        let t = track_with(&[]);
        let mut normal = Runner::new();
        normal.y = 12.0;
        normal.vy = 3.0;
        normal.grounded = false;
        let mut tucked = normal.clone();
        for frame in 0..45 {
            normal.step(Controls::default(), DT, SPEED_MIN, &t, JUMP_V, false);
            let step = tucked.step(
                Controls {
                    roll: frame == 0,
                    ..Default::default()
                },
                DT,
                SPEED_MIN,
                &t,
                JUMP_V,
                false,
            );
            if !normal.grounded && !tucked.grounded {
                assert!((normal.vy - tucked.vy).abs() < 1e-5);
                assert!(
                    ((normal.y + normal.height() / 2.0) - (tucked.y + tucked.height() / 2.0)).abs()
                        < 1e-4,
                    "frame{frame}"
                );
            }
            if frame == 0 {
                assert!(step.rolled && tucked.vy > 0.0);
            }
        }
    }

    #[test]
    fn side_contact_retains_position_and_returns_at_finite_lane_speed() {
        let t = track_with(&[(Kind::Train, 0, -1.0, 60.0)]);
        let mut r = Runner::new();
        r.x = -0.9;
        let out = r.step(
            Controls {
                left: true,
                ..Default::default()
            },
            DT,
            SPEED_MIN,
            &t,
            JUMP_V,
            false,
        );
        assert_eq!(out.hit, Some((0, HitKind::Stumble)));
        assert!((r.x + 1.0).abs() < 1e-5);
        assert_eq!(r.lane, 1);
        let previous = r.x;
        let out = r.step(Controls::default(), DT, SPEED_MIN, &t, JUMP_V, false);
        assert!(out.hit.is_none());
        assert!(r.x > previous && r.x - previous <= LANE_SPEED * DT + 1e-5);
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
