import { background, drawPixelText as text, clamp } from '../shared/utils.js';
import {
  GAP,
  GROUND,
  LEVELS,
  LEVEL_COUNT,
  PX,
  R,
  TWO_PI,
  gateLevel,
  levelOf,
} from './tide-lock-world.js';

export const DECK_GATES = 262;
export const DECK_VALVES = 290;
export const DECK_W = 46;

// Where each control sits on the deck, and where else on the scene a tap on it lands.
export function controlLayout(c) {
  const spread = (list, y) => {
    let last = -99;
    return list.map((item) => {
      const x = Math.max(item.x, last + DECK_W + 2);
      last = x;
      return { x: Math.min(x, 480 - DECK_W / 2 - 2), y };
    });
  };
  return {
    valves: spread(c.valves, DECK_VALVES).reduce((out, p, k) => {
      const v = c.valves[k];
      const remote = v.b >= 0 && Math.abs(v.a - v.b) > 1;
      const sy = v.pump || remote ? GROUND + 8 : GROUND - 14 - v.sill * PX;
      // valves that would share one spot on the scene are fanned out so each can be tapped
      let sx = v.x;
      out.forEach((o) => {
        if (Math.abs(o.sx - sx) < 12 && o.sy === sy) sx += 14;
      });
      return [...out, { ...p, sx, sy }];
    }, []),
    gates: spread(c.gates, DECK_GATES).map((p, j) => ({
      ...p,
      sx: c.gates[j].x,
      sy: GROUND - 135,
    })),
  };
}

export const MENU_X = 24;
export const MENU_Y = 62;
export const MENU_CELL = 66;
export const MENU_ROW = 46;
export function menuCellAt(x, y) {
  const col = Math.floor((x - MENU_X) / MENU_CELL);
  const row = Math.floor((y - MENU_Y) / MENU_ROW);
  if (col < 0 || col >= R.menuCols || row < 0 || y < MENU_Y) return -1;
  return row * R.menuCols + col + 1;
}

// --- Drawing ------------------------------------------------------------------------------------------

export const box = (ctx, color, x, y, w, h) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};
export const yOf = (level) => GROUND - level * PX;

// Boats are told apart by number as well as colour: a 3 x 5 pixel digit on the flag and the berth.
const DIGITS = {
  1: '010110010010111',
  2: '111001111100111',
  3: '111001111001111',
  4: '101101111001001',
  5: '111100111001111',
  6: '111100111101111',
  7: '111001001001001',
  8: '111101111101111',
  9: '111101111001111',
};
export function drawDigit(ctx, digit, x, y, color) {
  const bits = DIGITS[digit] || DIGITS[1];
  for (let i = 0; i < bits.length; i++)
    if (bits[i] === '1') box(ctx, color, x + (i % 3), y + Math.floor(i / 3), 1, 1);
}

// Open is a solid mark, shut is an empty frame, so the state does not rest on green against red.
export function drawState(ctx, open, x, y, w, h, color, inner = '#161c27') {
  box(ctx, color, x, y, w, h);
  if (!open) box(ctx, inner, x + 2, y + 2, w - 4, h - 4);
}
export const BOAT_COLORS = ['#e4572e', '#f2c14e', '#7bd389'];
export const WATER = 'rgba(58,144,226,0.62)';

export function drawSky(ctx, s) {
  box(ctx, '#0a1a30', 0, 0, 480, 80);
  box(ctx, '#10294a', 0, 80, 480, 80);
  box(ctx, '#17415e', 0, 160, 480, 80);
  for (let i = 0; i < 18; i++) box(ctx, '#9fb8d8', (i * 97 + 31) % 480, 40 + ((i * 53) % 60), 1, 1);
  const swing = s.c.tidal ? Math.sin(TWO_PI * (s.w.time / s.c.nodes.find((n) => n.sea).period)) : 0;
  box(ctx, '#e8e6c8', 440, 52 - swing * 6, 10, 10);
  box(ctx, '#0a1a30', 444, 50 - swing * 6, 8, 8);
}

export function drawBeds(ctx, c) {
  c.nodes.forEach((n) => {
    box(ctx, '#2c3340', n.x, GROUND - 3, n.w, 3);
    if (n.fl > 0) {
      box(ctx, '#a48d5c', n.x, yOf(n.fl), n.w, n.fl * PX);
      for (let x = n.x + 3; x < n.x + n.w - 2; x += 7)
        box(ctx, '#7d6a42', x, yOf(n.fl) + 3 + (x % 5), 2, 2);
    }
  });
}

