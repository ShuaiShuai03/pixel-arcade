//! Low-resolution 3D: flat-shaded blocks in palette colors and pixel-art
//! textures with nearest filtering, rendered into the 320x180 target.
//! There is no lighting or blending, so every pixel is a palette color.

pub mod models;
pub mod textures;

use crate::art::palette::{
    self, BLUE, BROWN, DARK_BLUE, DARK_PURPLE, GRAY, GREEN, INK, LAVENDER, LIGHT_BLUE, LIGHT_GREEN,
    ORANGE, PURPLE, RED, SKIN, WHITE, YELLOW,
};
use crate::run::Run;
use crate::run::track::{
    BAR_Y0, BAR_Y1, BLOCK_H, CELL, HURDLE_H, Kind, LANE_HALF, LANE_W, Obstacle, TRAIN_H, lane_x,
};
use crate::{VIEW_H, VIEW_W};
use macroquad::prelude::*;
use textures::Textures;

/// How far ahead of the camera the world is drawn.
pub const DRAW_AHEAD: f32 = 115.0;
/// Vertical field of view at the slowest and fastest run speeds.
pub const FOV_MIN: f32 = 0.9;
pub const FOV_MAX: f32 = 1.08;
/// Tunnels: one every `TUNNEL_EVERY` meters, `TUNNEL_LEN` long.
const TUNNEL_EVERY: f32 = 480.0;
const TUNNEL_LEN: f32 = 42.0;
const TUNNEL_H: f32 = 8.5;

/// Perspective camera rendering into the low-res target. The view is
/// mirrored on x so that world +x (lane 2) appears on the right.
pub struct View3D {
    pub eye: Vec3,
    pub target: Vec3,
    /// Vertical field of view in radians.
    pub fov: f32,
    pub pass: RenderPass,
}

impl View3D {
    fn view_proj(&self) -> Mat4 {
        let proj = Mat4::perspective_rh_gl(self.fov, VIEW_W / VIEW_H, 0.1, 400.0);
        let mirror = Mat4::from_scale(vec3(-1.0, 1.0, 1.0));
        proj * mirror * Mat4::look_at_rh(self.eye, self.target, Vec3::Y)
    }

    /// Project a world point to view pixels, if it is in front of the camera.
    pub fn project(&self, p: Vec3) -> Option<Vec2> {
        let c = self.view_proj() * p.extend(1.0);
        (c.w > 0.0).then(|| {
            vec2(
                (c.x / c.w + 1.0) / 2.0 * VIEW_W,
                (1.0 - c.y / c.w) / 2.0 * VIEW_H,
            )
        })
    }
}

impl Camera for View3D {
    fn matrix(&self) -> Mat4 {
        self.view_proj()
    }

    fn depth_enabled(&self) -> bool {
        true
    }

    fn render_pass(&self) -> Option<RenderPass> {
        Some(self.pass.clone())
    }

    fn viewport(&self) -> Option<(i32, i32, i32, i32)> {
        None
    }
}

/// Lit-top and shadowed-side colors for a base color.
pub fn shade(c: u8) -> (u8, u8) {
    match c {
        INK => (DARK_PURPLE, INK),
        DARK_PURPLE => (PURPLE, INK),
        PURPLE => (LAVENDER, DARK_PURPLE),
        LAVENDER => (LAVENDER, PURPLE),
        DARK_BLUE => (BLUE, INK),
        BLUE => (LIGHT_BLUE, DARK_BLUE),
        LIGHT_BLUE => (WHITE, BLUE),
        WHITE => (WHITE, GRAY),
        GRAY => (WHITE, PURPLE),
        RED => (ORANGE, BROWN),
        ORANGE => (YELLOW, RED),
        YELLOW => (WHITE, ORANGE),
        GREEN => (LIGHT_GREEN, DARK_BLUE),
        LIGHT_GREEN => (WHITE, GREEN),
        BROWN => (ORANGE, DARK_PURPLE),
        SKIN => (SKIN, ORANGE),
        _ => (c, c),
    }
}

fn col(c: u8) -> Color {
    palette::color(c)
}

const UV: [Vec2; 4] = [
    vec2(0.0, 1.0),
    vec2(1.0, 1.0),
    vec2(1.0, 0.0),
    vec2(0.0, 0.0),
];

