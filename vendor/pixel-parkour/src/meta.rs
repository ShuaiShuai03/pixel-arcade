//! Progression between runs: mission sets that raise the score multiplier,
//! and the shop (power-up upgrades and runner outfits).

use crate::i18n::{fill, tr};
use crate::run::{MAX_UPGRADE, Stats};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Goal {
    /// Collect coins in one run.
    Coins,
    Jumps,
    Rolls,
    /// Run a distance in one run.
    Meters,
    Score,
    /// Pick up power-ups (across runs).
    PowerUps,
    /// Change lanes (across runs).
    Moves,
    /// Run on train roofs in one run.
    Roofs,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Mission {
    pub goal: Goal,
    pub target: u32,
}

impl Mission {
    /// Missions that add up over several runs instead of needing one run.
    pub fn cumulative(&self) -> bool {
        matches!(
            self.goal,
            Goal::PowerUps | Goal::Moves | Goal::Jumps | Goal::Rolls
        )
    }

    pub fn text(&self) -> String {
        let template = match self.goal {
            Goal::Coins => tr("COLLECT {} COINS IN ONE RUN", "单局收集 {} 枚金币"),
            Goal::Jumps => tr("JUMP {} TIMES", "跳跃 {} 次"),
            Goal::Rolls => tr("ROLL {} TIMES", "下滑 {} 次"),
            Goal::Meters => tr("RUN {}M IN ONE RUN", "单局跑 {} 米"),
            Goal::Score => tr("SCORE {} IN ONE RUN", "单局得分 {}"),
            Goal::PowerUps => tr("PICK UP {} POWER-UPS", "拾取 {} 个道具"),
            Goal::Moves => tr("CHANGE LANES {} TIMES", "换道 {} 次"),
            Goal::Roofs => tr("RUN {}M ON TRAIN ROOFS", "在车顶上跑 {} 米"),
        };
        fill(template, &[&self.target])
    }

    /// This run's contribution toward the mission.
    pub fn value(&self, stats: &Stats, meters: u32, score: u32) -> u32 {
        match self.goal {
            Goal::Coins => stats.coins,
            Goal::Jumps => stats.jumps,
            Goal::Rolls => stats.rolls,
            Goal::Meters => meters,
            Goal::Score => score,
            Goal::PowerUps => stats.powerups,
            Goal::Moves => stats.moves,
            Goal::Roofs => stats.roof_meters as u32,
        }
    }
}

/// Highest mission set; the multiplier is `set + 1`.
pub const MAX_SET: u32 = 29;

/// The three missions of a set. Deterministic, and harder each set.
pub fn missions(set: u32) -> [Mission; 3] {
    const ROTATION: [Goal; 8] = [
        Goal::Coins,
        Goal::Jumps,
        Goal::Meters,
        Goal::Rolls,
        Goal::PowerUps,
        Goal::Score,
        Goal::Moves,
        Goal::Roofs,
    ];
    let k = set + 1;
    std::array::from_fn(|i| {
        let goal = ROTATION[(set as usize * 3 + i) % ROTATION.len()];
        let target = match goal {
            Goal::Coins => 50 + 40 * k,
            Goal::Jumps => 10 + 10 * k,
            Goal::Rolls => 10 + 8 * k,
            Goal::Meters => 300 + 250 * k,
            Goal::Score => 1000 + 1500 * k,
            Goal::PowerUps => 1 + k,
            Goal::Moves => 30 + 20 * k,
            Goal::Roofs => 40 + 40 * k,
        };
        Mission { goal, target }
    })
}

/// Upgradable power-ups as (English, Chinese) names.
pub const UPGRADE_NAMES: [(&str, &str); 4] = [
    ("MAGNET", "磁铁"),
    ("GLIDER", "飞翼"),
    ("SPRING SHOES", "弹簧鞋"),
    ("DOUBLE SCORE", "双倍分数"),
];

/// Price of one hoverboard (used from the inventory during a run).
pub const BOARD_PRICE: u32 = 300;

/// Price of the next upgrade level, or None when maxed.
pub fn upgrade_cost(level: u8) -> Option<u32> {
    (level < MAX_UPGRADE).then(|| 250 * 2u32.pow(level as u32))
}

/// Runner outfits: name, price, and palette colors (jacket, trousers, cap).
pub struct Outfit {
    pub name: &'static str,
    pub price: u32,
    pub jacket: u8,
    pub trousers: u8,
    pub cap: u8,
}

pub const OUTFITS: [Outfit; 4] = [
    Outfit {
        name: "DASH",
        price: 0,
        jacket: crate::art::palette::RED,
        trousers: crate::art::palette::DARK_BLUE,
        cap: crate::art::palette::YELLOW,
    },
    Outfit {
        name: "VOLT",
        price: 1500,
        jacket: crate::art::palette::YELLOW,
        trousers: crate::art::palette::INK,
        cap: crate::art::palette::LIGHT_BLUE,
    },
    Outfit {
        name: "MOSS",
        price: 3000,
        jacket: crate::art::palette::GREEN,
        trousers: crate::art::palette::BROWN,
        cap: crate::art::palette::ORANGE,
    },
    Outfit {
        name: "NOVA",
        price: 6000,
        jacket: crate::art::palette::LAVENDER,
        trousers: crate::art::palette::WHITE,
        cap: crate::art::palette::RED,
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sets_mix_goals_and_get_harder() {
        for set in 0..=MAX_SET {
            let m = missions(set);
            assert!(m[0].goal != m[1].goal && m[1].goal != m[2].goal && m[0].goal != m[2].goal);
            assert!(m.iter().all(|m| m.target > 0 && !m.text().is_empty()));
        }
        let first = missions(0)[0];
        let later = missions(8)[0];
        assert_eq!(first.goal, later.goal);
        assert!(later.target > first.target);
    }

    #[test]
    fn upgrades_double_in_price_and_cap() {
        assert_eq!(upgrade_cost(0), Some(250));
        assert_eq!(upgrade_cost(1), Some(500));
        assert_eq!(upgrade_cost(MAX_UPGRADE), None);
    }

    #[test]
    fn first_outfit_is_free_and_names_are_unique() {
        assert_eq!(OUTFITS[0].price, 0);
        for (i, a) in OUTFITS.iter().enumerate() {
            for b in &OUTFITS[i + 1..] {
                assert_ne!(a.name, b.name);
            }
        }
    }
}