export function drawWaterBody(ctx, s, n, i) {
  const w = s.w;
  const y = Math.round(yOf(levelOf(w, i)));
  const bottom = yOf(n.fl);
  if (y >= bottom) return;
  ctx.fillStyle = WATER;
  ctx.fillRect(n.x, y, n.w, bottom - y);
  const wave = n.sea ? 2 : 1;
  for (let x = 0; x < n.w; x += 3) {
    const dy = Math.round(Math.sin((x + s.ticks / 5) / 5) * wave);
    box(ctx, '#bfe6ff', n.x + x, y + dy, 3, 1);
  }
}

export function drawBoat(ctx, s, k) {
  const w = s.w;
  const c = s.c;
  const b = w.boats[k];
  const cb = c.boats[k];
  const lvl = b.cross
    ? (levelOf(w, c.gates[b.cross.g].a) + levelOf(w, c.gates[b.cross.g].b)) / 2
    : levelOf(w, b.node);
  const ys = Math.round(yOf(lvl));
  const color = BOAT_COLORS[k % BOAT_COLORS.length];
  const x = Math.round(b.x);
  const keel = Math.max(3, Math.round(cb.d * PX));
  for (let r = 0; r < keel + 8; r++) {
    const half = r < 8 ? 13 - Math.floor(r / 3) : Math.max(5, 11 - Math.floor((r - 8) / 5));
    const tint = r < 8 ? color : '#6b4a2a';
    box(ctx, tint, x - half, ys - 8 + r, half * 2, 1);
  }
  box(ctx, '#f4efe0', x - 5, ys - 15, 9, 7);
  box(ctx, '#2b4a6b', x - 3, ys - 13, 3, 3);
  box(ctx, '#caa56a', x + 4, ys - 11, 6, 3);
  box(ctx, '#d9d2c0', x - 1, ys - 27, 1, 12);
  box(ctx, color, x, ys - 27, 7, 9);
  drawDigit(ctx, k + 1, x + 2, ys - 25, '#1b1b1b');
  if (b.ground > 0.2) {
    box(ctx, '#ff4d4d', x - 13, ys - 31, 26, 3);
    box(
      ctx,
      '#ffffff',
      x - 13,
      ys - 31,
      Math.round(26 * clamp(1 - b.ground / R.groundGrace, 0, 1)),
      3,
    );
  }
}

export function drawWalls(ctx, s) {
  const c = s.c;
  const w = s.w;
  const tops = c.nodes.map((n) => yOf(n.top));
  const column = (x, topY) => {
    box(ctx, '#5d6573', x, topY, GAP, GROUND - topY);
    for (let y = topY; y < GROUND; y += 6) {
      box(ctx, '#474e5b', x, y, GAP, 1);
      box(ctx, '#474e5b', x + (((y - topY) / 6) % 2 ? 3 : 8), y, 1, 6);
    }
    box(ctx, '#7a8394', x, topY, GAP, 2);
  };
  c.nodes.forEach((n, i) => {
    if (i === 0 && !n.sea) column(n.x - GAP, tops[0]);
    if (i === c.nodes.length - 1 && !n.sea) column(n.x + n.w, tops[i]);
    if (n.top < 5.4) {
      for (let x = n.x; x < n.x + n.w; x += 6) box(ctx, '#ff9a3c', x, tops[i], 3, 2);
    }
  });
  for (let i = 0; i < c.nodes.length - 1; i++) {
    const x = c.nodes[i].x + c.nodes[i].w;
    const topY = Math.min(tops[i], tops[i + 1]);
    const gj = c.gates.findIndex((g) => g.a === i && g.b === i + 1);
    if (gj < 0) {
      column(x, topY);
      continue;
    }
    const sillY = yOf(c.gates[gj].sill);
    box(ctx, '#5d6573', x, topY, GAP, 8);
    box(ctx, '#7a8394', x, topY, GAP, 2);
    box(ctx, '#5d6573', x, sillY, GAP, GROUND - sillY);
    const p = w.gates[gj].p;
    const door = Math.round((sillY - topY - 8) * (1 - p));
    if (door > 0) {
      box(ctx, '#8a5a2b', x + 1, topY + 8, GAP - 2, door);
      for (let y = topY + 10; y < topY + 8 + door; y += 5)
        box(ctx, '#5f3d1b', x + 1, y, GAP - 2, 1);
    }
    const gateOpen = w.gates[gj].open;
    drawState(ctx, gateOpen, x + 3, topY + 2, 6, 5, gateOpen ? '#53e08a' : '#ff5a4d', '#3a404c');
  }
}

