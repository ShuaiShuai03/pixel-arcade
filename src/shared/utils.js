export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const rectsOverlap = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const randInt = (random, min, max) => Math.floor(random() * (max - min + 1)) + min;
export const choose = (random, items) => items[Math.floor(random() * items.length)];
export function drawPixelText(ctx, text, x, y, color = '#fff', size = 12, align = 'left') {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px ui-monospace, "PingFang SC", "Microsoft YaHei", monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
}
export function pixelSprite(ctx, rows, x, y, scale, palette) {
  rows.forEach((row, ry) =>
    [...row].forEach((c, rx) => {
      if (c !== '.' && palette[c]) {
        ctx.fillStyle = palette[c];
        ctx.fillRect(Math.round(x + rx * scale), Math.round(y + ry * scale), scale, scale);
      }
    }),
  );
}
export function background(ctx, color = '#101b2d') {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 480, 320);
}
