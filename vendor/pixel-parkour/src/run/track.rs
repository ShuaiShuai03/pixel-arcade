//! The rail yard: three lanes of track with obstacles, coins, and power-ups
//! laid out from hand-made patterns.
//!
//! World units are meters: `x` is sideways (lane 0 is left), `y` is up, and
//! `z` is distance along the track in the running direction.

use crate::rng::Rng;
use macroquad::math::{Vec3, vec3};

pub const LANES: i32 = 3;
pub const LANE_W: f32 = 2.4;
/// Length of one pattern cell.
pub const CELL: f32 = 3.0;
pub const TRAIN_H: f32 = 2.7;
pub const HURDLE_H: f32 = 1.0;
/// Overhead bar: run into it standing, roll under it.
pub const BAR_Y0: f32 = 1.1;
pub const BAR_Y1: f32 = 2.3;
pub const BLOCK_H: f32 = 2.4;
/// Half-width of anything that fills a lane.
pub const LANE_HALF: f32 = 1.05;
/// Speed of oncoming trains.
pub const TRAIN_SPEED: f32 = 9.0;
/// Oncoming trains start moving once the runner is this close.
pub const TRAIN_TRIGGER: f32 = 60.0;
/// Coins hover this high above whatever they sit on.
pub const COIN_Y: f32 = 0.8;

pub fn lane_x(lane: i32) -> f32 {
    (lane - 1) as f32 * LANE_W
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// Low barrier: jump over.
    Hurdle,
    /// Overhead bar: roll under.
    Bar,
    /// Full-height barrier: change lanes.
    Block,
    /// Parked train; its roof is walkable.
    Train,
    /// Train that drives toward the runner.
    Oncoming,
    /// Slope up onto the train that follows it.
    Ramp,
}

/// Axis-aligned box in world space.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Aabb {
    pub min: Vec3,
    pub max: Vec3,
}

impl Aabb {
    pub fn overlaps(&self, o: &Aabb) -> bool {
        self.min.x < o.max.x
            && o.min.x < self.max.x
            && self.min.y < o.max.y
            && o.min.y < self.max.y
            && self.min.z < o.max.z
            && o.min.z < self.max.z
    }
}

#[derive(Clone, Debug)]
pub struct Obstacle {
    pub kind: Kind,
    pub lane: i32,
    pub z0: f32,
    pub z1: f32,
    /// Palette color for trains.
    pub color: u8,
    pub moving: bool,
    /// Smashed through (hoverboard or grace period); no longer collides.
    pub broken: bool,
}

impl Obstacle {
    /// The solid volume, if any.
    pub fn solid(&self) -> Option<Aabb> {
        if self.broken {
            return None;
        }
        let x = lane_x(self.lane);
        let (half, y0, y1) = match self.kind {
            Kind::Hurdle => (LANE_HALF, 0.0, HURDLE_H),
            Kind::Bar => (LANE_HALF, BAR_Y0, BAR_Y1),
            Kind::Block => (LANE_HALF, 0.0, BLOCK_H),
            Kind::Train | Kind::Oncoming => (LANE_HALF, 0.0, TRAIN_H),
            Kind::Ramp => return None,
        };
        Some(Aabb {
            min: vec3(x - half, y0, self.z0),
            max: vec3(x + half, y1, self.z1),
        })
    }