export function dashedMark(ctx, n, level, ticks) {
  const y = Math.round(yOf(level));
  for (let x = n.x + ((ticks >> 2) % 6); x < n.x + n.w - 2; x += 8) box(ctx, '#ffe066', x, y, 4, 2);
  box(ctx, '#ffe066', n.x, y - 2, 3, 6);
  box(ctx, '#ffe066', n.x + n.w - 3, y - 2, 3, 6);
}

export function drawPipes(ctx, s) {
  const c = s.c;
  const w = s.w;
  c.valves.forEach((v, k) => {
    const lay = s.layout.valves[k];
    const open = w.vopen[k];
    const adjacent = v.b >= 0 && Math.abs(v.a - v.b) === 1;
    let x0;
    let x1;
    let y;
    if (adjacent) {
      x0 = v.x - GAP / 2 - 3;
      x1 = v.x + GAP / 2 + 3;
      y = lay.sy;
    } else if (v.b < 0) {
      const n = c.nodes[v.a];
      x0 = n.x + n.w / 2 - 6;
      x1 = n.x + n.w / 2 + 6;
      y = GROUND + 4;
      box(ctx, '#7b8596', x0 + 4, GROUND - 3, 4, 8);
    } else {
      const a = c.nodes[v.a];
      const b = c.nodes[v.b];
      x0 = a.x + a.w / 2;
      x1 = b.x + b.w / 2;
      y = GROUND + (v.pump ? 12 : 6);
      box(ctx, '#7b8596', x0 - 2, GROUND - 3, 4, y - GROUND + 6);
      box(ctx, '#7b8596', x1 - 2, GROUND - 3, 4, y - GROUND + 6);
    }
    box(ctx, v.pump ? '#8a6bd1' : '#7b8596', x0, y - 3, x1 - x0, 6);
    box(ctx, open ? '#2e86de' : '#2b303b', x0 + 1, y - 2, x1 - x0 - 2, 4);
    drawState(ctx, open, lay.sx - 4, y - 7, 8, 14, open ? '#53e08a' : '#ff5a4d');
    if (open && Math.abs(w.flows[k]) > 1e-6) {
      const dir = w.flows[k] > 0 ? 1 : -1;
      const len = x1 - x0;
      for (let i = 0; i < 3; i++) {
        const u = (((s.ticks * 0.9 * dir + i * (len / 3)) % len) + len) % len;
        box(ctx, '#e8f6ff', x0 + u, y - 1, 3, 2);
      }
    }
  });
}

export function drawSpill(ctx, s) {
  s.c.nodes.forEach((n, i) => {
    if (!s.w.spilling[i]) return;
    const y = yOf(n.top);
    for (let d = 0; d < 6; d++) {
      const f = (s.ticks / 3 + d * 5) % 20;
      box(ctx, '#e8f6ff', n.x + (d % 2 ? 2 : n.w - 4), y - 6 + f * 0.5, 2, 3);
    }
  });
}

export function drawPennants(ctx, s) {
  s.c.boats.forEach((b, k) => {
    const n = s.c.nodes[b.to];
    const x = n.x + n.w - 10 - k * 9;
    const y = yOf(n.top) + 4;
    box(ctx, '#d9d2c0', x, y, 1, 16);
    box(ctx, BOAT_COLORS[k % BOAT_COLORS.length], x + 1, y, 7, 9);
    drawDigit(ctx, k + 1, x + 3, y + 2, '#1b1b1b');
  });
}

