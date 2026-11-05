//! Block models: the runner, the chaser drone, coins and power-ups.

use super::part;
use crate::art::palette::{
    BLUE, BROWN, DARK_PURPLE, GRAY, GREEN, INK, LIGHT_BLUE, LIGHT_GREEN, ORANGE, PURPLE, RED, SKIN,
    WHITE, YELLOW,
};
use crate::meta::OUTFITS;
use crate::run::runner::ROLL_TIME;
use crate::run::track::Power;
use crate::run::{Phase, Run};
use macroquad::prelude::*;
use std::f32::consts::{FRAC_PI_2, TAU};

pub fn coin(pos: Vec3, angle: f32) {
    let m = Mat4::from_translation(pos) * Mat4::from_rotation_y(angle);
    part(m, Vec3::ZERO, vec3(0.3, 0.3, 0.06), YELLOW);
    part(m, Vec3::ZERO, vec3(0.14, 0.14, 0.08), ORANGE);
}

pub fn pickup(power: Power, pos: Vec3, angle: f32) {
    let m = Mat4::from_translation(pos) * Mat4::from_rotation_y(angle);
    match power {
        Power::Magnet => {
            for s in [-1.0, 1.0] {
                part(m, vec3(s * 0.22, 0.05, 0.0), vec3(0.1, 0.28, 0.1), RED);
                part(m, vec3(s * 0.22, 0.38, 0.0), vec3(0.1, 0.07, 0.1), WHITE);
            }
            part(m, vec3(0.0, -0.25, 0.0), vec3(0.32, 0.08, 0.1), RED);
        }
        Power::Glider => {
            part(m, vec3(0.0, 0.1, 0.0), vec3(0.55, 0.05, 0.2), LIGHT_BLUE);
            part(m, vec3(0.0, -0.1, 0.0), vec3(0.1, 0.2, 0.1), BLUE);
            part(m, vec3(0.0, -0.33, 0.0), vec3(0.12, 0.05, 0.12), ORANGE);
        }
        Power::Spring => {
            for i in 0..4 {
                let c = if i % 2 == 0 { LIGHT_GREEN } else { GREEN };
                part(
                    m,
                    vec3(0.0, -0.3 + i as f32 * 0.15, 0.0),
                    vec3(0.22, 0.06, 0.22),
                    c,
                );
            }
            part(m, vec3(0.0, 0.33, 0.0), vec3(0.3, 0.05, 0.3), WHITE);
        }
        Power::Double => {
            part(m, Vec3::ZERO, vec3(0.3, 0.3, 0.3), YELLOW);
            part(m, Vec3::ZERO, vec3(0.34, 0.08, 0.34), ORANGE);
        }
        Power::Board => {
            let tilt = m * Mat4::from_rotation_x(-0.6);
            board(tilt, 0.0);
        }
    }
}

/// Limb and body angles for one frame.
struct Pose {
    legs: [f32; 2],
    arms: [f32; 2],
    /// Sideways spread of the arms (gliding).
    spread: f32,
    lean: f32,
    bob: f32,
}

fn pose(run: &Run) -> Pose {
    let r = &run.runner;
    let p = r.anim * TAU / 2.8;
    if run.active(Power::Glider) && !matches!(run.phase, Phase::Down(_)) {
        Pose {
            legs: [0.3, -0.2],
            arms: [0.0, 0.0],
            spread: 1.3,
            lean: 0.5,
            bob: 0.0,
        }
    } else if r.rolling() {
        Pose {
            legs: [-1.8, -1.8],
            arms: [-1.2, -1.2],
            spread: 0.0,
            lean: 0.0,
            bob: 0.0,
        }
    } else if !r.grounded {
        Pose {
            legs: [-1.1, 0.5],
            arms: [-2.6, 0.6],
            spread: 0.2,
            lean: 0.15,
            bob: 0.0,
        }
    } else {
        let s = p.sin();
        Pose {
            legs: [s * 0.9, -s * 0.9],
            arms: [-s * 0.8, s * 0.8],
            spread: 0.08,
            lean: 0.15,
            bob: s.abs() * 0.06,
        }
    }
}