    /// Height of the walkable surface at `z`, if this obstacle has one there.
    pub fn surface(&self, z: f32) -> Option<f32> {
        if self.broken || z < self.z0 || z > self.z1 {
            return None;
        }
        match self.kind {
            Kind::Ramp => Some((z - self.z0) / (self.z1 - self.z0) * TRAIN_H),
            Kind::Bar => None,
            _ => self.solid().map(|b| b.max.y),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Power {
    Magnet,
    Glider,
    Spring,
    Double,
    Board,
}

pub const POWERS: [Power; 5] = [
    Power::Magnet,
    Power::Glider,
    Power::Spring,
    Power::Double,
    Power::Board,
];

#[derive(Clone, Debug)]
pub struct Coin {
    pub pos: Vec3,
    pub taken: bool,
}

#[derive(Clone, Debug)]
pub struct Pickup {
    pub power: Power,
    pub pos: Vec3,
    pub taken: bool,
}

/// A hand-made stretch of track. Each lane string has one character per
/// cell; all three strings are the same length.
///
/// `.` empty, `c` coins, `h` hurdle, `H` hurdle with a coin arc, `b` bar,
/// `B` block, `r` ramp (two cells, followed by a train), `T` train,
/// `U` train with coins on the roof, `M` oncoming train, `?` power-up.
pub struct Pattern {
    /// Used in test failure messages.
    #[cfg_attr(not(test), allow(dead_code))]
    pub name: &'static str,
    pub difficulty: u8,
    pub lanes: [&'static str; 3],
}

pub const PATTERNS: &[Pattern] = &[
    Pattern {
        name: "coin line",
        difficulty: 0,
        lanes: ["..........", ".cccccccc.", ".........."],
    },
    Pattern {
        name: "hurdles",
        difficulty: 0,
        lanes: ["....h.....", "..H.....H.", "......h..."],
    },
    Pattern {
        name: "bars",
        difficulty: 0,
        lanes: ["..b.......", ".cc..b.cc.", ".....b...."],
    },
    Pattern {
        name: "parked train",
        difficulty: 0,
        lanes: ["...?......", "...TTTTTT.", "..cccc...."],
    },
    Pattern {
        name: "first ramp",
        difficulty: 0,
        lanes: ["..........", ".rrUUUUUU.", "......h..."],
    },
    Pattern {
        name: "coin hills",
        difficulty: 0,
        lanes: ["..........", ".H..H..H..", "......?..."],
    },
    Pattern {
        name: "bar alley",
        difficulty: 1,
        lanes: ["..b..b..b...", "..cccccc....", "..b..b..b..."],
    },
    Pattern {
        name: "jump or roll",
        difficulty: 1,
        lanes: ["..h...b...h.", "..B......B..", "..b...h...b."],
    },
    Pattern {
        name: "twin trains",
        difficulty: 1,
        lanes: ["..TTTTTT....", "..cccc....?.", "..TTTTTT...."],
    },
    Pattern {
        name: "block wall",
        difficulty: 1,
        lanes: ["....B.......", "....B..cc...", "........B..."],
    },
    Pattern {
        name: "barrier mix",
        difficulty: 1,
        lanes: [".h...b...h..", "...b...H...b", ".b...h...b.."],
    },
    Pattern {
        name: "ramp beside",
        difficulty: 1,
        lanes: ["...rrUUUUUUUU.", ".....TTTTTT...", "....B....?...."],
    },
    Pattern {
        name: "oncoming",
        difficulty: 1,
        lanes: ["................", "..........MMMMMM", "...c.c.c.c......"],
    },
    Pattern {
        name: "train steps",
        difficulty: 2,
        lanes: ["..TTTTTT......", "...........TTT", "..cccc..TTTTTT"],
    },
    Pattern {
        name: "roof hop",
        difficulty: 2,
        lanes: [".rrUUUUUU.......", "......UUUUUUUU..", "..B....cccc....."],
    },
    Pattern {
        name: "gates",
        difficulty: 2,
        lanes: ["....B....b....B.", "....B..H....B...", "........B...h..."],
    },
    Pattern {
        name: "oncoming pair",
        difficulty: 2,
        lanes: ["..........MMMMMM", "...cccc....?....", "..........MMMMMM"],
    },
    Pattern {
        name: "double ramp",
        difficulty: 2,
        lanes: [".rrUUUUUU......", "..h......b.....", ".rrUUUUUU......"],
    },
    Pattern {
        name: "trains both sides",
        difficulty: 2,
        lanes: ["..........MMMMM.", "....?...........", "............MMMM"],
    },
    Pattern {
        name: "roof and bars",
        difficulty: 2,
        lanes: [".rrUUUUUU...", "....b...h...", "..TTTTTTTT.."],
    },
    Pattern {
        name: "gauntlet",
        difficulty: 3,
        lanes: ["..TTTTTTTT....B.", "....h....b..h...", "..B.....TTTTTTTT"],
    },
    Pattern {
        name: "mover by the wall",
        difficulty: 3,
        lanes: ["....TTTTTTTTTTTT", ".............MMM", "....cccc.....?.."],
    },
    Pattern {
        name: "roof only",
        difficulty: 3,
        lanes: [
            "....rrUUUUUUUUUU...",
            ".....TTTTTTTTTTT...",
            "......rrUUUUUUUUU..",
        ],
    },
    Pattern {
        name: "oncoming roofline",
        difficulty: 3,
        lanes: [".rrUUUUUUUUU....", "...........MMMMM", "....cccc........"],
    },
    Pattern {
        name: "zigzag",
        difficulty: 3,
        lanes: ["..B..cc..B..cc..", ".....B.....B....", "..B...cc...B...."],
    },
];

/// Colors trains are painted in.
pub const TRAIN_COLORS: [u8; 4] = [
    crate::art::palette::RED,
    crate::art::palette::BLUE,
    crate::art::palette::GREEN,
    crate::art::palette::ORANGE,
];

/// Distance before patterns start, so each run opens on clear track.
pub const START_CLEAR: f32 = 30.0;

#[derive(Clone)]
pub struct Track {
    pub obstacles: Vec<Obstacle>,
    pub coins: Vec<Coin>,
    pub pickups: Vec<Pickup>,
    /// Where the next pattern begins.
    pub end: f32,
    rng: Rng,
    last: Option<usize>,
}

/// Distance at which each difficulty tier unlocks.
fn max_difficulty(distance: f32) -> u8 {
    match distance {
        d if d < 300.0 => 0,
        d if d < 900.0 => 1,
        d if d < 1800.0 => 2,
        _ => 3,
    }
}

impl Track {
    pub fn new(seed: u64) -> Self {
        Self {
            obstacles: Vec::new(),
            coins: Vec::new(),
            pickups: Vec::new(),
            end: START_CLEAR,
            rng: Rng::new(seed),
            last: None,
        }
    }

    /// Pick a pattern for the current distance: any unlocked tier, favouring
    /// the newest, never the same pattern twice in a row.
    fn pick(&mut self) -> usize {
        let top = max_difficulty(self.end);
        let candidates: Vec<(usize, u32)> = PATTERNS
            .iter()
            .enumerate()
            .filter(|(i, p)| p.difficulty <= top && Some(*i) != self.last)
            .map(|(i, p)| (i, if p.difficulty == top { 3 } else { 1 }))
            .collect();
        let total: u32 = candidates.iter().map(|c| c.1).sum();
        let mut roll = self.rng.below(total);
        for (i, w) in &candidates {
            if roll < *w {
                return *i;
            }
            roll -= w;
        }
        candidates[0].0
    }

    /// Generate patterns until the track reaches `to`.
    pub fn fill_to(&mut self, to: f32) {
        while self.end < to {
            let i = self.pick();
            self.last = Some(i);
            self.place(&PATTERNS[i]);
        }
    }

    fn random_power(&mut self) -> Power {
        POWERS[self.rng.below(POWERS.len() as u32) as usize]
    }

    /// Lay a coin trail along the longest open stretch of one random lane.
    fn coin_trail(&mut self, p: &Pattern, base: f32) {
        let lane = self.rng.below(3) as usize;
        let cells = p.lanes[lane].as_bytes();
        let (mut best, mut start) = ((0, 0), 0);
        for i in 0..=cells.len() {
            if i == cells.len() || cells[i] != b'.' {
                if i - start > best.1 - best.0 {
                    best = (start, i);
                }
                start = i + 1;
            }
        }
        if best.1 - best.0 >= 3 {
            let x = lane_x(lane as i32);
            for i in best.0..best.1 {
                for dz in [0.75, 2.25] {
                    self.coin(vec3(x, COIN_Y, base + i as f32 * CELL + dz));
                }
            }
        }
    }

    fn place(&mut self, p: &Pattern) {
        let base = self.end;
        self.coin_trail(p, base);
        for (lane, row) in p.lanes.iter().enumerate() {
            let lane = lane as i32;
            let x = lane_x(lane);
            let cells: Vec<char> = row.chars().collect();
            let mut i = 0;
            while i < cells.len() {
                let z = base + i as f32 * CELL;
                let c = cells[i];
                // Runs of the same train character form one train.
                let run = cells[i..].iter().take_while(|&&k| same_run(k, c)).count();
                match c {
                    'c' => {
                        for dz in [0.75, 2.25] {
                            self.coin(vec3(x, COIN_Y, z + dz));
                        }
                    }
                    'h' | 'H' => {
                        self.obstacle(Kind::Hurdle, lane, z + 1.3, z + 1.7);
                        if c == 'H' {
                            for (dz, dy) in [(-1.5, 1.2), (0.0, 1.8), (1.5, 1.2)] {
                                self.coin(vec3(x, COIN_Y + dy, z + 1.5 + dz));
                            }
                        }
                    }
                    'b' => self.obstacle(Kind::Bar, lane, z + 1.3, z + 1.7),
                    'B' => self.obstacle(Kind::Block, lane, z + 1.2, z + 1.8),
                    'r' => self.obstacle(Kind::Ramp, lane, z, z + run as f32 * CELL),
                    'T' | 'U' => {
                        self.obstacle(Kind::Train, lane, z, z + run as f32 * CELL);
                        for k in 0..run {
                            if cells[i + k] == 'U' {
                                let cz = z + k as f32 * CELL;
                                for dz in [0.75, 2.25] {
                                    self.coin(vec3(x, TRAIN_H + COIN_Y, cz + dz));
                                }
                            }
                        }
                    }
                    'M' => self.obstacle(Kind::Oncoming, lane, z, z + run as f32 * CELL),
                    '?' => {
                        let power = self.random_power();
                        self.pickups.push(Pickup {
                            power,
                            pos: vec3(x, 1.0, z + 1.5),
                            taken: false,
                        });
                    }
                    _ => {}
                }
                i += if matches!(c, 'r' | 'T' | 'U' | 'M') {
                    run
                } else {
                    1
                };
            }
        }
        self.end = base + p.lanes[0].len() as f32 * CELL;
    }

    fn obstacle(&mut self, kind: Kind, lane: i32, z0: f32, z1: f32) {
        let color = TRAIN_COLORS[self.rng.below(TRAIN_COLORS.len() as u32) as usize];
        self.obstacles.push(Obstacle {
            kind,
            lane,
            z0,
            z1,
            color,
            moving: false,
            broken: false,
        });
    }

    pub fn coin(&mut self, pos: Vec3) {
        self.coins.push(Coin { pos, taken: false });
    }

    /// Drop everything that is fully behind `z`.
    pub fn trim_before(&mut self, z: f32) {
        self.obstacles.retain(|o| o.z1 > z);
        self.coins.retain(|c| c.pos.z > z && !c.taken);
        self.pickups.retain(|p| p.pos.z > z && !p.taken);
    }

    /// Start oncoming trains near the runner and move the ones already going.
    pub fn update_trains(&mut self, runner_z: f32, dt: f32) {
        for o in &mut self.obstacles {
            if o.kind != Kind::Oncoming {
                continue;
            }
            if !o.moving && o.z0 - runner_z < TRAIN_TRIGGER {
                o.moving = true;
            }
            if o.moving {
                o.z0 -= TRAIN_SPEED * dt;
                o.z1 -= TRAIN_SPEED * dt;
            }
        }
    }

    /// Highest walkable surface under a footprint at (`x`, `z`) that is no
    /// more than `step` above `y`. The track itself is at 0.
    pub fn ground(&self, x: f32, half_w: f32, z: f32, y: f32, step: f32) -> f32 {
        self.obstacles
            .iter()
            .filter(|o| (lane_x(o.lane) - x).abs() < LANE_HALF + half_w)
            .filter_map(|o| o.surface(z))
            .filter(|&s| s <= y + step)
            .fold(0.0, f32::max)
    }

    /// Clear obstacles in a stretch ahead (used after a revive).
    pub fn clear_range(&mut self, z0: f32, z1: f32) {
        self.obstacles.retain(|o| o.z1 < z0 || o.z0 > z1);
    }
}

fn same_run(k: char, c: char) -> bool {
    match c {
        'T' | 'U' => matches!(k, 'T' | 'U'),
        _ => k == c,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Can the runner be in lane `l` at cell `i`, at ground (`roof` false) or
    /// on a roof?
    fn open(p: &Pattern, l: usize, i: usize, roof: bool) -> bool {
        let lane: Vec<char> = p.lanes[l].chars().collect();
        if let Some(m) = p.lanes[l].find('M') {
            // An oncoming train sweeps its lane from where it starts back to
            // where it can meet the runner.
            if i + approach_cells() >= m {
                return false;
            }
        }
        match (lane[i], roof) {
            ('T' | 'U', r) => r,
            ('B', false) => false,
            ('r', _) => true,
            (_, r) => !r,
        }
    }

    /// Cells an oncoming train can cover before meeting the runner (at the
    /// slowest run speed, when it covers the most).
    fn approach_cells() -> usize {
        let slowest = super::super::runner::SPEED_MIN;
        let travel = TRAIN_SPEED * TRAIN_TRIGGER / (slowest + TRAIN_SPEED);
        (travel / CELL).ceil() as usize
    }

    /// A jump or roll obstacle on the ground in this cell.
    fn needs_move(p: &Pattern, l: usize, i: usize, roof: bool) -> bool {
        !roof && matches!(p.lanes[l].as_bytes()[i], b'h' | b'H' | b'b')
    }

    /// Runner state at a cell: lane, on a roof, just changed lanes.
    type State = (usize, bool, bool);

    /// States reachable at cell `i` from `st` at cell `i - 1`, with
    /// human-friendly limits: a lane change cannot be combined with a jump or
    /// roll obstacle, and the runner needs a cell in the new lane before
    /// changing again.
    fn successors(p: &Pattern, i: usize, (l, roof, cool): State) -> Vec<State> {
        let mut out = Vec::new();
        // Going forward: ramps lead up, train ends drop down.
        let mut levels = vec![roof];
        if p.lanes[l].as_bytes()[i - 1] == b'r' {
            levels.push(true);
        }
        if roof {
            levels.push(false);
        }
        for lv in levels {
            if open(p, l, i, lv) {
                out.push((l, lv, false));
            }
        }
        if cool {
            return out;
        }
        // Change lanes across the boundary into cell `i`: the new lane must
        // be open in both cells, without a jump or roll obstacle.
        for nl in [l.wrapping_sub(1), l + 1] {
            if nl >= 3 {
                continue;
            }
            // Off a roof sideways means dropping down.
            for tl in [roof, false] {
                let clear = |c| open(p, nl, c, tl) && !needs_move(p, nl, c, tl);
                if clear(i - 1) && clear(i) && !out.contains(&(nl, tl, true)) {
                    out.push((nl, tl, true));
                }
            }
        }
        out
    }

    /// Reachable states per cell, starting in any open lane.
    fn reachable(p: &Pattern) -> Vec<Vec<State>> {
        let n = p.lanes[0].len();
        let mut cells = vec![
            (0..3)
                .filter(|&l| open(p, l, 0, false))
                .map(|l| (l, false, false))
                .collect::<Vec<_>>(),
        ];
        for i in 1..n {
            let mut next: Vec<State> = Vec::new();
            for &st in &cells[i - 1] {
                for s in successors(p, i, st) {
                    if !next.contains(&s) {
                        next.push(s);
                    }
                }
            }
            cells.push(next);
        }
        cells
    }

    #[test]
    fn every_pattern_is_well_formed() {
        for p in PATTERNS {
            let n = p.lanes[0].len();
            assert!(
                p.lanes.iter().all(|l| l.len() == n),
                "{}: ragged lanes",
                p.name
            );
            for l in p.lanes {
                assert!(
                    l.chars().all(|c| ".chHbBrTUM?".contains(c)),
                    "{}: bad character",
                    p.name
                );
                let first = l.chars().next().unwrap();
                assert!(
                    first == '.' || first == 'r',
                    "{}: first cell must be open",
                    p.name
                );
                // Ramps are exactly two cells and lead onto a train.
                let cells: Vec<char> = l.chars().collect();
                let mut i = 0;
                while i < cells.len() {
                    if cells[i] == 'r' {
                        let run = cells[i..].iter().take_while(|&&c| c == 'r').count();
                        assert_eq!(run, 2, "{}: ramp length", p.name);
                        assert!(
                            matches!(cells.get(i + run), Some('T' | 'U')),
                            "{}: ramp must lead onto a train",
                            p.name
                        );
                        i += run;
                    } else {
                        i += 1;
                    }
                }
            }
        }
    }

    #[test]
    fn every_pattern_has_a_way_through_and_no_traps() {
        for p in PATTERNS {
            let cells = reachable(p);
            let n = cells.len();
            assert!(!cells[n - 1].is_empty(), "{} cannot be crossed", p.name);
            // Every reachable state must still be able to reach the end
            // (except right after a lane change, where swerving into a
            // blocked lane is the player's own mistake).
            let mut good = cells[n - 1].clone();
            for i in (0..n - 1).rev() {
                let here: Vec<State> = cells[i]
                    .iter()
                    .copied()
                    .filter(|&st| successors(p, i + 1, st).iter().any(|s| good.contains(s)))
                    .collect();
                for st in cells[i].iter().filter(|s| !s.2 && !here.contains(s)) {
                    // Doomed states are fine right in front of the obstacle
                    // (that is just a late dodge); not with open track ahead.
                    let open_ahead = (i..n).take_while(|&c| open(p, st.0, c, st.1)).count();
                    assert!(
                        open_ahead < 3,
                        "{}: trap at cell {i} in lane {} (roof {})",
                        p.name,
                        st.0,
                        st.1
                    );
                }
                good = here;
            }
            // The previous pattern can leave the runner in any lane.
            for l in 0..3 {
                assert!(
                    good.contains(&(l, false, false)),
                    "{}: entering in lane {l} is a trap",
                    p.name
                );
            }
        }
    }

    #[test]
    fn oncoming_trains_have_room_to_approach() {
        // At the slowest run speed an oncoming train covers this much track
        // before it meets the runner, so its lane must be empty before it.
        let slowest = super::super::runner::SPEED_MIN;
        let travel = TRAIN_SPEED * TRAIN_TRIGGER / (slowest + TRAIN_SPEED);
        for p in PATTERNS {
            for l in p.lanes {
                if let Some(start) = l.find('M') {
                    assert!(
                        start as f32 * CELL >= travel,
                        "{}: oncoming train starts too early",
                        p.name
                    );
                    assert!(l[..start].chars().all(|c| c == '.'));
                }
            }
        }
    }

    #[test]
    fn every_difficulty_tier_has_patterns() {
        for d in 0..=3 {
            assert!(PATTERNS.iter().filter(|p| p.difficulty == d).count() >= 3);
        }
    }

    #[test]
    fn generation_is_deterministic() {
        let mut a = Track::new(5);
        let mut b = Track::new(5);
        a.fill_to(4000.0);
        b.fill_to(4000.0);
        assert_eq!(a.obstacles.len(), b.obstacles.len());
        assert_eq!(a.coins.len(), b.coins.len());
        assert!(a.end >= 4000.0);
        assert!(a.obstacles.iter().any(|o| o.kind == Kind::Oncoming));
    }

    #[test]
    fn early_track_uses_only_easy_patterns() {
        let mut t = Track::new(9);
        let mut used = Vec::new();
        while t.end < 300.0 {
            let i = t.pick();
            used.push(i);
            t.last = Some(i);
            t.place(&PATTERNS[i]);
        }
        assert!(used.iter().all(|&i| PATTERNS[i].difficulty == 0));
        assert!(used.windows(2).all(|w| w[0] != w[1]));
    }

    #[test]
    fn ramp_rises_to_roof_height() {
        let ramp = Obstacle {
            kind: Kind::Ramp,
            lane: 1,
            z0: 0.0,
            z1: 6.0,
            color: 0,
            moving: false,
            broken: false,
        };
        assert_eq!(ramp.surface(0.0), Some(0.0));
        assert_eq!(ramp.surface(6.0), Some(TRAIN_H));
        assert!(ramp.solid().is_none());
    }

    #[test]
    fn ground_ignores_surfaces_too_high_to_step_onto() {
        let mut t = Track::new(1);
        t.obstacle(Kind::Train, 1, 10.0, 20.0);
        assert_eq!(t.ground(0.0, 0.35, 15.0, 0.0, 0.6), 0.0);
        assert_eq!(t.ground(0.0, 0.35, 15.0, TRAIN_H, 0.6), TRAIN_H);
        // A neighbouring lane's train is not under the runner.
        assert_eq!(t.ground(lane_x(0), 0.35, 15.0, TRAIN_H, 0.6), 0.0);
    }

    #[test]
    fn oncoming_trains_move_only_when_near() {
        let mut t = Track::new(1);
        t.obstacle(Kind::Oncoming, 0, 200.0, 215.0);
        t.update_trains(0.0, 1.0);
        assert_eq!(t.obstacles[0].z0, 200.0);
        t.update_trains(150.0, 1.0);
        assert_eq!(t.obstacles[0].z0, 200.0 - TRAIN_SPEED);
    }
}
