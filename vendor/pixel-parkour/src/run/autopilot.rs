//! A lookahead autopilot: plays the title-screen demo and, in tests, checks
//! that generated track can be survived at every speed.

use super::runner::Controls;
use super::{Phase, Run};

const DT: f32 = 1.0 / 60.0;
/// Frames simulated after each move before the next one is considered.
const MOVE_FRAMES: u32 = 15;
/// Moves planned after the first one.
const DEPTH: u32 = 3;

const MOVES: [Controls; 5] = [
    Controls {
        left: false,
        right: false,
        jump: false,
        roll: false,
    },
    Controls {
        left: false,
        right: false,
        jump: true,
        roll: false,
    },
    Controls {
        left: false,
        right: false,
        jump: false,
        roll: true,
    },
    Controls {
        left: true,
        right: false,
        jump: false,
        roll: false,
    },
    Controls {
        left: false,
        right: true,
        jump: false,
        roll: false,
    },
];

/// Apply `c`, then idle; false on a crash or stumble.
fn try_move(sim: &mut Run, c: Controls) -> bool {
    let chase = sim.chase;
    for f in 0..MOVE_FRAMES {
        sim.update(if f == 0 { c } else { Controls::default() }, DT);
        if sim.phase != Phase::Running || sim.chase > chase {
            return false;
        }
    }
    true
}

/// Depth-first search for a safe sequence of moves.
fn plan(sim: &Run, depth: u32) -> bool {
    MOVES.iter().any(|&m| {
        let mut s = sim.clone();
        try_move(&mut s, m) && (depth == 0 || plan(&s, depth - 1))
    })
}

/// The first move (preferring to do nothing) that still leaves a safe plan.
pub fn choose(run: &Run) -> Controls {
    for &m in &MOVES {
        let mut s = run.clone();
        s.particles.list.clear();
        if try_move(&mut s, m) && plan(&s, DEPTH) {
            return m;
        }
    }
    Controls::default()
}