export function drawDeck(ctx, s, env) {
  box(ctx, '#161c27', 0, GROUND, 480, 320 - GROUND);
  box(ctx, '#222a38', 0, GROUND, 480, 2);
  const c = s.c;
  const lay = s.layout;
  c.nodes.forEach((n, i) => {
    const name = env.t(...n.name);
    text(ctx, name, n.x + n.w / 2, GROUND + 14, '#9fb0ec', 11, 'center');
  });
  const guide = s.shown?.guide?.ctrl;
  const button = (kind, i, label, on, p, extra) => {
    const sel = s.sel.kind === kind && s.sel.i === i;
    const pulse = guide && guide.kind === kind && guide.i === i && (s.ticks >> 4) % 2 === 0;
    if (sel) box(ctx, '#ffe066', p.x - DECK_W / 2 - 2, p.y - 13, DECK_W + 4, 26);
    if (pulse) box(ctx, '#ffffff', p.x - DECK_W / 2 - 2, p.y - 13, DECK_W + 4, 26);
    box(ctx, on ? '#1f6b46' : '#5a2a2a', p.x - DECK_W / 2, p.y - 11, DECK_W, 22);
    box(ctx, on ? '#53e08a' : '#ff6b5e', p.x - DECK_W / 2, p.y - 11, 4, 22);
    drawState(ctx, on, p.x - DECK_W / 2 + 6, p.y - 5, 8, 10, on ? '#53e08a' : '#ff6b5e', '#5a2a2a');
    text(ctx, label, p.x + 4, p.y - 7, '#ffffff', 12, 'center');
    if (extra) box(ctx, extra, p.x + DECK_W / 2 - 9, p.y - 8, 5, 5);
  };
  c.gates.forEach((g, j) => {
    const lvlOk = gateLevel(s.w, j);
    button(
      'gate',
      j,
      env.t(g.label, g.labelZh),
      s.w.gates[j].open,
      lay.gates[j],
      lvlOk ? '#53e08a' : '#ffb347',
    );
  });
  c.valves.forEach((v, k) =>
    button('valve', k, env.t(v.label, v.labelZh), s.w.vopen[k], lay.valves[k], null),
  );
}

export function drawHud(ctx, s, env) {
  const c = s.c;
  box(ctx, '#070b1f', 0, 0, 480, 38);
  text(
    ctx,
    `${env.t('Lock', '船闸')} ${s.level + 1}/${LEVEL_COUNT}  ${env.t(...c.name)}`,
    6,
    3,
    '#9fb0ec',
    12,
  );
  for (let i = 0; i < R.lives; i++) {
    const x = 454 - i * 14;
    box(ctx, i < s.lives ? '#e4572e' : '#2a3350', x, 6, 10, 4);
    box(ctx, i < s.lives ? '#e4572e' : '#2a3350', x + 2, 10, 6, 3);
  }
  if (c.energy > 0) {
    box(ctx, '#2a3350', 330, 5, 64, 8);
    box(ctx, '#b99aff', 331, 6, Math.round(62 * clamp(s.w.energy / c.energy, 0, 1)), 6);
    text(ctx, env.t('Pump', '水泵'), 326, 3, '#b99aff', 11, 'right');
  }
  const line = s.shown;
  const color = line.warn ? '#ff8f8f' : line.kind === 'press' ? '#ffe066' : '#bfe6ff';
  text(ctx, env.t(line.en, line.zh), 240, 19, color, 14, 'center');
}

export function drawReadouts(ctx, s, env) {
  const w = s.w;
  s.c.nodes.forEach((n, i) => {
    const lv = levelOf(w, i);
    const arrow =
      n.sea && n.amp > 0 ? (Math.cos(TWO_PI * (w.time / n.period + n.phase)) >= 0 ? '▲' : '▼') : '';
    text(
      ctx,
      `${lv.toFixed(1)}${env.t('m', '米')}${arrow}`,
      n.x + n.w / 2,
      44,
      '#e8f6ff',
      12,
      'center',
    );
  });
}

