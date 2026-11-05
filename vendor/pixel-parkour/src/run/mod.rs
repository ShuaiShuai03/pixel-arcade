//! One run: the runner on the track, power-ups, the chaser drone, scoring,
//! crashes and revives. Pure logic; drawing lives in `render`.

pub mod autopilot;
pub mod runner;
pub mod track;

use crate::particles::Particles;
use crate::rng::Rng;
use macroquad::math::{Vec3, vec3};
use runner::{Controls, GLIDE_Y, HitKind, JUMP_V, Runner, SPRING_V, run_speed};
use track::{LANES, Power, Track, lane_x};

/// Track is generated this far ahead of the runner.
pub const VIEW_AHEAD: f32 = 160.0;
/// And kept this far behind it.
pub const KEEP_BEHIND: f32 = 15.0;
/// After a stumble the drone stays close this long; a second stumble in that
/// window means it catches you.
pub const CHASE_TIME: f32 = 6.0;
/// Time the crash plays out before the revive prompt.
pub const DOWN_TIME: f32 = 1.2;
/// Grace period after a revive, a board break, or landing from a glide.
pub const GRACE: f32 = 1.5;
const MAGNET_RANGE: f32 = 14.0;
const MAGNET_PULL: f32 = 30.0;

/// Power-up upgrade levels (0..=MAX_UPGRADE) for magnet, glider, spring, double.
pub const MAX_UPGRADE: u8 = 5;

