// Shared geometry: hull sizes, pixel sprites and the collision masks cut from those sprites.
export const HULL = Object.freeze({ w: 28, h: 20 });
export const LINE = 236;
const SHAPES = Object.freeze({
  scout: { w: 20, h: 16 },
  diver: { w: 24, h: 16 },
  artillery: { w: 26, h: 20 },
  gunner: { w: 26, h: 16 },
  warden: { w: 24, h: 20 },
  commander: { w: 68, h: 30 },
});
/** Body size of an enemy; unknown or missing roles are scouts. */
export const body = (e) => SHAPES[e.role] || SHAPES.scout;

const SPRITE_ROWS = {
  scout: [
    '..a....a..',
    '...a..a...',
    '..aaaaaa..',
    '.aa.bb.aa.',
    'aaaaaaaaaa',
    'a.aaaaaa.a',
    'a.a....a.a',
    '..aa..aa..',
  ],
  diver: [
    'a..........a',
    '.aa......aa.',
    '..aaaaaaaa..',
    '...a.bb.a...',
    'aaaaaaaaaaaa',
    '..a.aaaa.a..',
    '....aaaa....',
    '.....aa.....',
  ],
  artillery: [
    '..aaaaaaaaa..',
    '.aaaaaaaaaaa.',
    'aaa.bbbbb.aaa',
    'aaaaaaaaaaaaa',
    '..aa.c.c.aa..',
    'aaaaaaaaaaaaa',
    'aaa.aaaaa.aaa',
    'aaa..aaa..aaa',
    '.aa..aaa..aa.',
    '.....aaa.....',
  ],
  gunner: [
    '..a...a...a..',
    '..a...a...a..',
    '.aaaaaaaaaaa.',
    'aaa.bbbbb.aaa',
    'aaaaaaaaaaaaa',
    '.aa.a.c.a.aa.',
    '..aaaaaaaaa..',
    '...a.....a...',
  ],
  warden: [
    '..aaaaaaaa..',
    '.aaaaaaaaaa.',
    'aaa.bbbb.aaa',
    'aaaaaaaaaaaa',
    'aa.aaaaaa.aa',
    'aaaa.cc.aaaa',
    'aaaaaaaaaaaa',
    '.aa.aaaa.aa.',
    '.aa..aa..aa.',
    '.a...aa...a.',
  ],
};
export const SPRITES = Object.freeze(
  Object.fromEntries(
    Object.entries(SPRITE_ROWS).map(([role, rows]) => [role, Object.freeze(rows)]),
  ),
);
export const SHIP = Object.freeze([
  '......aa......',
  '......aa......',
  '.....aaaa.....',
  '.....abba.....',
  '....aabbaa....',
  '..aaaaaaaaaa..',
  '.aaaaaaaaaaaa.',
  'aaaaaaaaaaaaaa',
  'aa..aa..aa..aa',
  'aa..aa..aa..aa',
]);
export const BONUS = Object.freeze([
  '...aaaaaaaa...',
  '.aaaaaaaaaaaa.',
  'aaaaaaaaaaaaaa',
  '..aa.a..a.aa..',
]);

/** Merge a sprite's filled cells into the fewest vertical-run rectangles. */
function maskFromSprite(rows, scale) {
  const rectangles = [];
  rows.forEach((row, y) => {
    let start = -1;
    for (let x = 0; x <= row.length; x++) {
      if (x < row.length && row[x] !== '.') {
        if (start < 0) start = x;
      } else if (start >= 0) {
        const px = start * scale,
          w = (x - start) * scale;
        const prior = rectangles.find((r) => r.x === px && r.w === w && r.y + r.h === y * scale);
        if (prior) prior.h += scale;
        else rectangles.push({ x: px, y: y * scale, w, h: scale });
        start = -1;
      }
    }
  });
  return Object.freeze(rectangles.map((r) => Object.freeze(r)));
}
export const MASKS = Object.freeze({
  ...Object.fromEntries(
    Object.entries(SPRITES).map(([role, rows]) => [role, maskFromSprite(rows, 2)]),
  ),
  player: maskFromSprite(SHIP, 2),
  bonus: maskFromSprite(BONUS, 3),
  commander: Object.freeze(
    [
      { x: 0, y: 5, w: 68, h: 20 },
      { x: 8, y: 0, w: 52, h: 30 },
      { x: 3, y: 24, w: 8, h: 6 },
      { x: 57, y: 24, w: 8, h: 6 },
    ].map((r) => Object.freeze(r)),
  ),
});