// Approximate glyph width of the canvas font: wide for CJK, narrow for everything else.
export const textWidth = (str, size) =>
  [...str].reduce((n, ch) => n + (/[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? size : size * 0.6), 0);

// Splits `str` into lines no wider than `max` pixels, at spaces where there are some.
export function wrapText(str, size, max) {
  const lines = [];
  let line = '';
  const push = (ch) => {
    if (textWidth(line + ch, size) > max && line) {
      const cut = ch === ' ' ? -1 : line.lastIndexOf(' ');
      if (cut > 0 && !/[\u2e80-\u9fff]/.test(ch)) {
        lines.push(line.slice(0, cut));
        line = line.slice(cut + 1);
      } else {
        lines.push(line);
        line = '';
      }
    }
    if (!(ch === ' ' && !line)) line += ch;
  };
  [...str].forEach(push);
  if (line) lines.push(line);
  return lines;
}

export function bannerText(s, env) {
  if (s.msg) return { str: env.t(s.msg.en, s.msg.zh), color: '#ffe066' };
  if (s.stuck)
    return {
      str: env.t(
        'Water wasted: this lock cannot be finished. Press Enter to reset.',
        '水已浪费，本座船闸无法完成。按回车重置。',
      ),
      color: '#ff8f8f',
    };
  if (s.intro > 0) return { str: env.t(...s.c.tip), color: '#ffe066' };
  return null;
}

export function drawBanner(ctx, s, env) {
  const banner = bannerText(s, env);
  if (!banner) return;
  const lines = wrapText(banner.str, 12, 464);
  box(ctx, 'rgba(7,11,31,0.8)', 0, 58, 480, 4 + lines.length * 14);
  lines.forEach((line, n) => text(ctx, line, 240, 60 + n * 14, banner.color, 12, 'center'));
}

export function drawEnd(ctx, s, env) {
  box(ctx, 'rgba(7,11,31,0.86)', 0, 0, 480, 320);
  const won = s.phase === 'won';
  text(
    ctx,
    won ? env.t('FLEET HOME', '船队到港') : env.t('FLEET LOST', '船队覆没'),
    240,
    96,
    won ? '#7bd389' : '#ff8f8f',
    24,
    'center',
  );
  const note = won
    ? env.t('Every cargo boat reached its dock.', '每艘货船都到达了自己的码头。')
    : env.t('All three hulls are wrecked.', '三条船体都损毁了。');
  text(ctx, note, 240, 140, '#e8f6ff', 14, 'center');
  text(ctx, `${env.t('Score', '得分')} ${s.score}`, 240, 170, '#ffe066', 16, 'center');
  text(
    ctx,
    `${env.t('Locks cleared', '通过船闸')} ${s.stats.cleared}/${LEVEL_COUNT}`,
    240,
    200,
    '#9fb0ec',
    14,
    'center',
  );
}

export function drawPadlock(ctx, x, y) {
  box(ctx, '#9aa3bd', x + 1, y, 6, 2);
  box(ctx, '#9aa3bd', x + 1, y + 2, 2, 3);
  box(ctx, '#9aa3bd', x + 5, y + 2, 2, 3);
  box(ctx, '#c9a227', x, y + 5, 8, 7);
  box(ctx, '#3a2f08', x + 3, y + 7, 2, 3);
}

export function drawMenu(ctx, s, env) {
  background(ctx, '#070b1f');
  text(ctx, env.t('TIDE LOCK', '潮汐船闸'), 240, 14, '#ffe066', 16, 'center');
  const { sel, unlocked } = s.menu;
  for (let i = 1; i <= LEVEL_COUNT; i++) {
    const x = MENU_X + ((i - 1) % R.menuCols) * MENU_CELL;
    const y = MENU_Y + Math.floor((i - 1) / R.menuCols) * MENU_ROW;
    const open = i <= unlocked;
    box(ctx, i === sel ? '#ffe066' : '#3a4258', x - 2, y - 2, 56, 38);
    box(ctx, open ? '#262c3e' : '#14171f', x, y, 52, 34);
    text(ctx, String(i), x + (open ? 26 : 22), y + 10, open ? '#ffffff' : '#7a8299', 14, 'center');
    if (!open) drawPadlock(ctx, x + 38, y + 9);
  }
  const c = LEVELS[sel - 1];
  text(ctx, `${sel}/${LEVEL_COUNT}  ${env.t(...c.name)}`, 240, 262, '#ffffff', 14, 'center');
  text(
    ctx,
    env.t('Left/Right pick, Space starts', '左右键选择，空格键开始'),
    240,
    286,
    '#cfd6ea',
    12,
    'center',
  );
}

export function drawGame(ctx, s, env) {
  if (s.menu) {
    drawMenu(ctx, s, env);
    return;
  }
  const c = s.c;
  drawSky(ctx, s);
  drawBeds(ctx, c);
  c.boats.forEach((b, k) => drawBoat(ctx, s, k));
  c.nodes.forEach((n, i) => drawWaterBody(ctx, s, n, i));
  drawWalls(ctx, s);
  drawPennants(ctx, s);
  drawSpill(ctx, s);
  const mark = s.shown?.guide?.mark;
  if (mark && !s.pending) dashedMark(ctx, c.nodes[mark.node], mark.level, s.ticks);
  drawDeck(ctx, s, env);
  drawPipes(ctx, s);
  drawReadouts(ctx, s, env);
  drawHud(ctx, s, env);
  drawBanner(ctx, s, env);
  if (s.phase !== 'playing') drawEnd(ctx, s, env);
}
