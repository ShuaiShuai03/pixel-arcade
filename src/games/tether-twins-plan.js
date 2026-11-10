// Small constructors for the declarative room data: map rows and guide steps.
export const WALL = '####################';

/** A guide step: robot `who` walks to tile (c, r) and the step ends within `tol` pixels of it. */
export const walk = (who, c, r, key, tol = 16) =>
  Object.freeze({ kind: 'walk', who, c, r, key, tol });
/** A walk that only ends once the cable is wrapped round a relay post. */
export const sweep = (who, c, r, key = 'relay', tol = 16) =>
  Object.freeze({ kind: 'walk', who, c, r, key, tol, wrap: true });
/** Like walk, but the step only ends once pulse group `group` is dark long enough to cross. */
export const wait = (who, c, r, group, key = 'dark', tol = 16) =>
  Object.freeze({ kind: 'wait', who, c, r, group, key, tol });
/** The robot stands on its own pad. */
export const pad = (who) => Object.freeze({ kind: 'pad', who, key: who ? 'padB' : 'padR' });
/** Hold reel (F) until the relay of `gate` locks. */
export const reel = (gate) => Object.freeze({ kind: 'reel', gate, key: 'reel' });
/** Hold pay out (G) until the cable is almost fully paid out. */
export const pay = () => Object.freeze({ kind: 'pay', key: 'pay' });
/** While guide steps from..to run, `need` must hold (a gate letter that is open, or 'wrap') or the guide goes back. */
export const hold = (from, to, need, back = 0) => Object.freeze({ from, to, need, back });

/** Flashing-strip timing: seconds per cycle, seconds live, the offset of the second group, and the least dark time a crossing needs. */
export const LANE = Object.freeze({ period: 4, live: 1.2, shift: 2, allow: 1.9 });
export const FAST = Object.freeze({ period: 3.6, live: 1.2, shift: 1.8, allow: 1.7 });