/// A textured quad. Corners are bottom-left, bottom-right, top-right,
/// top-left of the texture.
pub fn tex_quad(tex: &Texture2D, p: [Vec3; 4]) {
    draw_mesh(&Mesh {
        vertices: (0..4)
            .map(|i| Vertex::new2(p[i], UV[i], macroquad::color::WHITE))
            .collect(),
        indices: vec![0, 1, 2, 0, 2, 3],
        texture: Some(tex.clone()),
    });
}

/// Corner `i` of a box: bit 0 = +x, bit 1 = +y, bit 2 = +z.
const FACES: [([usize; 4], Face); 5] = [
    ([0, 4, 6, 2], Face::Side),
    ([5, 1, 3, 7], Face::Side),
    ([2, 6, 7, 3], Face::Top),
    ([1, 0, 2, 3], Face::Near),
    ([4, 5, 7, 6], Face::Side),
];

#[derive(Clone, Copy)]
enum Face {
    Top,
    Side,
    Near,
}

/// A flat-shaded box from its eight corners.
fn cuboid(corners: [Vec3; 8], base: u8) {
    let (top, side) = shade(base);
    let mut vertices = Vec::with_capacity(20);
    let mut indices = Vec::with_capacity(30);
    for (idx, face) in FACES {
        let c = col(match face {
            Face::Top => top,
            Face::Side => side,
            Face::Near => base,
        });
        let n = vertices.len() as u16;
        for i in idx {
            vertices.push(Vertex::new2(corners[i], Vec2::ZERO, c));
        }
        indices.extend_from_slice(&[n, n + 1, n + 2, n, n + 2, n + 3]);
    }
    draw_mesh(&Mesh {
        vertices,
        indices,
        texture: None,
    });
}

/// Axis-aligned box between `min` and `max`.
pub fn block(min: Vec3, max: Vec3, c: u8) {
    cuboid(
        std::array::from_fn(|i| {
            vec3(
                if i & 1 == 0 { min.x } else { max.x },
                if i & 2 == 0 { min.y } else { max.y },
                if i & 4 == 0 { min.z } else { max.z },
            )
        }),
        c,
    );
}

/// Box of half-size `half` centered at `center` in the space of `m`.
pub fn part(m: Mat4, center: Vec3, half: Vec3, c: u8) {
    cuboid(
        std::array::from_fn(|i| {
            let s = vec3(
                if i & 1 == 0 { -1.0 } else { 1.0 },
                if i & 2 == 0 { -1.0 } else { 1.0 },
                if i & 4 == 0 { -1.0 } else { 1.0 },
            );
            m.transform_point3(center + half * s)
        }),
        c,
    );
}

/// Deterministic hash for scenery placement.
fn hash(a: i32, b: i32) -> u32 {
    let mut h = (a as u32).wrapping_mul(0x9e37_79b1) ^ (b as u32).wrapping_mul(0x85eb_ca77);
    h ^= h >> 15;
    h = h.wrapping_mul(0xc2b2_ae3d);
    h ^ (h >> 13)
}

/// The tunnel covering `z`, as (start, end), if any.
fn tunnel_at(z: f32) -> Option<(f32, f32)> {
    let start = (z / TUNNEL_EVERY).floor() * TUNNEL_EVERY + TUNNEL_EVERY / 2.0;
    (z >= TUNNEL_EVERY && z >= start && z < start + TUNNEL_LEN)
        .then_some((start, start + TUNNEL_LEN))
}

