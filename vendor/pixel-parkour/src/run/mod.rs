//! One run: the runner on the track, power-ups, the chaser drone, scoring,
//! crashes and revives. Pure logic; drawing lives in `render`.

pub mod autopilot;
pub mod runner;
pub mod track;

use crate::particles::Particles;
use crate::rng::Rng;
use macroquad::math::{Vec3, vec3};
use runner::{Controls, GLIDE_Y, HitKind, JUMP_V, Runner, SPRING_V, Step, run_speed};
use track::{LANES, Power, Track, lane_x, sweep_point};

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

#[derive(Clone, Copy, Debug)]
enum PickupTarget {
    Coin(usize),
    Power(usize),
}
#[derive(Clone, Copy, Debug)]
struct PickupEntry {
    fraction: f32,
    target: PickupTarget,
}

/// One chronological approach segment. Pickup and magnet motion use the same
/// segment as solid contacts, including the path before a lateral bounce.
struct PickupMotion {
    start: Vec3,
    end: Vec3,
    seconds: f32,
    magnet: bool,
}
impl PickupMotion {
    fn from_step(step: &Step, magnet: bool) -> Self {
        Self {
            start: step.path_start + vec3(0.0, step.body_height / 2.0, 0.0),
            end: step.path_end + vec3(0.0, step.body_height / 2.0, 0.0),
            seconds: step.elapsed,
            magnet,
        }
    }
    fn stationary(center: Vec3, magnet: bool) -> Self {
        Self {
            start: center,
            end: center,
            seconds: 0.0,
            magnet,
        }
    }
    fn coin_velocity(&self, pos: Vec3) -> Vec3 {
        let d = self.start - pos;
        if self.magnet && d.length() < MAGNET_RANGE && pos.z > self.start.z - 1.0 {
            d.normalize_or_zero() * MAGNET_PULL
        } else {
            Vec3::ZERO
        }
    }
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
        if !dt.is_finite() || dt <= 0.0 {
            return;
        }
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
        let mut remaining = dt;
        let mut controls = c;
        // Inputs are one-shot. Event splits carry the runner's buffers/target,
        // never replay the press. Fixed steps split only at observable events.
        let r = &self.runner;
        let initial = PickupMotion::stationary(
            vec3(r.x, r.y + r.height() / 2.0, r.z),
            self.active(Power::Magnet),
        );
        self.collect(&initial, false);
        while remaining > 0.0 && self.phase == Phase::Running {
            self.speed = run_speed(self.runner.z);
            let mut slice = remaining.min(crate::STEP);
            for timer in self
                .timers
                .into_iter()
                .chain([self.grace, self.chase, self.runner.roll])
            {
                if timer > 0.0 {
                    slice = slice.min(timer);
                }
            }
            let magnet = self.active(Power::Magnet);
            let gliding = self.active(Power::Glider);
            let jump_v = if self.active(Power::Spring) {
                SPRING_V
            } else {
                JUMP_V
            };
            let before = self.runner.clone();
            let multiplier = self.total_multiplier();
            let mut step =
                self.runner
                    .step(controls, slice, self.speed, &self.track, jump_v, gliding);
            // Pickups strictly before a solid contact are handled first. At an
            // exact tie the solid wins; a later pickup cannot undo a fatal hit.
            let mut pending_pickup = None;
            if let Some(entry) = self.first_pickup_entry(&PickupMotion::from_step(&step, magnet)) {
                if entry.fraction == 0.0 && step.elapsed > 0.0 {
                    self.runner = before;
                    self.resolve_pickup(entry.target);
                    continue;
                }
                if (entry.fraction < 1.0 || step.hit.is_none()) && step.elapsed > 0.0 {
                    self.runner = before.clone();
                    let earlier = step.elapsed * entry.fraction;
                    if earlier == 0.0 {
                        self.resolve_pickup(entry.target);
                        continue;
                    }
                    step = self.runner.step(
                        controls,
                        earlier,
                        self.speed,
                        &self.track,
                        jump_v,
                        gliding,
                    );
                    // The predicted event identity is carried through resolution.
                    // A rounded world position must not repeatedly rediscover
                    // a positive entry time smaller than one position ULP.
                    if step.hit.is_none() {
                        pending_pickup = Some(entry.target);
                    }
                }
            }
            controls = Controls::default();
            let elapsed = step.elapsed;
            let dz = self.runner.z - before.z;
            self.score += (dz * multiplier as f32) as f64;
            for t in &mut self.timers {
                *t = (*t - elapsed).max(0.0);
            }
            self.grace = (self.grace - elapsed).max(0.0);
            self.chase = (self.chase - elapsed).max(0.0);
            if gliding && !self.active(Power::Glider) {
                self.grace = self.grace.max(GRACE);
            }
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
            self.track.update_trains(before.z, elapsed);
            if let Some((i, kind)) = step.hit {
                self.on_hit(i, kind);
            }
            if self.phase != Phase::Running {
                // A crash consumes the rest of this frame as down-time, not
                // extra running distance or an unaccounted pause in the clock.
                self.phase = Phase::Down((remaining - elapsed).max(0.0));
                break;
            }
            if self.active(Power::Glider) {
                self.lay_glide_coins();
            }
            self.collect(&PickupMotion::from_step(&step, magnet), true);
            if let Some(target) = pending_pickup {
                self.resolve_pickup(target);
            }
            let gap = if self.chase > 0.0 { 2.4 } else { 16.0 };
            self.drone_gap += (gap - self.drone_gap) * (1.5 * elapsed).min(1.0);
            self.track.fill_to(self.runner.z + VIEW_AHEAD);
            self.track.trim_before(self.runner.z - KEEP_BEHIND);
            remaining = (remaining - elapsed).max(0.0);
            // A zero-time impact always changes an obstacle, lane target or
            // phase; the next iteration can therefore consume the remainder.
        }
    }

    fn first_pickup_entry(&self, motion: &PickupMotion) -> Option<PickupEntry> {
        let path = motion.end - motion.start;
        let coins = self
            .track
            .coins
            .iter()
            .enumerate()
            .filter(|(_, c)| !c.taken)
            .map(|(i, c)| {
                (
                    PickupTarget::Coin(i),
                    c.pos,
                    vec3(0.9, 1.4, 0.9),
                    path - motion.coin_velocity(c.pos) * motion.seconds,
                )
            });
        let powers = self
            .track
            .pickups
            .iter()
            .enumerate()
            .filter(|(_, p)| !p.taken)
            .map(|(i, p)| (PickupTarget::Power(i), p.pos, vec3(1.0, 1.6, 1.0), path));
        coins
            .chain(powers)
            .filter(|(_, pos, radius, delta)| {
                pos.z - radius.z <= motion.start.z.max(motion.start.z + delta.z)
                    && pos.z + radius.z >= motion.start.z.min(motion.start.z + delta.z)
            })
            .filter_map(|(target, pos, radius, delta)| {
                sweep_point(motion.start, delta, pos - radius, pos + radius)
                    .map(|fraction| PickupEntry { fraction, target })
            })
            .min_by(|a, b| a.fraction.total_cmp(&b.fraction))
    }

    fn resolve_pickup(&mut self, target: PickupTarget) {
        match target {
            PickupTarget::Coin(i) => {
                let coin = &mut self.track.coins[i];
                if coin.taken {
                    return;
                }
                coin.taken = true;
                self.coins += 1;
                self.stats.coins += 1;
                self.particles.sparkle(coin.pos);
                self.events.push(Event::Coin);
            }
            PickupTarget::Power(i) => {
                let p = &mut self.track.pickups[i];
                if p.taken {
                    return;
                }
                p.taken = true;
                let (power, pos) = (p.power, p.pos);
                self.timers[power as usize] = self.full_duration(power);
                self.stats.powerups += 1;
                self.particles.sparkle(pos);
                self.events.push(Event::PowerUp(power));
            }
        }
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
    pub fn revive(&mut self) -> bool {
        if !self.awaiting_revive() {
            return false;
        }
        self.revives += 1;
        self.runner.clear_actions();
        let z = self.runner.z;
        self.track.clear_range(z - 3.0, z + 30.0);
        self.runner.y = self.track.ground(self.runner.x, 0.35, z, 99.0, 99.0);
        self.runner.vy = 0.0;
        self.runner.grounded = true;
        self.chase = 0.0;
        self.caught = false;
        self.grace = GRACE * 2.0;
        self.phase = Phase::Running;
        true
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

    pub fn end(&mut self) -> bool {
        if self.phase == Phase::Over {
            return false;
        }
        self.phase = Phase::Over;
        true
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

    fn collect(&mut self, motion: &PickupMotion, include_boundary: bool) {
        let center = motion.end;
        // Compare against the same expanded bounds as sweep_point. Computing
        // (center-pos).abs() instead loses a boundary ulp far down the track
        // and can repeatedly predict a t0 pickup that never gets consumed.
        let overlaps = |pos: Vec3, radius: Vec3| {
            let min = pos - radius;
            let max = pos + radius;
            if include_boundary {
                center.x >= min.x
                    && center.x <= max.x
                    && center.y >= min.y
                    && center.y <= max.y
                    && center.z >= min.z
                    && center.z <= max.z
            } else {
                center.x > min.x
                    && center.x < max.x
                    && center.y > min.y
                    && center.y < max.y
                    && center.z > min.z
                    && center.z < max.z
            }
        };
        let mut got = Vec::new();
        for (i, coin) in self.track.coins.iter_mut().enumerate() {
            if coin.taken {
                continue;
            }
            let d = center - coin.pos;
            let velocity = motion.coin_velocity(coin.pos);
            if velocity != Vec3::ZERO {
                let pull = velocity * motion.seconds;
                coin.pos += if pull.length() > d.length() { d } else { pull };
            }
            if overlaps(coin.pos, vec3(0.9, 1.4, 0.9)) {
                got.push(i);
            }
        }
        for i in got {
            self.resolve_pickup(PickupTarget::Coin(i));
        }
        let powers: Vec<usize> = self
            .track
            .pickups
            .iter()
            .enumerate()
            .filter_map(|(i, p)| (!p.taken && overlaps(p.pos, vec3(1.0, 1.6, 1.0))).then_some(i))
            .collect();
        for i in powers {
            self.resolve_pickup(PickupTarget::Power(i));
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
    use super::runner::SPEED_MIN;
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
    fn zero_and_invalid_steps_preserve_run_resources_events_and_clock() {
        for dt in [0.0, -0.1, f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut r = empty_run();
            r.timers = [2.0; 5];
            r.events.push(Event::Coin);
            let before = format!(
                "{:?}",
                (
                    &r.runner, r.time, r.score, r.timers, &r.events, r.stats, r.phase
                )
            );
            r.update(
                Controls {
                    jump: true,
                    ..Default::default()
                },
                dt,
            );
            assert_eq!(
                format!(
                    "{:?}",
                    (
                        &r.runner, r.time, r.score, r.timers, &r.events, r.stats, r.phase
                    )
                ),
                before,
                "dt={dt}"
            );
        }
    }

    #[test]
    fn glider_expiry_supplies_grace_through_the_fall_and_landing() {
        let mut r = empty_run();
        r.runner.y = GLIDE_Y;
        r.runner.grounded = false;
        r.timers[Power::Glider as usize] = DT / 2.0;
        r.update(idle(), DT);
        assert!(!r.active(Power::Glider));
        assert!(r.grace >= GRACE - DT, "expiry starts landing grace");
        assert!(r.runner.y < GLIDE_Y && !r.runner.grounded);
    }

    #[test]
    fn fatal_contact_precedes_same_tick_coin_and_power_pickups() {
        let mut r = empty_run();
        put(&mut r, Kind::Block, 1, 0.4, 1.0);
        r.track.coin(vec3(0.0, 0.8, 1.05));
        r.track.pickups.push(Pickup {
            power: Power::Board,
            pos: vec3(0.0, 1.0, 1.15),
            taken: false,
        });
        r.update(idle(), DT);
        assert!(matches!(r.phase, Phase::Down(_)));
        assert_eq!(r.coins, 0);
        assert_eq!(r.stats.powerups, 0);
        assert_eq!(r.timers, [0.0; 5]);
        assert_eq!(r.events, [Event::Crash]);
        assert!(!r.track.coins[0].taken && !r.track.pickups[0].taken);
    }

    #[test]
    fn earlier_pickups_are_retained_and_can_shield_a_later_contact() {
        let mut r = empty_run();
        put(&mut r, Kind::Block, 1, 0.4, 1.0);
        r.track.coin(vec3(0.0, 0.8, 0.5));
        r.track.pickups.push(Pickup {
            power: Power::Board,
            pos: vec3(0.0, 1.0, 1.02),
            taken: false,
        });
        r.update(idle(), DT);
        assert_eq!(r.coins, 1);
        assert_eq!(r.stats.powerups, 1);
        assert_eq!(r.phase, Phase::Running);
        assert_eq!(
            r.events,
            [Event::Coin, Event::PowerUp(Power::Board), Event::BoardBreak]
        );
        assert!(
            (r.runner.z - SPEED_MIN * DT).abs() < 1e-5,
            "unspent movement continues after shield contact"
        );
    }

    #[test]
    fn board_lifetime_is_checked_at_contact_not_at_the_frame_endpoint() {
        for (life, survives) in [(0.01, true), (0.002, false)] {
            let mut r = empty_run();
            put(&mut r, Kind::Block, 1, 0.35, 1.0);
            r.timers[Power::Board as usize] = life;
            r.update(idle(), DT);
            assert_eq!(r.phase == Phase::Running, survives, "life={life}");
            assert_eq!(r.events.contains(&Event::BoardBreak), survives);
        }
    }

    #[test]
    fn double_score_expiry_divides_distance_at_its_actual_time() {
        let mut r = empty_run();
        r.timers[Power::Double as usize] = 0.01;
        r.update(idle(), DT);
        let expected = SPEED_MIN * 0.01 * 2.0 + SPEED_MIN * (DT - 0.01);
        assert!((r.score as f32 - expected).abs() < 1e-5);
        assert_eq!(r.timer(Power::Double), 0.0);
    }

    #[test]
    fn event_splits_consume_discrete_lane_and_jump_presses_once() {
        let mut r = empty_run();
        r.timers[Power::Double as usize] = 0.004;
        r.timers[Power::Spring as usize] = 0.008;
        r.update(
            Controls {
                left: true,
                jump: true,
                ..Default::default()
            },
            DT,
        );
        assert_eq!(r.runner.lane, 0);
        assert_eq!(r.stats.moves, 1);
        assert_eq!(r.stats.jumps, 1);
        assert_eq!(r.events.iter().filter(|e| **e == Event::Move).count(), 1);
        assert_eq!(r.events.iter().filter(|e| **e == Event::Jump).count(), 1);
        assert!((r.runner.z - SPEED_MIN * DT).abs() < 1e-5);
    }

    #[test]
    fn off_axis_pickups_before_a_stumble_use_the_approach_not_the_bounce() {
        for coin in [false, true] {
            let mut r = empty_run();
            r.runner.x = -0.9;
            put(&mut r, Kind::Train, 0, -1.0, 60.0);
            if coin {
                r.track.coin(vec3(-1.85, 0.8, 0.05));
            } else {
                r.track.pickups.push(Pickup {
                    power: Power::Double,
                    pos: vec3(-1.95, 1.0, 0.05),
                    taken: false,
                });
            }
            r.update(
                Controls {
                    left: true,
                    ..Default::default()
                },
                DT,
            );
            assert_eq!(r.phase, Phase::Running);
            let pickup = if coin {
                Event::Coin
            } else {
                Event::PowerUp(Power::Double)
            };
            assert_eq!(r.events, [Event::Move, pickup, Event::Stumble]);
            assert_eq!(r.stats.moves, 1);
            assert_eq!(r.stats.stumbles, 1);
        }
    }

    #[test]
    fn pickup_contact_ties_lose_to_solids_including_zero_time_boundaries() {
        for (front, pickup, survives) in [
            (0.3, 0.99, true),
            (0.3, 1.0, false),
            (0.3, 1.01, false),
            (0.4, 1.0, true),
            (0.4, 1.1, false),
        ] {
            let mut r = empty_run();
            put(&mut r, Kind::Block, 1, front, 1.2);
            r.track.pickups.push(Pickup {
                power: Power::Board,
                pos: vec3(0.0, 1.0, pickup),
                taken: false,
            });
            r.update(idle(), DT);
            assert_eq!(
                r.phase == Phase::Running,
                survives,
                "front={front},pickup={pickup}"
            );
        }
    }

    #[test]
    fn magnet_collection_before_fatal_contact_is_credited_in_event_order() {
        let mut r = empty_run();
        r.timers[Power::Magnet as usize] = 10.0;
        r.track.coin(vec3(1.0, 0.85, 0.05));
        put(&mut r, Kind::Block, 1, 0.4, 1.0);
        r.update(idle(), DT);
        assert!(matches!(r.phase, Phase::Down(_)));
        assert_eq!(r.coins, 1);
        assert_eq!(r.events, [Event::Coin, Event::Crash]);
    }

    #[test]
    fn revive_discards_pre_crash_action_buffers_and_roll_pose() {
        let mut r = empty_run();
        r.runner.y = 0.5;
        r.runner.grounded = false;
        put(&mut r, Kind::Block, 1, 0.4, 1.0);
        r.update(
            Controls {
                jump: true,
                ..Default::default()
            },
            DT,
        );
        assert!(matches!(r.phase, Phase::Down(_)));
        for _ in 0..80 {
            r.update(idle(), DT);
        }
        r.revive();
        r.update(idle(), DT);
        assert!(r.runner.grounded && !r.runner.rolling());
        assert!(!r.events.contains(&Event::Jump));
    }

    #[test]
    fn standing_after_roll_expiry_under_a_bar_is_a_head_contact() {
        let mut r = empty_run();
        r.runner.roll = 0.002;
        put(&mut r, Kind::Bar, 1, -1.0, 3.0);
        r.update(idle(), DT);
        assert!(matches!(r.phase, Phase::Down(_)));
        assert_eq!(r.stats.stumbles, 0);
        assert_eq!(r.events, [Event::Crash]);
    }

    #[test]
    fn revive_and_settlement_are_once_only_and_terminal_resources_freeze() {
        let mut r = empty_run();
        assert!(!r.revive());
        assert_eq!(r.revives, 0);
        put(&mut r, Kind::Block, 1, 0.4, 1.0);
        r.update(idle(), DT);
        assert!(!r.revive());
        for _ in 0..80 {
            r.update(idle(), DT);
        }
        assert!(r.revive());
        assert!(!r.revive());
        assert_eq!(r.revives, 1);
        r.coins = 17;
        let mut save = crate::save::Save::default();
        for _ in 0..2 {
            if r.end() {
                save.bank_run(r.coins, r.score());
            }
        }
        assert_eq!(save.coins, 17);
        let before = (r.runner.z, r.score, r.coins, r.stats, r.timers, r.revives);
        r.update(
            Controls {
                left: true,
                jump: true,
                ..Default::default()
            },
            DT,
        );
        assert_eq!(
            (r.runner.z, r.score, r.coins, r.stats, r.timers, r.revives),
            before
        );
    }

    #[test]
    fn fixed_step_replays_match_30_60_120_hz_render_schedules() {
        let mut results = Vec::new();
        for hz in [30, 60, 120] {
            let mut r = empty_run();
            r.timers[Power::Spring as usize] = 0.7;
            r.timers[Power::Double as usize] = 2.3;
            for n in 0..12 {
                r.track.coin(vec3(0.0, 0.8, 2.0 + n as f32 * 1.5));
            }
            let mut acc = 0.0_f32;
            let mut pending = crate::input::Input::default();
            let mut steps = 0;
            for frame in 0..hz * 8 {
                use crate::script::ScriptKey;
                if frame == 0 {
                    pending.press(ScriptKey::Up);
                    pending.press(ScriptKey::Left);
                }
                if frame == hz * 2 {
                    pending.press(ScriptKey::Right);
                    pending.press(ScriptKey::Down);
                }
                if frame == hz * 4 {
                    pending.press(ScriptKey::Left);
                }
                if frame == hz * 6 {
                    pending.press(ScriptKey::Up);
                }
                acc += 1.0 / hz as f32;
                while acc >= DT {
                    r.update(pending.controls(), DT);
                    pending.end_step();
                    acc -= DT;
                    steps += 1;
                }
            }
            assert_eq!(steps, 480);
            results.push(format!(
                "{:?}",
                (&r.runner, r.score, r.coins, r.timers, r.stats, r.phase)
            ));
        }
        assert_eq!(results[0], results[1]);
        assert_eq!(results[1], results[2]);
    }

    #[test]
    fn air_tuck_expiry_within_a_frame_keeps_center_velocity_and_respects_solids() {
        let mut a = empty_run();
        a.runner.y = 5.0;
        a.runner.vy = 3.0;
        a.runner.grounded = false;
        let mut b = a.clone();
        b.runner.roll = 0.002;
        b.runner.y += (runner::STAND_H - runner::ROLL_H) / 2.0;
        a.update(idle(), DT);
        b.update(idle(), DT);
        assert!((a.runner.vy - b.runner.vy).abs() < 1e-5);
        assert!(
            ((a.runner.y + a.runner.height() / 2.0) - (b.runner.y + b.runner.height() / 2.0)).abs()
                < 1e-4
        );
        let mut blocked = empty_run();
        blocked.runner.y = 0.1;
        blocked.runner.grounded = false;
        blocked.runner.roll = 0.002;
        put(&mut blocked, Kind::Bar, 1, -1.0, 3.0);
        blocked.update(idle(), DT);
        assert!(matches!(blocked.phase, Phase::Down(_)));
        assert!(blocked.runner.y + blocked.runner.height() < track::BAR_Y0);
        let mut roof = empty_run();
        roof.runner.y = track::TRAIN_H + 0.2;
        roof.runner.vy = -5.0;
        roof.runner.grounded = false;
        roof.runner.roll = 0.002;
        put(&mut roof, Kind::Train, 1, -1.0, 3.0);
        roof.update(idle(), DT);
        assert_eq!(roof.phase, Phase::Running);
        assert!(roof.runner.grounded && (roof.runner.y - track::TRAIN_H).abs() < 1e-5);
    }

    #[test]
    fn distant_pickup_boundaries_use_the_same_float_bounds_as_the_sweep() {
        for z in [3000.0, 4096.0, 20000.0] {
            let mut r = empty_run();
            r.runner.z = z;
            r.track.coin(vec3(0.0, 0.8, z + 0.9));
            r.update(idle(), DT);
            assert_eq!(r.coins, 1, "z={z}");
        }
    }

    #[test]
    fn predicted_magnet_entry_is_consumed_without_sub_ulp_world_steps() {
        let mut r = empty_run();
        r.runner.lane = 0;
        r.runner.x = -2.4;
        r.runner.y = 1.8425384;
        r.runner.vy = -8.07275;
        r.runner.z = 1023.3776;
        r.runner.grounded = false;
        r.timers[Power::Magnet as usize] = 1.1052032;
        r.track.coin(vec3(-1.9765965, 3.1270995, 1024.2777));
        r.update(idle(), 0.0042267693);
        assert_eq!(r.coins, 1);
        assert!(r.runner.z > 1023.4);
    }

    #[test]
    fn a_late_board_never_shields_a_prior_fatal_hit_at_large_world_coordinates() {
        for z in [1023.0, 4096.0, 20000.0] {
            let mut r = empty_run();
            r.runner.z = z;
            let front = z + 0.4;
            let contact = front - runner::DEPTH;
            let mut later = f32::from_bits(contact.to_bits() + 1);
            let mut board = later + 1.0;
            while board - 1.0 <= contact {
                later = f32::from_bits(later.to_bits() + 1);
                board = later + 1.0;
            }
            r.track.coin(vec3(0.0, 0.8, contact - 0.01 + 0.9));
            r.track.pickups.push(Pickup {
                power: Power::Board,
                pos: vec3(0.0, 1.0, board),
                taken: false,
            });
            put(&mut r, Kind::Block, 1, front, z + 2.0);
            r.update(idle(), DT);
            assert!(matches!(r.phase, Phase::Down(_)), "z{z}");
            assert_eq!(r.coins, 1);
            assert!(!r.track.pickups[0].taken);
            assert_eq!(r.events, [Event::Coin, Event::Crash]);
        }
    }

    #[test]
    fn untucking_above_an_overhead_bar_cannot_treat_it_as_a_walkable_roof() {
        let mut r = empty_run();
        r.runner.y = 2.5;
        r.runner.grounded = false;
        r.runner.roll = 0.002;
        put(&mut r, Kind::Bar, 1, -1.0, 3.0);
        r.update(idle(), DT);
        assert!(matches!(r.phase, Phase::Down(_)));
        assert!(r.runner.y >= track::BAR_Y1 && r.runner.rolling());
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