pub fn runner(run: &Run, outfit: usize) {
    let r = &run.runner;
    let o = &OUTFITS[outfit.min(OUTFITS.len() - 1)];
    let pose = pose(run);
    let riding = run.active(Power::Board) && run.phase == Phase::Running;
    // Riding a hoverboard lifts the runner just above its deck.
    let hover = if riding {
        0.22 + (run.time * 6.0).sin() * 0.03
    } else {
        0.0
    };
    let feet = vec3(r.x, r.y + hover, r.z);
    let mut m = Mat4::from_translation(feet);
    match run.phase {
        Phase::Down(t) => {
            // Knocked flat onto the back.
            let k = (t / 0.3).min(1.0);
            m *= Mat4::from_rotation_x(-FRAC_PI_2 * k);
        }
        _ if r.rolling() => {
            let spin = (1.0 - r.roll / ROLL_TIME) * TAU * 1.5;
            m = m
                * Mat4::from_translation(vec3(0.0, 0.45, 0.0))
                * Mat4::from_rotation_x(spin)
                * Mat4::from_scale(Vec3::splat(0.55))
                * Mat4::from_translation(vec3(0.0, -0.95, 0.0));
        }
        _ => m *= Mat4::from_rotation_x(pose.lean),
    }
    m *= Mat4::from_translation(vec3(0.0, pose.bob, 0.0));

    let shoes = if run.active(Power::Spring) {
        LIGHT_GREEN
    } else {
        WHITE
    };
    for (i, s) in [-1.0f32, 1.0].into_iter().enumerate() {
        let hip = m
            * Mat4::from_translation(vec3(s * 0.13, 0.8, 0.0))
            * Mat4::from_rotation_x(pose.legs[i]);
        part(
            hip,
            vec3(0.0, -0.38, 0.0),
            vec3(0.11, 0.38, 0.12),
            o.trousers,
        );
        part(hip, vec3(0.0, -0.76, 0.05), vec3(0.12, 0.06, 0.17), shoes);

        let shoulder = m
            * Mat4::from_translation(vec3(s * 0.35, 1.36, 0.0))
            * Mat4::from_rotation_z(s * pose.spread)
            * Mat4::from_rotation_x(pose.arms[i]);
        part(
            shoulder,
            vec3(0.0, -0.27, 0.0),
            vec3(0.09, 0.27, 0.1),
            o.jacket,
        );
        part(shoulder, vec3(0.0, -0.6, 0.0), vec3(0.08, 0.07, 0.08), SKIN);
    }
    part(m, vec3(0.0, 1.1, 0.0), vec3(0.26, 0.3, 0.15), o.jacket);
    part(m, vec3(0.0, 1.12, -0.22), vec3(0.19, 0.22, 0.08), BROWN);
    part(m, vec3(0.0, 1.62, 0.0), vec3(0.2, 0.2, 0.2), SKIN);
    part(m, vec3(0.0, 1.62, -0.05), vec3(0.21, 0.17, 0.17), BROWN);
    part(m, vec3(0.0, 1.85, 0.0), vec3(0.22, 0.06, 0.22), o.cap);
    part(m, vec3(0.0, 1.81, 0.28), vec3(0.2, 0.025, 0.1), o.cap);

    if run.active(Power::Glider) {
        let wing = Mat4::from_translation(feet) * Mat4::from_rotation_x(pose.lean);
        part(
            wing,
            vec3(0.0, 2.05, -0.1),
            vec3(1.3, 0.05, 0.35),
            LIGHT_BLUE,
        );
        part(wing, vec3(0.0, 2.05, -0.1), vec3(0.15, 0.08, 0.36), BLUE);
        let flame = if (run.time * 20.0) as i32 % 2 == 0 {
            YELLOW
        } else {
            ORANGE
        };
        part(wing, vec3(0.0, 0.9, -0.36), vec3(0.08, 0.15, 0.08), flame);
    }
    if riding {
        let deck = Mat4::from_translation(feet - vec3(0.0, 0.1, 0.0));
        board(deck, run.time);
    }
    if run.grace > 0.0 && (run.time * 10.0) as i32 % 2 == 0 {
        draw_cube_wires(
            feet + vec3(0.0, 0.95, 0.0),
            vec3(1.3, 2.1, 1.0),
            crate::art::palette::color(WHITE),
        );
    }
}

/// A hoverboard deck, long side along z, with a flickering glow underneath.
fn board(m: Mat4, time: f32) {
    part(m, Vec3::ZERO, vec3(0.3, 0.05, 0.62), ORANGE);
    part(m, vec3(0.0, 0.06, 0.0), vec3(0.24, 0.015, 0.5), YELLOW);
    part(m, vec3(0.0, 0.02, 0.6), vec3(0.22, 0.06, 0.06), RED);
    let glow = if (time * 12.0) as i32 % 2 == 0 {
        LIGHT_BLUE
    } else {
        WHITE
    };
    for z in [-0.4, 0.4] {
        part(m, vec3(0.0, -0.08, z), vec3(0.16, 0.03, 0.1), glow);
    }
}

/// The chaser: a security drone that hovers beside and behind the runner.
pub fn drone(pos: Vec3, lane: i32, time: f32) {
    // Hover over the shoulder on the side with more room.
    let side = if lane == 2 { -1.2 } else { 1.2 };
    let m = Mat4::from_translation(pos + vec3(side, 0.6, 0.0)) * Mat4::from_scale(Vec3::splat(1.5));
    part(m, Vec3::ZERO, vec3(0.45, 0.18, 0.35), PURPLE);
    part(m, vec3(0.0, 0.2, 0.0), vec3(0.25, 0.06, 0.2), DARK_PURPLE);
    part(m, vec3(0.0, -0.22, 0.0), vec3(0.2, 0.05, 0.2), INK);
    part(m, vec3(0.0, -0.05, 0.36), vec3(0.3, 0.07, 0.02), RED);
    let blink = if (time * 4.0) as i32 % 2 == 0 {
        RED
    } else {
        ORANGE
    };
    part(m, vec3(0.0, 0.3, 0.0), vec3(0.06, 0.05, 0.06), blink);
    for (dx, dz) in [(-0.55, -0.4), (0.55, -0.4), (-0.55, 0.4), (0.55, 0.4)] {
        part(
            m,
            vec3(dx * 0.7, 0.05, dz * 0.7),
            vec3(0.06, 0.04, 0.06),
            GRAY,
        );
        let blade =
            m * Mat4::from_translation(vec3(dx, 0.14, dz)) * Mat4::from_rotation_y(time * 30.0);
        part(blade, Vec3::ZERO, vec3(0.28, 0.015, 0.04), WHITE);
    }
}