/// Brick tunnels over the track: a portal wall with an opening, side walls
/// and a ceiling with a row of lights.
fn draw_tunnels(t: &Textures, z0: f32, z1: f32) {
    let first = (z0 / TUNNEL_EVERY).floor() as i32;
    let last = (z1 / TUNNEL_EVERY).ceil() as i32;
    let half = 1.5 * LANE_W + 0.6;
    for n in first.max(1)..=last {
        let a = n as f32 * TUNNEL_EVERY + TUNNEL_EVERY / 2.0;
        let b = a + TUNNEL_LEN;
        if b < z0 || a > z1 {
            continue;
        }
        // Portal: left and right of the opening, and the lintel above.
        let h = TUNNEL_H + 5.0;
        for (x0, x1) in [(-24.0, -half), (half, 24.0)] {
            tex_quad(
                &t.brick,
                [
                    vec3(x0, 0.0, a),
                    vec3(x1, 0.0, a),
                    vec3(x1, h, a),
                    vec3(x0, h, a),
                ],
            );
        }
        tex_quad(
            &t.brick,
            [
                vec3(-half, TUNNEL_H, a),
                vec3(half, TUNNEL_H, a),
                vec3(half, h, a),
                vec3(-half, h, a),
            ],
        );
        block(vec3(-24.0, h, a), vec3(24.0, h + 0.4, a + 1.0), GRAY);
        // Inside: walls and ceiling, in 6 m sections.
        let mut z = a;
        while z < b {
            let zb = (z + 6.0).min(b);
            for s in [-1.0f32, 1.0] {
                let x = s * half;
                tex_quad(
                    &t.brick,
                    [
                        vec3(x, 0.0, z),
                        vec3(x, 0.0, zb),
                        vec3(x, TUNNEL_H, zb),
                        vec3(x, TUNNEL_H, z),
                    ],
                );
            }
            block(
                vec3(-half, TUNNEL_H, z),
                vec3(half, TUNNEL_H + 0.2, zb),
                DARK_PURPLE,
            );
            block(
                vec3(-0.3, TUNNEL_H - 0.12, z + 2.5),
                vec3(0.3, TUNNEL_H, z + 3.5),
                YELLOW,
            );
            z = zb;
        }
    }
}

/// Track, ground, walls, buildings and lamps from `z0` to `z1`.
pub fn draw_world(t: &Textures, z0: f32, z1: f32) {
    let start = (z0 / CELL).floor() as i32;
    let end = (z1 / CELL).ceil() as i32;
    let edge = 1.5 * LANE_W;
    for k in start..end {
        let (a, b) = (k as f32 * CELL, (k + 1) as f32 * CELL);
        for lane in 0..3 {
            let x = lane_x(lane);
            let (l, r) = (x - LANE_W / 2.0, x + LANE_W / 2.0);
            tex_quad(
                &t.track,
                [
                    vec3(l, 0.0, a),
                    vec3(r, 0.0, a),
                    vec3(r, 0.0, b),
                    vec3(l, 0.0, b),
                ],
            );
        }
        for s in [-1.0, 1.0] {
            let (i, o) = (s * (edge + 0.3), s * 30.0);
            tex_quad(
                &t.gravel,
                [
                    vec3(i, 0.0, a),
                    vec3(o, 0.0, a),
                    vec3(o, 0.0, b),
                    vec3(i, 0.0, b),
                ],
            );
            // Low wall along the outer lanes.
            let (wi, wo) = (s * edge, s * (edge + 0.3));
            tex_quad(
                &t.wall,
                [
                    vec3(wi, 0.0, a),
                    vec3(wi, 0.0, b),
                    vec3(wi, 0.7, b),
                    vec3(wi, 0.7, a),
                ],
            );
            block(vec3(wi.min(wo), 0.69, a), vec3(wi.max(wo), 0.7, b), GRAY);
        }
        // Lamp posts every 12 m.
        if k.rem_euclid(4) == 0 && tunnel_at(a).is_none() {
            for s in [-1.0f32, 1.0] {
                let x = s * (edge + 0.8);
                block(vec3(x - 0.08, 0.0, a), vec3(x + 0.08, 4.2, a + 0.16), GRAY);
                let arm = x - s * 0.9;
                block(
                    vec3(x.min(arm), 4.1, a),
                    vec3(x.max(arm), 4.2, a + 0.16),
                    GRAY,
                );
                block(
                    vec3(arm - 0.2, 3.95, a - 0.05),
                    vec3(arm + 0.2, 4.1, a + 0.21),
                    YELLOW,
                );
            }
        }
    }
    draw_tunnels(t, z0, z1);
    // Buildings in 10 m slots on both sides.
    let (s0, s1) = ((z0 / 10.0).floor() as i32, (z1 / 10.0).ceil() as i32);
    for k in s0..s1 {
        for (side, s) in [(0, -1.0f32), (1, 1.0)] {
            let h = hash(k, side);
            if h.is_multiple_of(7) {
                continue;
            }
            let za = k as f32 * 10.0 + 0.5;
            let zb = za + 9.0;
            let height = 8.0 + (h >> 8) as f32 % 14.0;
            let inner = s * (8.0 + (h >> 4) as f32 % 3.0);
            let outer = s * 20.0;
            let tex = &t.facades[(h >> 12) as usize % t.facades.len()];
            // Face toward the track, and the face toward the camera.
            tex_quad(
                tex,
                [
                    vec3(inner, 0.0, za),
                    vec3(inner, 0.0, zb),
                    vec3(inner, height, zb),
                    vec3(inner, height, za),
                ],
            );
            tex_quad(
                tex,
                [
                    vec3(outer, 0.0, za),
                    vec3(inner, 0.0, za),
                    vec3(inner, height, za),
                    vec3(outer, height, za),
                ],
            );
            block(
                vec3(inner.min(outer), height, za),
                vec3(inner.max(outer), height + 0.3, zb),
                INK,
            );
        }
    }
}