/// How long a power-up lasts at an upgrade level.
pub fn duration(power: Power, level: u8) -> f32 {
    let l = level as f32;
    match power {
        Power::Magnet => 10.0 + 2.0 * l,
        Power::Glider => 7.0 + 1.5 * l,
        Power::Spring => 10.0 + 2.0 * l,
        Power::Double => 12.0 + 3.0 * l,
        Power::Board => 30.0,
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Event {
    Jump,
    Roll,
    Move,
    Land(f32),
    Coin,
    PowerUp(Power),
    Stumble,
    BoardBreak,
    Smash,
    Crash,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Phase {
    Running,
    /// Crashed (or caught); seconds since.
    Down(f32),
    Over,
}

/// Per-run counters for missions.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Stats {
    pub jumps: u32,
    pub rolls: u32,
    pub moves: u32,
    pub coins: u32,
    pub powerups: u32,
    pub stumbles: u32,
    pub roof_meters: f32,
}

#[derive(Clone)]
pub struct Run {
    pub runner: Runner,
    pub track: Track,
    pub speed: f32,
    pub coins: u32,
    pub score: f64,
    /// Permanent multiplier from missions.
    pub multiplier: u32,
    /// Time left on each power-up, indexed like `track::POWERS`.
    pub timers: [f32; 5],
    upgrades: [u8; 4],
    pub grace: f32,
    /// Time left with the drone close behind.
    pub chase: f32,
    /// Distance the drone trails the runner (drawn).
    pub drone_gap: f32,
    pub phase: Phase,
    pub caught: bool,
    pub events: Vec<Event>,
    pub stats: Stats,
    pub revives: u32,
    pub particles: Particles,
    pub shake: f32,
    pub time: f32,
    rng: Rng,
    next_glide_coin: f32,
    glide_lane: i32,
}

impl Run {
    pub fn new(seed: u64, multiplier: u32, upgrades: [u8; 4]) -> Self {
        let mut track = Track::new(seed);
        track.fill_to(VIEW_AHEAD);
        Self {
            runner: Runner::new(),
            track,
            speed: run_speed(0.0),
            coins: 0,
            score: 0.0,
            multiplier: multiplier.max(1),
            timers: [0.0; 5],
            upgrades,
            grace: 0.0,
            chase: 0.0,
            // The drone starts right behind and falls back as the run begins.
            drone_gap: 2.0,
            phase: Phase::Running,
            caught: false,
            events: Vec::new(),
            stats: Stats::default(),
            revives: 0,
            particles: Particles::new(seed),
            shake: 0.0,
            time: 0.0,
            rng: Rng::new(seed ^ 0x5eed),
            next_glide_coin: 0.0,
            glide_lane: 1,
        }
    }

    pub fn meters(&self) -> u32 {
        self.runner.z.max(0.0) as u32
    }

    pub fn score(&self) -> u32 {
        self.score as u32
    }

    pub fn timer(&self, p: Power) -> f32 {
        self.timers[p as usize]
    }

    pub fn active(&self, p: Power) -> bool {
        self.timer(p) > 0.0
    }

    /// Current score multiplier including the double-score power-up.
    pub fn total_multiplier(&self) -> u32 {
        self.multiplier * if self.active(Power::Double) { 2 } else { 1 }
    }

    /// Duration at the player's upgrade level (the board is not upgradable).
    pub fn full_duration(&self, p: Power) -> f32 {
        let level = self.upgrades.get(p as usize).copied().unwrap_or(0);
        duration(p, level)
    }

    pub fn update(&mut self, c: Controls, dt: f32) {
        self.events.clear();
        self.time += dt;
        self.particles.update(dt);
        self.shake = (self.shake - dt * 3.0).max(0.0);
        match self.phase {
            Phase::Running => self.update_running(c, dt),
            Phase::Down(t) => {
                // The drone swoops in on whoever stopped.
                self.drone_gap += (0.6 - self.drone_gap) * (6.0 * dt).min(1.0);
                self.phase = Phase::Down(t + dt);
            }
            Phase::Over => {}
        }
    }

    /// True once the crash has played out and the run can be revived or ended.
    pub fn awaiting_revive(&self) -> bool {
        matches!(self.phase, Phase::Down(t) if t >= DOWN_TIME)
    }

    fn update_running(&mut self, c: Controls, dt: f32) {
        self.speed = run_speed(self.runner.z);
        for t in &mut self.timers {
            *t = (*t - dt).max(0.0);
        }
        let was_gliding = self.active(Power::Glider);
        self.grace = (self.grace - dt).max(0.0);
        self.chase = (self.chase - dt).max(0.0);

        let jump_v = if self.active(Power::Spring) {
            SPRING_V
        } else {
            JUMP_V
        };
        let z0 = self.runner.z;
        let step = self
            .runner
            .step(c, dt, self.speed, &self.track, jump_v, was_gliding);
        let dz = self.runner.z - z0;
        self.score += (dz * self.total_multiplier() as f32) as f64;

        let feet = vec3(self.runner.x, self.runner.y, self.runner.z);
        if step.moved {
            self.stats.moves += 1;
            self.events.push(Event::Move);
        }
        if step.jumped {
            self.stats.jumps += 1;
            self.events.push(Event::Jump);
            self.particles.dust(feet);
        }
        if step.rolled {
            self.stats.rolls += 1;
            self.events.push(Event::Roll);
        }
        if let Some(v) = step.landed {
            self.events.push(Event::Land(v));
            if v > 6.0 {
                self.particles.dust(feet);
            }
        }
        if self.runner.grounded && self.runner.y > 1.0 {
            self.stats.roof_meters += dz;
        }
        if let Some((i, kind)) = step.hit {
            self.on_hit(i, kind);
        }

        if was_gliding && !self.active(Power::Glider) {
            self.grace = self.grace.max(GRACE);
        }
        if self.active(Power::Glider) {
            self.lay_glide_coins();
        }
        self.collect(dt);

        let gap = if self.chase > 0.0 { 2.4 } else { 16.0 };
        self.drone_gap += (gap - self.drone_gap) * (1.5 * dt).min(1.0);

        self.track.update_trains(self.runner.z, dt);
        self.track.fill_to(self.runner.z + VIEW_AHEAD);
        self.track.trim_before(self.runner.z - KEEP_BEHIND);
    }

    fn on_hit(&mut self, i: usize, kind: HitKind) {
        let center = vec3(self.runner.x, self.runner.y + 1.0, self.runner.z + 0.5);
        match kind {
            HitKind::Stumble => {
                self.stats.stumbles += 1;
                self.shake = self.shake.max(0.4);
                if self.chase > 0.0 && self.grace <= 0.0 {
                    self.caught = true;
                    self.crash();
                } else {
                    self.chase = CHASE_TIME;
                    self.events.push(Event::Stumble);
                }
            }
            HitKind::Crash if self.grace > 0.0 => {
                self.track.obstacles[i].broken = true;
                self.particles.debris(center, self.track.obstacles[i].color);
                self.events.push(Event::Smash);
            }
            HitKind::Crash if self.active(Power::Board) => {
                self.timers[Power::Board as usize] = 0.0;
                self.track.obstacles[i].broken = true;
                self.grace = GRACE;
                self.shake = 0.6;
                self.particles.board_break(center);
                self.events.push(Event::BoardBreak);
            }
            HitKind::Crash => self.crash(),
        }
    }

    fn crash(&mut self) {
        self.phase = Phase::Down(0.0);
        self.timers = [0.0; 5];
        self.shake = 1.0;
        self.particles.crash(vec3(
            self.runner.x,
            self.runner.y + 1.0,
            self.runner.z + 0.4,
        ));
        self.events.push(Event::Crash);
    }

    /// Continue after a crash: clear the way, brief invulnerability.
    pub fn revive(&mut self) {
        self.revives += 1;
        let z = self.runner.z;
        self.track.clear_range(z - 3.0, z + 30.0);
        self.runner.y = self.track.ground(self.runner.x, 0.35, z, 99.0, 99.0);
        self.runner.vy = 0.0;
        self.runner.grounded = true;
        self.chase = 0.0;
        self.caught = false;
        self.grace = GRACE * 2.0;
        self.phase = Phase::Running;
    }

    /// Start riding a hoverboard from the inventory. False if one is already
    /// active or the run is not going.
    pub fn use_board(&mut self) -> bool {
        if self.phase != Phase::Running || self.active(Power::Board) {
            return false;
        }
        self.timers[Power::Board as usize] = duration(Power::Board, 0);
        true
    }

    pub fn end(&mut self) {
        self.phase = Phase::Over;
    }

    /// While gliding, lay a weaving line of coins at flight height ahead.
    fn lay_glide_coins(&mut self) {
        let ahead = self.runner.z + 40.0;
        if self.next_glide_coin < self.runner.z {
            self.next_glide_coin = self.runner.z + 12.0;
        }
        let end = self.runner.z + self.timer(Power::Glider) * self.speed;
        while self.next_glide_coin < ahead.min(end) {
            if self.rng.below(12) == 0 {
                let d = if self.rng.below(2) == 0 { -1 } else { 1 };
                self.glide_lane = (self.glide_lane + d).clamp(0, LANES - 1);
            }
            let pos = vec3(lane_x(self.glide_lane), GLIDE_Y + 0.6, self.next_glide_coin);
            self.track.coin(pos);
            self.next_glide_coin += 1.5;
        }
    }

    fn collect(&mut self, dt: f32) {
        let r = &self.runner;
        let center = vec3(r.x, r.y + r.height() / 2.0, r.z);
        let magnet = self.active(Power::Magnet);
        let mut got = 0;
        for coin in &mut self.track.coins {
            if coin.taken {
                continue;
            }
            let d = center - coin.pos;
            if magnet && d.length() < MAGNET_RANGE && coin.pos.z > center.z - 1.0 {
                let pull = d.normalize_or_zero() * MAGNET_PULL * dt;
                coin.pos += if pull.length() > d.length() { d } else { pull };
            }
            if d.x.abs() < 0.9 && d.y.abs() < 1.4 && d.z.abs() < 0.9 {
                coin.taken = true;
                got += 1;
                self.particles.sparkle(coin.pos);
            }
        }
        for _ in 0..got {
            self.coins += 1;
            self.stats.coins += 1;
            self.events.push(Event::Coin);
        }
        let mut powers = Vec::new();
        for p in &mut self.track.pickups {
            let d = center - p.pos;
            if !p.taken && d.x.abs() < 1.0 && d.y.abs() < 1.6 && d.z.abs() < 1.0 {
                p.taken = true;
                powers.push((p.power, p.pos));
            }
        }
        for (power, pos) in powers {
            self.timers[power as usize] = self.full_duration(power);
            self.stats.powerups += 1;
            self.particles.sparkle(pos);
            self.events.push(Event::PowerUp(power));
        }
    }

    /// Point the drone hovers at (drawn behind the runner).
    pub fn drone_pos(&self) -> Vec3 {
        let r = &self.runner;
        let bob = (self.time * 3.0).sin() * 0.15;
        vec3(r.x * 0.8, r.y.max(0.0) + 1.9 + bob, r.z - self.drone_gap)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use track::{Kind, Obstacle, Pickup};

    const DT: f32 = 1.0 / 60.0;

    fn idle() -> Controls {
        Controls::default()
    }

    fn empty_run() -> Run {
        let mut r = Run::new(3, 1, [0; 4]);
        r.track = Track::new(3);
        r.track.end = 1e9;
        r
    }

    fn put(run: &mut Run, kind: Kind, lane: i32, z0: f32, z1: f32) {
        run.track.obstacles.push(Obstacle {
            kind,
            lane,
            z0,
            z1,
            color: 0,
            moving: false,
            broken: false,
        });
    }

    #[test]
    fn score_grows_with_distance_and_multiplier() {
        let mut a = empty_run();
        let mut b = Run::new(3, 3, [0; 4]);
        b.track = Track::new(3);
        b.track.end = 1e9;
        for _ in 0..120 {
            a.update(idle(), DT);
            b.update(idle(), DT);
        }
        assert!(a.score() > 15);
        assert!((b.score as f32 - 3.0 * a.score as f32).abs() < 3.0);
    }

    #[test]
    fn coins_are_collected_and_counted() {
        let mut r = empty_run();
        for i in 0..5 {
            r.track.coin(vec3(0.0, 0.8, 4.0 + i as f32 * 1.5));
        }
        for _ in 0..120 {
            r.update(idle(), DT);
        }
        assert_eq!(r.coins, 5);
        assert_eq!(r.stats.coins, 5);
    }

    #[test]
    fn magnet_pulls_coins_from_other_lanes() {
        let mut r = empty_run();
        r.timers[Power::Magnet as usize] = 10.0;
        r.track.coin(vec3(lane_x(0), 0.8, 8.0));
        r.track.coin(vec3(lane_x(2), 0.8, 9.0));
        for _ in 0..120 {
            r.update(idle(), DT);
        }
        assert_eq!(r.coins, 2);
    }

    #[test]
    fn pickup_starts_its_timer_with_upgrades() {
        let mut r = Run::new(3, 1, [2, 0, 0, 0]);
        r.track = Track::new(3);
        r.track.end = 1e9;
        r.track.pickups.push(Pickup {
            power: Power::Magnet,
            pos: vec3(0.0, 1.0, 3.0),
            taken: false,
        });
        for _ in 0..30 {
            r.update(idle(), DT);
        }
        assert!(r.timer(Power::Magnet) > duration(Power::Magnet, 1));
        assert_eq!(r.stats.powerups, 1);
    }

    #[test]
    fn crash_then_revive_clears_the_way() {
        let mut r = empty_run();
        put(&mut r, Kind::Block, 1, 5.0, 5.6);
        put(&mut r, Kind::Block, 1, 20.0, 20.6);
        for _ in 0..60 {
            r.update(idle(), DT);
        }
        assert!(matches!(r.phase, Phase::Down(_)));
        for _ in 0..((DOWN_TIME / DT) as u32 + 2) {
            r.update(idle(), DT);
        }
        assert!(r.awaiting_revive());
        r.revive();
        assert_eq!(r.phase, Phase::Running);
        for _ in 0..120 {
            r.update(idle(), DT);
        }
        assert_eq!(r.phase, Phase::Running, "the next block was cleared");
    }

    #[test]
    fn board_can_be_used_once_at_a_time() {
        let mut r = empty_run();
        assert!(r.use_board());
        assert!(!r.use_board());
        assert!(r.active(Power::Board));
    }

    #[test]
    fn board_absorbs_one_crash() {
        let mut r = empty_run();
        r.timers[Power::Board as usize] = 30.0;
        put(&mut r, Kind::Block, 1, 5.0, 5.6);
        put(&mut r, Kind::Block, 1, 60.0, 60.6);
        let mut broke = false;
        for _ in 0..400 {
            r.update(idle(), DT);
            broke |= r.events.contains(&Event::BoardBreak);
        }
        assert!(broke);
        assert!(matches!(r.phase, Phase::Down(_)), "second block crashes");
    }

    #[test]
    fn two_stumbles_in_a_row_get_you_caught() {
        let mut r = empty_run();
        put(&mut r, Kind::Train, 0, 0.0, 400.0);
        let left = Controls {
            left: true,
            ..Default::default()
        };
        r.update(left, DT);
        for _ in 0..10 {
            r.update(idle(), DT);
        }
        assert_eq!(r.phase, Phase::Running);
        assert!(r.chase > 0.0);
        r.update(left, DT);
        for _ in 0..10 {
            r.update(idle(), DT);
        }
        assert!(r.caught);
        assert!(matches!(r.phase, Phase::Down(_)));
    }

    #[test]
    fn glider_lays_coins_and_flies_over_trains() {
        let mut r = empty_run();
        r.timers[Power::Glider as usize] = 5.0;
        put(&mut r, Kind::Train, 1, 10.0, 60.0);
        for _ in 0..240 {
            r.update(idle(), DT);
        }
        assert_eq!(r.phase, Phase::Running);
        assert!(r.coins > 10, "collected the flight coins: {}", r.coins);
    }

    #[test]
    fn generated_track_stays_ahead_and_trims_behind() {
        let mut r = Run::new(11, 1, [0; 4]);
        r.grace = 1e9;
        for _ in 0..600 {
            r.update(idle(), DT);
            r.grace = 1e9;
        }
        assert!(r.track.end >= r.runner.z + VIEW_AHEAD);
        assert!(
            r.track
                .obstacles
                .iter()
                .all(|o| o.z1 > r.runner.z - KEEP_BEHIND - 1.0)
        );
    }

    #[test]
    fn autopilot_survives_long_runs() {
        for seed in [1, 2, 3, 4] {
            let mut run = Run::new(seed, 1, [0; 4]);
            let mut frame = 0u32;
            while run.meters() < 4000 {
                let c = if frame.is_multiple_of(4) {
                    autopilot::choose(&run)
                } else {
                    Controls::default()
                };
                run.update(c, DT);
                frame += 1;
                assert_eq!(
                    run.phase,
                    Phase::Running,
                    "seed {seed}: crashed at {}m",
                    run.meters()
                );
            }
            assert!(run.coins > 50, "seed {seed}: only {} coins", run.coins);
        }
    }
}
