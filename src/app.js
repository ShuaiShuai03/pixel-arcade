import { catalog, loadGame } from './catalog.js';
import { copy } from './i18n.js';
import {
  readPreferences,
  savePreferences,
  recordResult,
  filterGames,
  normalizeHash,
  createTranslator,
  formatControlKeys,
} from './shared/platform.js';
import { InputState } from './shared/input.js';
import { ArcadeAudio } from './shared/audio.js';
import { drawWorld } from './world.js';

const $ = (id) => document.getElementById(id);
let storage;
try {
  storage = window.localStorage;
} catch {
  /* The arcade also works without storage. */
}
let preferences = readPreferences(storage),
  filter = 'all',
  current = null,
  routeVersion = 0,
  mode = 1,
  phase = 'home',
  lastFrame = 0,
  lastHud = '',
  toastTimer;
const text = (key) => copy[key]?.[preferences.lang === 'zh' ? 1 : 0] || key;
const localized = (value) => (typeof value === 'object' ? value[preferences.lang] : value);
const audio = new ArcadeAudio(preferences.sound),
  input = new InputState(),
  modules = new Map(),
  canvas = $('game-canvas'),
  ctx = canvas.getContext('2d');
const persist = () => savePreferences(storage, preferences);
const make = (tag, className, content) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (content !== undefined) e.textContent = content;
  return e;
};
function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => ($('toast').hidden = true), 4000);
}
function setPhase(next) {
  phase = next;
  canvas.dataset.phase = next;
  $('pause-button').disabled = !['playing', 'paused'].includes(next);
  $('pause-button').textContent = text(next === 'paused' ? 'resume' : 'pause');
}
function updateLanguage() {
  document.documentElement.lang = preferences.lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((e) => {
    e.innerHTML = text(e.dataset.i18n);
  });
  document.querySelectorAll('[data-filter]').forEach((e) => {
    e.textContent = text(e.dataset.filter);
  });
  $('sound-toggle').textContent = text(preferences.sound ? 'soundOn' : 'soundOff');
  $('sound-toggle').setAttribute('aria-pressed', String(preferences.sound));
  $('language-toggle').textContent = preferences.lang === 'en' ? '中文' : 'EN';
  $('language-toggle').setAttribute(
    'aria-label',
    preferences.lang === 'en' ? 'Switch to Chinese' : '切换为英文',
  );
  $('game-search').placeholder = text('search');
  $('game-search').setAttribute('aria-label', text('search'));
  $('fullscreen-button').setAttribute('aria-label', text('fullscreen'));
  $('parkour-link').href = `./public/parkour/index.html?lang=${preferences.lang}`;
  document.querySelector('.skip-link').textContent =
    preferences.lang === 'zh' ? '跳转至游戏' : 'Skip to games';
  document
    .querySelector('.site-header nav')
    .setAttribute('aria-label', preferences.lang === 'zh' ? '主导航' : 'Main');
  document
    .querySelector('.filters')
    .setAttribute('aria-label', preferences.lang === 'zh' ? '游戏分类' : 'Game categories');
  document
    .querySelector('.machine')
    .setAttribute('aria-label', preferences.lang === 'zh' ? '游戏' : 'Game');
  $('touch-controls').setAttribute(
    'aria-label',
    preferences.lang === 'zh' ? '触屏控制' : 'Touch controls',
  );
  const sign = document.querySelector('.world-sign');
  sign.textContent = preferences.lang === 'zh' ? '开玩' : 'PLAY';
  sign.setAttribute('aria-label', preferences.lang === 'zh' ? '进入游戏大厅' : 'Enter the arcade');
  $('world').setAttribute(
    'aria-label',
    preferences.lang === 'zh'
      ? '像素岛屿上的街机厅、森林、山脉和港口'
      : 'A pixel-art island with an arcade, forest, mountain and harbor',
  );
  $('game-canvas').setAttribute(
    'aria-label',
    preferences.lang === 'en' ? 'Game screen' : '游戏画面',
  );
  document.querySelectorAll('[data-mode]').forEach((e) => {
    e.textContent = text(e.dataset.mode === '1' ? 'onePlayer' : 'twoPlayer');
  });
  renderShelf();
  if (current) {
    current.env.lang = preferences.lang;
    renderDetails();
    showOverlay();
    updateHUD();
    drawGame();
  }
}
function renderShelf() {
  const list = filterGames(catalog, $('game-search').value, filter),
    grid = $('game-grid');
  grid.replaceChildren();
  $('game-count').textContent =
    preferences.lang === 'zh' ? `${list.length} 个游戏` : `${list.length} games`;
  $('no-results').hidden = list.length > 0;
  for (const game of list) {
    const link = make('a', 'game-card');
    link.href = `#play/${game.id}`;
    link.dataset.game = game.id;
    link.setAttribute(
      'aria-label',
      `${preferences.lang === 'zh' ? '开始' : 'Play'} ${localized(game.name)}`,
    );
    const picture = make('div', 'card-picture'),
      preview = make('canvas');
    preview.width = 480;
    preview.height = 320;
    preview.setAttribute('role', 'img');
    preview.setAttribute('aria-label', `${localized(game.name)} — ${text('preview')}`);
    picture.append(preview);
    const play = make('span', 'card-play');
    play.setAttribute('aria-hidden', 'true');
    play.append(make('span', null, '▶'));
    picture.append(play);
    const heading = make('div', 'card-meta');
    heading.append(make('h3', null, localized(game.name)), make('span', 'card-arrow', '↗'));
    const bottom = make('div', 'card-bottom');
    bottom.append(
      make('span', null, text(game.genre)),
      make(
        'span',
        null,
        game.players.includes('2')
          ? preferences.lang === 'zh'
            ? '1–2 人'
            : '1–2 players'
          : preferences.lang === 'zh'
            ? '单人'
            : '1 player',
      ),
    );
    if (preferences.scores[game.id])
      bottom.append(
        make('span', 'card-best', `${text('bestLabel')} ${preferences.scores[game.id]}`),
      );
    link.append(picture, heading, bottom);
    grid.append(link);
    const context = preview.getContext('2d');
    context.imageSmoothingEnabled = false;
    const module = modules.get(game.id);
    if (module) {
      try {
        module
          .createGame({
            width: 480,
            height: 320,
            lang: preferences.lang,
            mode: 1,
            random: seeded(37),
            t: (en, zh) => (preferences.lang === 'zh' ? zh : en),
            sound: () => {},
            end: () => {},
          })
          .draw(context);
      } catch (error) {
        console.error(`Preview failed: ${game.id}`, error);
      }
    } else {
      context.fillStyle = game.color;
      context.fillRect(0, 0, 480, 320);
      context.fillStyle = '#142b2b';
      context.font = 'bold 30px monospace';
      context.textAlign = 'center';
      context.fillText(localized(game.name), 240, 165);
    }
  }
}
function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function rememberProgress() {
  if (!current) return;
  const score = current.game.getState().score;
  preferences = recordResult(preferences, current.meta.id, score);
  persist();
}
function renderDetails() {
  const meta = current.meta;
  $('play-title').textContent = localized(meta.name);
  document.title = `${localized(meta.name)} — Pixel Arcade`;
  $('play-category').textContent = text(meta.genre);
  $('game-description').textContent = localized(meta.description);
  $('key-guide').replaceChildren();
  for (const key of meta.keys) {
    const row = make('div');
    row.append(make('span', null, localized(key.label)), make('kbd', null, formatKeys(key.keys)));
    $('key-guide').append(row);
  }
  if (meta.players.includes('2')) {
    const note = make('div');
    note.append(
      make(
        'span',
        null,
        preferences.lang === 'zh' ? '双人模式需要共用键盘。' : 'Two players share one keyboard.',
      ),
    );
    $('key-guide').append(note);
  }
  $('touch-controls').replaceChildren();
  $('touch-controls').hidden = current.env.mode === 2 || !meta.touchControls?.length;
  for (const control of meta.touchControls || []) {
    const button = make('button', null, localized(control.label));
    button.type = 'button';
    button.dataset.code = control.code;
    button.setAttribute('aria-label', localized(control.label));
    button.addEventListener('pointerdown', (event) => {
      if (phase !== 'playing') return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      input.down(control.code, `touch-${event.pointerId}`);
      canvas.focus({ preventScroll: true });
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
      button.addEventListener(type, (event) => input.up(`touch-${event.pointerId}`));
    $('touch-controls').append(button);
  }
  $('best-value').textContent = preferences.scores[meta.id] || 0;
}
function formatKeys(keys) {
  return formatControlKeys(keys, preferences.lang);
}
function showOverlay() {
  const overlay = $('game-overlay');
  overlay.hidden = phase === 'playing';
  if (!current) return;
  $('mode-picker').hidden = phase !== 'ready' || !current.meta.players.includes('2');
  $('start-button').hidden = false;
  if (phase === 'ready') {
    $('overlay-eyebrow').textContent = text('ready');
    $('overlay-title').textContent = localized(current.meta.name);
    $('overlay-message').textContent = text('noAccount');
    $('start-button').textContent = text('start');
  } else if (phase === 'paused') {
    $('overlay-eyebrow').textContent = 'PIXEL ARCADE';
    $('overlay-title').textContent = text('paused');
    $('overlay-message').textContent = text('pauseMessage');
    $('start-button').textContent = text('resume');
  } else if (phase === 'won' || phase === 'lost') {
    $('overlay-eyebrow').textContent = `${text('score')} ${current.result.score}`;
    $('overlay-title').textContent = text(phase === 'won' ? 'complete' : 'over');
    $('overlay-message').textContent = localized(current.result.message);
    $('start-button').textContent = text('again');
  } else if (phase === 'error') {
    $('overlay-eyebrow').textContent = 'PIXEL ARCADE';
    $('overlay-title').textContent = text('over');
    $('overlay-message').textContent = text('runError');
    $('start-button').textContent = text('again');
  }
  $('pause-button').textContent = text(phase === 'paused' ? 'resume' : 'pause');
}
function newInstance(module) {
  const translator = createTranslator(() => preferences.lang);
  const env = {
    width: 480,
    height: 320,
    lang: preferences.lang,
    mode,
    random: Math.random,
    t: translator.t,
    sound: (name) => audio.play(name),
    end: (result) => endRun({ ...result, message: translator.capture(result.message) }),
  };
  return { module, meta: module.meta, env, game: module.createGame(env), result: null };
}
async function route() {
  const version = ++routeVersion,
    id = normalizeHash(location.hash, catalog);
  input.clear();
  if (current) rememberProgress();
  if (!id) {
    current = null;
    setPhase('home');
    $('play-view').hidden = true;
    $('home-view').hidden = false;
    document.body.classList.remove('playing');
    document.title = 'Pixel Arcade — A little world of games';
    renderShelf();
    requestAnimationFrame(() => {
      const anchor =
        location.hash === '#games' ? 'games' : location.hash === '#about' ? 'about' : 'home';
      $(anchor).scrollIntoView({ behavior: 'instant' });
    });
    return;
  }
  setPhase('loading');
  current = null;
  mode = 1;
  document
    .querySelectorAll('[data-mode]')
    .forEach((e) => e.setAttribute('aria-pressed', String(e.dataset.mode === '1')));
  $('play-view').hidden = false;
  $('home-view').hidden = true;
  document.body.classList.add('playing');
  window.scrollTo({ top: 0, behavior: 'instant' });
  $('game-overlay').hidden = false;
  $('overlay-title').textContent = text('loading');
  $('overlay-message').textContent = '';
  $('overlay-eyebrow').textContent = 'PIXEL ARCADE';
  $('start-button').hidden = true;
  $('mode-picker').hidden = true;
  $('score-value').textContent = '0';
  try {
    const module = modules.get(id) || (await loadGame(id));
    if (version !== routeVersion) return;
    modules.set(id, module);
    current = newInstance(module);
    setPhase('ready');
    renderDetails();
    showOverlay();
    drawGame();
    updateHUD();
    $('start-button').focus({ preventScroll: true });
  } catch (error) {
    console.error('Game load failed', error);
    if (version !== routeVersion) return;
    setPhase('error');
    $('overlay-title').textContent = text('loadError');
    $('start-button').hidden = true;
  }
}
function startRun() {
  if (!current) return;
  audio.unlock();
  if (phase !== 'paused') {
    current = newInstance(current.module);
    preferences = recordResult(preferences, current.meta.id, 0);
    persist();
  }
  input.clear();
  lastFrame = performance.now();
  lastHud = '';
  setPhase('playing');
  $('touch-controls').hidden = current.env.mode === 2 || !current.meta.touchControls?.length;
  showOverlay();
  canvas.focus({ preventScroll: true });
}
function endRun(result) {
  if (!current || phase !== 'playing') return;
  current.result = {
    ...result,
    score: Number.isFinite(result.score) ? Math.max(0, Math.floor(result.score)) : 0,
  };
  setPhase(result.won ? 'won' : 'lost');
  input.clear();
  preferences = recordResult(preferences, current.meta.id, current.result.score);
  persist();
  audio.play(result.won ? 'win' : 'lose');
  showOverlay();
  updateHUD();
  $('start-button').focus({ preventScroll: true });
}
function pause() {
  if (phase === 'playing') {
    input.clear();
    setPhase('paused');
    showOverlay();
    updateHUD();
    $('start-button').focus({ preventScroll: true });
  } else if (phase === 'paused') startRun();
}
function restartRun() {
  if (current) {
    rememberProgress();
    setPhase('ready');
    startRun();
  }
}
function drawGame() {
  if (!current) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 480, 320);
  try {
    current.game.draw(ctx);
  } finally {
    ctx.restore();
  }
}
function updateHUD() {
  if (!current) return;
  const state = current.game.getState(),
    score = Math.max(0, Math.floor(state.score || 0));
  $('score-value').textContent = score;
  $('best-value').textContent = Math.max(preferences.scores[current.meta.id] || 0, score);
  const status =
    phase === 'playing'
      ? localized(state.status) || text(current.meta.genre)
      : phase === 'ready'
        ? text('ready')
        : phase === 'paused'
          ? text('paused')
          : text(phase === 'won' ? 'complete' : 'over');
  if (lastHud !== status) {
    $('game-status').textContent = status;
    lastHud = status;
  }
}
function frame(now) {
  const dt = Math.min((now - lastFrame) / 1000, 1 / 30);
  lastFrame = now;
  if (current && phase === 'playing') {
    try {
      current.game.update(dt, input);
      drawGame();
      updateHUD();
    } catch (error) {
      console.error('Game runtime failed', current.meta.id, error);
      setPhase('error');
      showOverlay();
    }
    input.flush();
  }
  requestAnimationFrame(frame);
}
function keydown(event) {
  if (!current || $('play-view').hidden || event.ctrlKey || event.metaKey || event.altKey) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
  if (event.code === 'Escape' || event.code === 'KeyP') {
    event.preventDefault();
    if (!event.repeat) pause();
    return;
  }
  if (event.code === 'KeyR') {
    event.preventDefault();
    if (!event.repeat && phase !== 'ready') restartRun();
    return;
  }
  if (phase !== 'playing') return;
  if (['BUTTON', 'A'].includes(event.target.tagName) && ['Enter', 'Space'].includes(event.code))
    return;
  if (event.code === 'Tab') return;
  event.preventDefault();
  input.down(event.code);
}
window.addEventListener('keydown', keydown);
window.addEventListener('keyup', (event) => input.up(event.code));
window.addEventListener('blur', () => {
  input.clear();
  if (phase === 'playing') pause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && phase === 'playing') pause();
});
function pointerPosition(event) {
  const r = canvas.getBoundingClientRect();
  input.pointer.x = ((event.clientX - r.left) * 480) / r.width;
  input.pointer.y = ((event.clientY - r.top) * 320) / r.height;
}
canvas.addEventListener('pointerdown', (event) => {
  if (phase !== 'playing') return;
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  canvas.focus({ preventScroll: true });
  pointerPosition(event);
  input.pointer.down = true;
  input.pointer.clicked = true;
});
canvas.addEventListener('pointermove', pointerPosition);
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
  canvas.addEventListener(type, () => {
    input.pointer.down = false;
  });
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
$('start-button').addEventListener('click', startRun);
$('pause-button').addEventListener('click', pause);
$('restart-button').addEventListener('click', restartRun);
$('language-toggle').addEventListener('click', () => {
  preferences.lang = preferences.lang === 'en' ? 'zh' : 'en';
  persist();
  updateLanguage();
});
$('sound-toggle').addEventListener('click', () => {
  preferences.sound = !preferences.sound;
  audio.setEnabled(preferences.sound);
  persist();
  $('sound-toggle').textContent = text(preferences.sound ? 'soundOn' : 'soundOff');
  $('sound-toggle').setAttribute('aria-pressed', String(preferences.sound));
  audio.play('coin');
});
for (const button of document.querySelectorAll('[data-mode]'))
  button.addEventListener('click', () => {
    mode = Number(button.dataset.mode);
    document
      .querySelectorAll('[data-mode]')
      .forEach((e) => e.setAttribute('aria-pressed', String(Number(e.dataset.mode) === mode)));
  });
for (const button of document.querySelectorAll('[data-filter]'))
  button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document
      .querySelectorAll('[data-filter]')
      .forEach((e) => e.setAttribute('aria-pressed', String(e === button)));
    renderShelf();
  });
$('game-search').addEventListener('input', renderShelf);
function randomGame() {
  const choices = catalog.filter((g) => g.id !== current?.meta.id);
  location.hash = `play/${choices[Math.floor(Math.random() * choices.length)].id}`;
}
$('random-game').addEventListener('click', randomGame);
$('next-random').addEventListener('click', randomGame);
$('fullscreen-button').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.querySelector('.machine').requestFullscreen)
      await document.querySelector('.machine').requestFullscreen();
    else toast(text('fullscreenError'));
  } catch {
    toast(text('fullscreenError'));
  }
});
window.addEventListener('hashchange', route);
drawWorld($('world'));
updateLanguage();
void route();
requestAnimationFrame(frame);
Promise.allSettled(
  catalog.map(async (game) => {
    const module = await loadGame(game.id);
    modules.set(game.id, module);
    game.name = module.meta.name;
    game.players = module.meta.players;
  }),
).then(() => renderShelf());
