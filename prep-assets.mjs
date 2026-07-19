// prep-assets.mjs — standing asset pipeline (run `npm install` once for sharp).
// Replaces the one-off scripts previously written per build.
//
// Usage:
//   node prep-assets.mjs photos <srcDir> [outDir=photos] [maxPx=1500] [q=82]
//       Optimize every jpg/png in srcDir for web (fit inside maxPx, EXIF-rotated).
//   node prep-assets.mjs hero <srcFile> [out=photos/hero.jpg] [w=2000] [h=1200]
//       Wide cover-crop for the hero background.
//   node prep-assets.mjs menu <srcDir> [outDir=menu] [inset=4] [q=88]
//       Menu-page screenshots -> menu-1..N.jpg, trimming `inset` px from every
//       edge (kills thin scan/screenshot border lines), sorted naturally.
//   node prep-assets.mjs logo-colors <file> [bgHex]
//       Print background + dominant ink colors (pick brand hexes from these).
//   node prep-assets.mjs logo-duotone <file> <out.png> <frontHex> <offsetHex> [bgHex]
//       Knock out the background (auto-detected from corners, or bgHex), split the
//       ink into its two dominant layers (auto-detected) and recolor them
//       front/offset. Pass the same hex twice for a one-color knockout. Pass bgHex
//       explicitly when an ink layer is close to the background color (e.g. a white
//       drop-shadow on a cream background).
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

let sharp;
try { sharp = createRequire(import.meta.url)('sharp'); }
catch { console.error('sharp not installed — run: npm install'); process.exit(1); }

const [cmd, ...args] = process.argv.slice(2);
const hex = s => { const m = /^#?([0-9a-f]{6})$/i.exec(s || ''); if (!m) throw new Error('bad hex: ' + s); const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const toHex = c => '#' + c.map(x => x.toString(16).padStart(2, '0')).join('');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const naturalSort = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const listImages = dir => fs.readdirSync(dir).filter(f => /\.(jpe?g|png)$/i.test(f)).sort(naturalSort);
const kb = f => (fs.statSync(f).size / 1024).toFixed(0) + 'KB';

if (cmd === 'photos') {
  const [srcDir, outDir = 'photos', maxPx = '1500', q = '82'] = args;
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of listImages(srcDir)) {
    const slug = path.parse(f).name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const out = path.join(outDir, slug + '.jpg');
    await sharp(path.join(srcDir, f)).rotate()
      .resize({ width: +maxPx, height: +maxPx, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: +q, mozjpeg: true }).toFile(out);
    console.log(out, kb(out));
  }
} else if (cmd === 'hero') {
  const [srcFile, out = 'photos/hero.jpg', w = '2000', h = '1200'] = args;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp(srcFile).rotate().resize({ width: +w, height: +h, fit: 'cover', position: 'centre' })
    .jpeg({ quality: 80, mozjpeg: true }).toFile(out);
  console.log(out, kb(out));
} else if (cmd === 'menu') {
  const [srcDir, outDir = 'menu', inset = '4', q = '88'] = args;
  fs.mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const f of listImages(srcDir)) {
    n++;
    const src = path.join(srcDir, f);
    const meta = await sharp(src).metadata();
    const out = path.join(outDir, `menu-${n}.jpg`);
    await sharp(src)
      .extract({ left: +inset, top: +inset, width: meta.width - inset * 2, height: meta.height - inset * 2 })
      .flatten({ background: '#e8e0d8' })
      .jpeg({ quality: +q, mozjpeg: true }).toFile(out);
    console.log(out, `${meta.width - inset * 2}x${meta.height - inset * 2}`, kb(out));
  }
} else if (cmd === 'logo-colors' || cmd === 'logo-duotone') {
  const srcFile = args[0];
  const { data, info } = await sharp(srcFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  // background = explicit bgHex arg if given, else average of the four corners
  const bgArg = cmd === 'logo-colors' ? args[1] : args[4];
  const corners = [px(0, 0), px(W - 1, 0), px(0, H - 1), px(W - 1, H - 1)];
  const bg = bgArg ? hex(bgArg) : [0, 1, 2].map(c => Math.round(corners.reduce((s, p) => s + p[c], 0) / 4));
  // frequency of quantized non-background colors (tighter radius when bg is explicit)
  const bgRadius = bgArg ? 42 : 60;
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const p = [data[i], data[i + 1], data[i + 2]];
    if (dist(p, bg) < bgRadius) continue;
    const key = p.map(v => v >> 4 << 4).join(',');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const inks = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ color: k.split(',').map(Number), count: c }));

  if (cmd === 'logo-colors') {
    console.log('background:', toHex(bg));
    // merge quantization neighbours into distinct inks
    const distinct = [];
    for (const { color, count } of inks) {
      const hit = distinct.find(d => dist(d.color, color) < 48);
      if (hit) hit.count += count; else distinct.push({ color, count });
      if (distinct.length >= 8) break;
    }
    for (const d of distinct.slice(0, 6)) console.log('ink:', toHex(d.color), 'weight', d.count);
  } else {
    const [, out, frontHexArg, offsetHexArg] = args;
    if (!out || !frontHexArg || !offsetHexArg) { console.error('usage: logo-duotone <file> <out.png> <frontHex> <offsetHex>'); process.exit(1); }
    const front = hex(frontHexArg), offset = hex(offsetHexArg);
    // two dominant distinct inks in the source
    const distinct = [];
    for (const { color, count } of inks) {
      const hit = distinct.find(d => dist(d.color, color) < 48);
      if (hit) hit.count += count; else distinct.push({ color, count });
    }
    distinct.sort((a, b) => b.count - a.count);
    const inkA = distinct[0]?.color, inkB = distinct[1]?.color || distinct[0]?.color;
    const T = 22, RAMP = 20;
    const outBuf = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i += 4) {
      const p = [data[i], data[i + 1], data[i + 2]];
      const dbg = dist(p, bg);
      let a; if (dbg <= T) a = 0; else if (dbg >= T + RAMP) a = 255; else a = Math.round(((dbg - T) / RAMP) * 255);
      const col = dist(p, inkA) <= dist(p, inkB) ? front : offset;
      outBuf[i] = col[0]; outBuf[i + 1] = col[1]; outBuf[i + 2] = col[2]; outBuf[i + 3] = a;
    }
    const png = await sharp(outBuf, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    await sharp(png).trim({ threshold: 6 }).png().toFile(out);
    const m = await sharp(out).metadata();
    console.log(out, `${m.width}x${m.height}`, `(bg ${toHex(bg)}, inks ${toHex(inkA)} -> ${toHex(front)}, ${toHex(inkB)} -> ${toHex(offset)})`);
  }
} else {
  console.error('unknown command — see header comment for usage');
  process.exit(1);
}