/// One obstacle.
pub fn draw_obstacle(t: &Textures, o: &Obstacle) {
    if o.broken {
        return;
    }
    let x = lane_x(o.lane);
    let (l, r) = (x - LANE_HALF, x + LANE_HALF);
    let post =
        |x0: f32, top: f32| block(vec3(x0 - 0.08, 0.0, o.z0), vec3(x0 + 0.08, top, o.z1), GRAY);
    match o.kind {
        Kind::Hurdle => {
            post(l + 0.1, HURDLE_H);
            post(r - 0.1, HURDLE_H);
            let (y0, z) = (HURDLE_H - 0.45, o.z0);
            block(vec3(l, y0, z + 0.05), vec3(r, HURDLE_H, o.z1 - 0.05), RED);
            tex_quad(
                &t.hurdle,
                [
                    vec3(l, y0, z),
                    vec3(r, y0, z),
                    vec3(r, HURDLE_H, z),
                    vec3(l, HURDLE_H, z),
                ],
            );
        }
        Kind::Bar => {
            post(l + 0.1, BAR_Y1);
            post(r - 0.1, BAR_Y1);
            let z = o.z0;
            block(
                vec3(l, BAR_Y0, z + 0.05),
                vec3(r, BAR_Y1, o.z1 - 0.05),
                WHITE,
            );
            tex_quad(
                &t.bar,
                [
                    vec3(l, BAR_Y0, z),
                    vec3(r, BAR_Y0, z),
                    vec3(r, BAR_Y1, z),
                    vec3(l, BAR_Y1, z),
                ],
            );
        }
        Kind::Block => {
            let z = o.z0;
            block(vec3(l, 0.0, z + 0.05), vec3(r, BLOCK_H, o.z1), YELLOW);
            tex_quad(
                &t.block,
                [
                    vec3(l, 0.0, z),
                    vec3(r, 0.0, z),
                    vec3(r, BLOCK_H, z),
                    vec3(l, BLOCK_H, z),
                ],
            );
        }
        Kind::Ramp => {
            let (a, b) = (o.z0, o.z1);
            tex_quad(
                &t.ramp,
                [
                    vec3(l, 0.0, a),
                    vec3(r, 0.0, a),
                    vec3(r, TRAIN_H, b),
                    vec3(l, TRAIN_H, b),
                ],
            );
            for sx in [l, r] {
                cuboid(
                    [
                        vec3(sx, 0.0, a),
                        vec3(sx, 0.0, a),
                        vec3(sx, 0.0, a),
                        vec3(sx, 0.0, a),
                        vec3(sx, 0.0, b),
                        vec3(sx, 0.0, b),
                        vec3(sx, TRAIN_H, b),
                        vec3(sx, TRAIN_H, b),
                    ],
                    GRAY,
                );
            }
        }
        Kind::Train | Kind::Oncoming => draw_train(t, o, l, r),
    }
}

