// Pixel sprites and the hull rectangles built from them. Every solid pixel row is a collision rectangle.
export const PLAYER = [
  '......aa......',
  '.....aaaa.....',
  '.....abba.....',
  '....aabbaa....',
  '...aaabbaaa...',
  '..aaaabbaaaa..',
  'aaaaaabbaaaaaa',
  'aaaaaabbaaaaaa',
  '..aaaccccaaa..',
  '...aaccccaa...',
  '...aa.aa.aa...',
  '...aa.aa.aa...',
  '....a....a....',
  '....a....a....',
];
const SCOUT = [
  '.....aa.....',
  '....aaaa....',
  '...aabbaa...',
  'aaaaabbaaaaa',
  'aaaaabbaaaaa',
  '..aaacaaa...',
  '...aaaaaa...',
  '....a..a....',
  '....a..a....',
];
const SKIMMER = [
  'aa..........aa',
  'aaa........aaa',
  'aaaa..aa..aaaa',
  '.aaaaaaaaaaaa.',
  '..aaaabbaaaa..',
  '...aaabbaaa...',
  '....aacaaa....',
  '....aa..aa....',
  '.....a..a.....',
];
const GUNSHIP = [
  '....aaaaaa....',
  '...aabbbbaa...',
  '..aaabbbbaaa..',
  'aaaaaaaaaaaaaa',
  'aaccaaaaaaccaa',
  'aaccaaaaaaccaa',
  'aaaaaaaaaaaaaa',
  '..aaaccccaaa..',
  '...aaaaaaaa...',
  '...aa....aa...',
  '...aa....aa...',
];
const SNIPER = [
  '.....aa.....',
  '.....aa.....',
  '....abba....',
  '....abba....',
  '..aaabbaaa..',
  '.aaaaccaaaa.',
  'aaa.aaaa.aaa',
  'aa..aaaa..aa',
  '....a..a....',
  '....a..a....',
];
const BOMBER = [
  '..aaaaaaaaaaaaaa..',
  '.aaabbbbbbbbbbaaa.',
  'aaaaaaaaaaaaaaaaaa',
  'aacaaaaaaaaaaaacaa',
  'aaaaaabbbbaaaaaaaa',
  '..aaaaaccccaaaaa..',
  '....aaaaaaaaaa....',
  '.....aa....aa.....',
];

function carrierRows({ w, h, fills }) {
  const rows = Array.from({ length: h }, () => Array(w).fill('.'));
  for (const [x, y, fw, fh, c] of fills)
    for (let j = y; j < y + fh; j++) for (let i = x; i < x + fw; i++) rows[j][i] = c;
  return rows.map((r) => r.join(''));
}
// 'l' and 'r' are the turret mounts, 'c' is the exposed core, 'h' is plain armor.
const CARRIER = carrierRows({
  w: 40,
  h: 22,
  fills: [
    [10, 3, 20, 15, 'h'],
    [6, 6, 28, 11, 'h'],
    [0, 8, 40, 6, 'h'],
    [3, 11, 7, 9, 'l'],
    [30, 11, 7, 9, 'r'],
    [17, 13, 6, 9, 'c'],
    [14, 1, 12, 4, 'h'],
  ],
});
const DREAD = carrierRows({
  w: 48,
  h: 24,
  fills: [
    [12, 3, 24, 16, 'h'],
    [7, 6, 34, 12, 'h'],
    [0, 9, 48, 6, 'h'],
    [1, 12, 8, 10, 'l'],
    [39, 12, 8, 10, 'r'],
    [21, 14, 6, 10, 'c'],
    [17, 1, 14, 4, 'h'],
  ],
});
const WASP = carrierRows({
  w: 32,
  h: 26,
  fills: [
    [9, 2, 14, 16, 'h'],
    [4, 6, 24, 10, 'h'],
    [0, 9, 32, 5, 'h'],
    [3, 12, 5, 10, 'l'],
    [24, 12, 5, 10, 'r'],
    [13, 14, 6, 10, 'c'],
    [11, 0, 10, 4, 'h'],
  ],
});

export const ATLAS = {
  player: PLAYER,
  scout: SCOUT,
  skimmer: SKIMMER,
  gunship: GUNSHIP,
  sniper: SNIPER,
  bomber: BOMBER,
  carrier: CARRIER,
  dread: DREAD,
  wasp: WASP,
};
export const CARRIER_SHAPES = ['carrier', 'dread', 'wasp'];

function buildMask(name, rows) {
  const width = Math.max(...rows.map((r) => r.length)),
    armored = CARRIER_SHAPES.includes(name),
    rects = [];
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < rows[y].length;) {
      const ch = rows[y][x];
      if (ch === '.') {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < rows[y].length && rows[y][end] !== '.' && (!armored || rows[y][end] === ch))
        end++;
      const part = armored ? ch : 'h',
        previous = rects.find(
          (r) =>
            r.x === x * 2 - width &&
            r.w === (end - x) * 2 &&
            r.y + r.h === y * 2 - rows.length &&
            r.part === part,
        );
      if (previous) previous.h += 2;
      else rects.push({ x: x * 2 - width, y: y * 2 - rows.length, w: (end - x) * 2, h: 2, part });
      x = end;
    }
  return { width: width * 2, height: rows.length * 2, rects };
}
export const MASKS = Object.fromEntries(
  Object.entries(ATLAS).map(([name, rows]) => [name, buildMask(name, rows)]),
);

const maskOf = (actor) => MASKS[actor.shape ?? (actor.boss ? 'carrier' : 'scout')] ?? MASKS.scout;
/** Solid rectangles in world space; a destroyed turret mount no longer exists. */
export function hullRects(actor) {
  return maskOf(actor)
    .rects.filter((r) => !actor.parts || !['l', 'r'].includes(r.part) || actor.parts[r.part] > 0)
    .map((r) => ({ ...r, x: r.x + actor.x, y: r.y + actor.y }));
}
export function bounds(actor) {
  const m = maskOf(actor);
  return { x: actor.x - m.width / 2, y: actor.y - m.height / 2, w: m.width, h: m.height };
}
/** Horizontal distance from the hull centre to the middle of its right turret mount, in pixels. */
export function turretOffset(shape) {
  const mounts = (MASKS[shape] ?? MASKS.carrier).rects.filter((r) => r.part === 'r'),
    area = mounts.reduce((sum, r) => sum + r.w * r.h, 0);
  return mounts.reduce((sum, r) => sum + (r.x + r.w / 2) * r.w * r.h, 0) / area;
}
export const hullHeight = (shape) => (MASKS[shape] ?? MASKS.scout).height;
