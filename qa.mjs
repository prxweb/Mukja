// qa.mjs — assertion-first QA harness. Text PASS/FAIL output, no screenshots.
// Usage: node qa.mjs [url]        (default http://localhost:3009)
//
// Covers the mechanical parts of the CLAUDE.md mobile checklist so screenshots
// are only needed for aesthetic judgment:
//   - JS/console errors on load          - broken images
//   - horizontal overflow (6 viewports)  - disclaimer modal fits (portrait + short landscape)
//   - FR toggle translates every [data-fr] element
//   - hamburger opens after scrolling; every item visible
//   - menu lightbox opens with a loaded page; arrows don't move on hover
// Selectors match this template's structure (#modalDismiss, #burger, #menuCover, ...).
import { createRequire } from 'module';
import { execSync } from 'child_process';
import path from 'path';

const url = process.argv[2] || 'http://localhost:3009';

function getChromium() {
  const tries = [];
  try {
    const globalRoot = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const reqMcp = createRequire(path.join(globalRoot, '@playwright', 'mcp', 'package.json'));
    tries.push(() => reqMcp('playwright-core').chromium);
    tries.push(() => reqMcp('playwright').chromium);
  } catch {}
  try { const r = createRequire(import.meta.url); tries.push(() => r('playwright-core').chromium); } catch {}
  for (const t of tries) { try { const c = t(); if (c) return c; } catch {} }
  throw new Error('playwright-core not found (install @playwright/mcp globally)');
}
async function launch(chromium) {
  for (const opt of [{}, { channel: 'msedge' }, { channel: 'chrome' }]) {
    try { return await chromium.launch(opt); } catch {}
  }
  throw new Error('could not launch a browser');
}

const browser = await launch(getChromium());
let pass = 0, fail = 0;
function report(ok, name, detail) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${!ok && detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
}
async function newPage(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  p._errors = [];
  p.on('pageerror', e => p._errors.push('pageerror: ' + e.message));
  p.on('console', m => {
    if (m.type() !== 'error') return;
    const loc = (m.location() && m.location().url) || '';
    if (loc.includes('favicon') || m.text().includes('favicon')) return;
    p._errors.push('console: ' + m.text() + (loc ? ` (${loc})` : ''));
  });
  await p.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
  await p.waitForTimeout(300);
  return p;
}
const dismissModal = async p => { await p.locator('#modalDismiss').click({ timeout: 1500 }).catch(() => {}); await p.waitForTimeout(150); };

/* 1) Errors, broken images, lightbox behaviour (desktop) */
{
  const p = await newPage(1440, 900);
  await dismissModal(p);
  report(p._errors.length === 0, 'no JS/console errors on load', p._errors.join(' | '));
  const broken = await p.evaluate(() =>
    [...document.images].filter(i => i.getAttribute('src') && i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src')));
  report(broken.length === 0, 'no broken images', broken.join(', '));

  await p.locator('#menuCover').click({ timeout: 2000 }).catch(() => {});
  await p.waitForTimeout(400);
  const lb = await p.evaluate(() => ({
    open: document.getElementById('lightbox').classList.contains('open'),
    img: document.getElementById('lbImg').naturalWidth > 0,
  }));
  report(lb.open && lb.img, 'menu lightbox opens with a loaded page', JSON.stringify(lb));

  const before = await p.locator('#lbNext').boundingBox();
  await p.locator('#lbNext').hover();
  await p.waitForTimeout(300);
  const after = await p.locator('#lbNext').boundingBox();
  const moved = !before || !after || Math.abs(before.y - after.y) > 0.5 || Math.abs(before.x - after.x) > 0.5;
  report(!moved, 'lightbox arrows do not move on hover', before && after ? `moved ${(after.y - before.y).toFixed(1)}px` : 'no box');
  await p.context().close();
}

/* 2) Horizontal overflow across viewports */
for (const [w, h] of [[360, 780], [390, 844], [414, 896], [844, 390], [768, 1024], [1440, 900]]) {
  const p = await newPage(w, h);
  await dismissModal(p);
  const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  report(o <= 0, `no horizontal overflow @ ${w}x${h}`, `${o}px overflow`);
  await p.context().close();
}

/* 3) Disclaimer modal fits (checked before dismissing) */
for (const [w, h] of [[390, 844], [844, 390]]) {
  const p = await newPage(w, h);
  const m = await p.evaluate(() => {
    const box = document.querySelector('.modal__box');
    const btn = document.getElementById('modalDismiss');
    if (!box || !btn) return null;
    const r = box.getBoundingClientRect(), d = btn.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, dismissBottom: d.bottom, ih: innerHeight };
  });
  const ok = !!m && m.top >= -1 && m.bottom <= m.ih + 1 && m.dismissBottom <= m.ih + 1;
  report(ok, `disclaimer modal fits viewport @ ${w}x${h}`, m ? `box ${Math.round(m.top)}..${Math.round(m.bottom)} of ${m.ih}` : 'modal missing');
  await p.context().close();
}

/* 4) FR toggle translates everything */
{
  const p = await newPage(390, 844);
  await p.locator('[data-setlang=fr]').first().click({ timeout: 2000 }).catch(() => {});
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const bad = [];
    document.querySelectorAll('[data-fr]').forEach(el => {
      if (el.textContent.trim() !== el.getAttribute('data-fr').trim()) bad.push(el.getAttribute('data-fr').slice(0, 30));
    });
    return { lang: document.documentElement.lang, bad };
  });
  report(r.lang === 'fr' && r.bad.length === 0, 'FR toggle translates every [data-fr] element',
    r.lang !== 'fr' ? 'lang != fr' : `${r.bad.length} untranslated: ${r.bad.slice(0, 3).join('; ')}`);
  await p.context().close();
}

/* 5) Hamburger opens after scrolling; all items visible */
{
  const p = await newPage(390, 844);
  await dismissModal(p);
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await p.waitForTimeout(200);
  await p.locator('#burger').click({ timeout: 2000 }).catch(() => {});
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => {
    const mm = document.getElementById('mobilemenu');
    const links = [...mm.querySelectorAll('a.m-link')];
    return {
      open: mm.classList.contains('open'),
      count: links.length,
      allVisible: links.every(a => { const b = a.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight && b.width > 0; }),
    };
  });
  report(r.open && r.count > 0 && r.allVisible, 'hamburger opens after scroll; every item visible', JSON.stringify(r));
  await p.context().close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