fn draw_train(t: &Textures, o: &Obstacle, l: f32, r: f32) {
    let (a, b, h) = (o.z0, o.z1, TRAIN_H);
    let side = t.side(o.color);
    let n = ((b - a) / CELL).round().max(1.0) as usize;
    let seg = (b - a) / n as f32;
    for i in 0..n {
        let (za, zb) = (a + i as f32 * seg, a + (i + 1) as f32 * seg);
        tex_quad(
            side,
            [
                vec3(l, 0.0, za),
                vec3(l, 0.0, zb),
                vec3(l, h, zb),
                vec3(l, h, za),
            ],
        );
        tex_quad(
            side,
            [
                vec3(r, 0.0, zb),
                vec3(r, 0.0, za),
                vec3(r, h, za),
                vec3(r, h, zb),
            ],
        );
    }
    // The top face of a block is drawn in the lit shade of its color.
    block(vec3(l, h - 0.01, a), vec3(r, h, b), o.color);
    // A roof vent per car.
    for i in (1..n).step_by(3) {
        let z = a + i as f32 * seg;
        block(vec3(l + 0.4, h, z), vec3(r - 0.4, h + 0.12, z + 1.0), GRAY);
    }
    tex_quad(
        t.front(o.color),
        [
            vec3(l, 0.0, a),
            vec3(r, 0.0, a),
            vec3(r, h, a),
            vec3(l, h, a),
        ],
    );
    if o.kind == Kind::Oncoming {
        // Paired bright lamps and a roof beacon distinguish moving stock from
        // parked cars before it enters collision range, even without color.
        for x in [l + 0.25, r - 0.25] {
            block(
                vec3(x - 0.12, 0.7, a - 0.04),
                vec3(x + 0.12, 0.94, a),
                YELLOW,
            );
        }
        block(
            vec3(-0.18 + lane_x(o.lane), h, a + 0.25),
            vec3(0.18 + lane_x(o.lane), h + 0.12, a + 0.6),
            ORANGE,
        );
    }
    block(vec3(l, 0.0, b - 0.01), vec3(r, h, b), o.color);
}

/// Where the camera sits for a run (smoothed by the caller). `pull` in
/// 0..=1 backs the camera up and raises it, for the crash scene.
pub fn camera_for(focus: Vec3, shake: f32, time: f32, pull: f32) -> (Vec3, Vec3) {
    let jitter = vec3((time * 53.0).sin(), (time * 41.0).cos(), 0.0) * shake * 0.12;
    let eye = focus + vec3(0.0, 3.4 + 1.2 * pull, -6.0 - 2.0 * pull) + jitter;
    let target = focus + vec3(0.0, 1.1, 7.0) + jitter;
    (eye, target)
}

/// Draw everything in a run except the runner's own effects.
pub fn draw_run(run: &Run, t: &Textures, cam_z: f32, outfit: usize) {
    let z1 = cam_z + DRAW_AHEAD;
    draw_world(t, cam_z, z1);
    // Anything already passed would only block the view of the runner.
    let behind = run.runner.z - 1.5;
    for o in &run.track.obstacles {
        if o.z1 > behind && o.z0 < z1 {
            draw_obstacle(t, o);
        }
    }
    for c in &run.track.coins {
        if !c.taken && c.pos.z > behind && c.pos.z < z1 {
            models::coin(c.pos, run.time * 4.0 + c.pos.z * 0.3);
        }
    }
    for p in &run.track.pickups {
        if !p.taken && p.pos.z > cam_z && p.pos.z < z1 {
            let bob = (run.time * 3.0 + p.pos.z).sin() * 0.15;
            models::pickup(p.power, p.pos + vec3(0.0, bob, 0.0), run.time * 2.0);
        }
    }
    models::runner(run, outfit);
    models::drone(run.drone_pos(), run.runner.lane, run.time);
    for p in &run.particles.list {
        let h = vec3(p.size, p.size, p.size) / 2.0;
        block(p.pos - h, p.pos + h, p.color);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shading_stays_in_the_palette() {
        for c in 0..16u8 {
            let (a, b) = shade(c);
            assert!(a < 16 && b < 16);
        }
    }

    #[test]
    fn hash_varies() {
        assert_ne!(hash(1, 0), hash(2, 0));
        assert_ne!(hash(1, 0), hash(1, 1));
    }
}
