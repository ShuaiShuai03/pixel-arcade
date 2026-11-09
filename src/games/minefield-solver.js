// Pure-logic proof engine. It reads only what a player can see: revealed clues, sector
// totals, the total mine count, and probe-verified mines. Player flags are never premises.
import { neighbors } from './minefield-field.js';

export const cellName = (i, w) => String.fromCharCode(65 + (i % w)) + (Math.floor(i / w) + 1);

const byIndex = (a, b) => a - b;
const MAX_DERIVED = 256;

function visibleConstraints(field, revealed, verified) {
  const constraints = [];
  const add = (cells, count, title) => {
    if (cells.length && count >= 0 && count <= cells.length)
      constraints.push({ cells: cells.toSorted(byIndex), count, title });
  };
  for (let i = 0; i < revealed.length; i++) {
    if (!revealed[i]) continue;
    const near = neighbors(i, field.w, field.h).filter((n) => field.mask[n]);
    add(
      near.filter((n) => !revealed[n] && !verified[n]),
      field.numbers[i] - near.filter((n) => verified[n]).length,
      { en: `Clue ${cellName(i, field.w)}`, zh: `线索 ${cellName(i, field.w)}` },
    );
  }
  add(
    field.mask.flatMap((v, i) => (v && !revealed[i] && !verified[i] ? [i] : [])),
    field.count - verified.filter(Boolean).length,
    { en: 'Total mine count', zh: '总雷数' },
  );
  for (const r of field.regions)
    add(
      r.cells.filter((i) => !revealed[i] && !verified[i]),
      r.total - r.cells.filter((i) => verified[i]).length,
      { en: r.name.en, zh: r.name.zh },
    );
  return constraints;
}

function deduceOnce(field, revealed, verified) {
  const constraints = visibleConstraints(field, revealed, verified),
    safe = new Set(),
    mines = new Set(),
    proofs = new Map();
  for (let pass = 0; pass < field.w * field.h; pass++) {
    let progress = false;
    const reduced = [],
      seen = new Set();
    const inspect = (c) => {
      const type = c.count === 0 ? 'safe' : c.count === c.cells.length ? 'mine' : null;
      if (!type) return;
      const set = type === 'safe' ? safe : mines;
      for (const i of c.cells) {
        if (set.has(i)) continue;
        set.add(i);
        progress = true;
        proofs.set(i, { target: i, type, source: c.title, cells: c.cells.slice(), count: c.count });
      }
    };
    for (const original of constraints) {
      const cells = original.cells.filter((i) => !safe.has(i) && !mines.has(i)),
        count = original.count - original.cells.filter((i) => mines.has(i)).length;
      if (!cells.length || count < 0 || count > cells.length) continue;
      const key = cells.join(',') + ':' + count;
      if (seen.has(key)) continue;
      seen.add(key);
      const c = { ...original, cells, count };
      reduced.push(c);
      inspect(c);
    }
    if (!progress) {
      for (const a of reduced.slice())
        for (const b of reduced.slice()) {
          if (a.cells.length >= b.cells.length || !a.cells.every((i) => b.cells.includes(i)))
            continue;
          const cells = b.cells.filter((i) => !a.cells.includes(i)),
            count = b.count - a.count,
            key = cells.join(',') + ':' + count;
          if (count < 0 || count > cells.length || seen.has(key)) continue;
          seen.add(key);
          const derived = {
            cells,
            count,
            title: {
              en: `${b.title.en} minus ${a.title.en}`,
              zh: `${b.title.zh}减去${a.title.zh}`,
            },
          };
          inspect(derived);
          if (reduced.length < MAX_DERIVED) reduced.push(derived);
        }
    }
    if (!progress && reduced.length === constraints.length) break;
    constraints.splice(0, constraints.length, ...reduced);
    if (!constraints.length) break;
  }
  return { safe: [...safe].toSorted(byIndex), mines: [...mines].toSorted(byIndex), proofs };
}

/** Repeats the proof pass, feeding proven mines back in, until nothing new is found. */
export function deduceVisible(field, revealed, verified = Array(field.w * field.h).fill(false)) {
  const known = verified.slice(),
    safe = new Set(),
    mines = new Set(),
    proofs = new Map();
  for (let grew = true; grew;) {
    grew = false;
    const found = deduceOnce(field, revealed, known);
    for (const i of found.safe)
      if (!safe.has(i)) {
        safe.add(i);
        proofs.set(i, found.proofs.get(i));
        grew = true;
      }
    for (const i of found.mines) {
      if (mines.has(i)) continue;
      mines.add(i);
      known[i] = true;
      proofs.set(i, found.proofs.get(i));
      grew = true;
    }
  }
  return { safe: [...safe].toSorted(byIndex), mines: [...mines].toSorted(byIndex), proofs };
}
