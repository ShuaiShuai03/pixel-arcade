//! Developer input script: `--script "60:enter,120:shot,121:quit"` replays
//! timed actions at fixed-update frame numbers. Used to capture screenshots
//! reproducibly (e.g. for the README) without OS-level automation.

#[cfg_attr(target_arch = "wasm32", allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Key(ScriptKey),
    /// Toggle the autopilot for the current run.
    Bot,
    Shot,
    Quit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScriptKey {
    Up,
    Down,
    Left,
    Right,
    Confirm,
    Back,
    Board,
}

#[derive(Default)]
pub struct Script {
    events: Vec<(u64, Action)>,
}

impl Script {
    /// Read `--script <spec>` from the process arguments.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn from_args() -> Self {
        let args: Vec<String> = std::env::args().collect();
        args.iter()
            .position(|a| a == "--script")
            .and_then(|i| args.get(i + 1))
            .map(|spec| Self::parse(spec))
            .unwrap_or_default()
    }

    #[cfg(target_arch = "wasm32")]
    pub fn from_args() -> Self {
        Self::default()
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn parse(spec: &str) -> Self {
        let mut events: Vec<(u64, Action)> = spec
            .split(',')
            .filter_map(|item| {
                let (frame, name) = item.trim().split_once(':')?;
                let action = match name {
                    "up" | "jump" => Action::Key(ScriptKey::Up),
                    "down" | "roll" => Action::Key(ScriptKey::Down),
                    "left" => Action::Key(ScriptKey::Left),
                    "right" => Action::Key(ScriptKey::Right),
                    "enter" => Action::Key(ScriptKey::Confirm),
                    "esc" => Action::Key(ScriptKey::Back),
                    "board" => Action::Key(ScriptKey::Board),
                    "shot" => Action::Shot,
                    "bot" => Action::Bot,
                    "quit" => Action::Quit,
                    _ => return None,
                };
                Some((frame.parse().ok()?, action))
            })
            .collect();
        events.sort_by_key(|(f, _)| *f);
        Self { events }
    }

    pub fn is_active(&self) -> bool {
        !self.events.is_empty()
    }

    /// Actions scheduled for `frame`.
    pub fn actions_at(&self, frame: u64) -> impl Iterator<Item = Action> + '_ {
        self.events
            .iter()
            .filter(move |(f, _)| *f == frame)
            .map(|(_, a)| *a)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_sorts_ignoring_junk() {
        let s = Script::parse("20:shot, 5:jump,bogus,7:nope,9:quit");
        assert_eq!(
            s.events,
            vec![
                (5, Action::Key(ScriptKey::Up)),
                (9, Action::Quit),
                (20, Action::Shot)
            ]
        );
        assert_eq!(s.actions_at(9).collect::<Vec<_>>(), vec![Action::Quit]);
        assert_eq!(s.actions_at(10).count(), 0);
    }
}
