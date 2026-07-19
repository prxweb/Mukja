// Screenshot helper for local QA.
// Usage: node screenshot.mjs [url] [label]
//   With no url, reads .devport (written by serve.mjs) and hits that server.
// Env: VIEW_W, VIEW_H, FR=1, FULLPAGE=0, PRECLICK="sel1,sel2", SCROLLY=px, CLICK=sel
import { createRequire } from 'module';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// If the first arg looks like a URL, use it as the url; otherwise treat it as the
// label and resolve the url from .devport. So `node screenshot.mjs mylabel` works.
function resolveTarget() {
  const a = process.argv[2];
  if (a && /^https?:\/\//i.test(a)) return { url: a, label: process.argv[3] || '' };
  let port = '';
  try { port = fs.readFileSync(path.join(__dirname, '.devport'), 'utf8').trim(); } catch {}
  if (!port) {
    console.error('No url given and no .devport found — start the dev server first: node serve.mjs');
    process.exit(1);
  }
  return { url: `http://localhost:${port}`, label: a || '' };
}
const { url, label } = resolveTarget();

function getChromium() {
  const tries = [];
  try {
    const globalRoot = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const reqMcp = createRequire(path.join(globalRoot, '@playwright', 'mcp', 'package.json'));
    tries.push(() => reqMcp('playwright-core').chromium);
    tries.push(() => reqMcp('playwright').chromium);
    const reqRoot = createRequire(path.join(globalRoot, 'x.js'));
    tries.push(() => reqRoot('playwright-core').chromium);
  } catch {}
  try { const r = createRequire(import.meta.url); tries.push(() => r('playwright-core').chromium); } catch {}
  for (const t of tries) { try { const c = t(); if (c) return c; } catch {} }
  throw new Error('playwright-core not found (install @playwright/mcp globally)');
}

async function launch(chromium) {
  for (const opt of [{}, { channel: 'msedge' }, { channel: 'chrome' }]) {
    try { return await chromium.launch(opt); }
    catch (e) { console.log('launch failed', opt); }
  }
  throw new Error('could not launch a browser');
}

const chromium = getChromium();
const browser = await launch(chromium);

const W = Number(process.env.VIEW_W || 1440);
const H = Number(process.env.VIEW_H || 900);
const fullPage = process.env.FULLPAGE !== '0';

const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await context.newPage();
await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForTimeout(500);
// Disable smooth scrolling so programmatic scrolls land instantly (avoids mid-animation captures)
await page.addStyleTag({ content: 'html{scroll-behavior:auto !important;}' }).catch(() => {});

async function clickSel(sel) {
  try {
    const el = page.locator(sel).first();
    await el.click({ timeout: 1500 });
    await page.waitForTimeout(350);
  } catch (e) { /* best effort */ }
}

if (process.env.PRECLICK) {
  for (const sel of process.env.PRECLICK.split(',').map(s => s.trim()).filter(Boolean)) {
    await clickSel(sel);
  }
}

if (process.env.FR === '1') {
  await clickSel('[data-setlang="fr"], [data-navlang="fr"]');
}

// Auto-scroll through the page to trigger scroll-reveal animations, then reset.
if (process.env.NOAUTOSCROLL !== '1') {
  await page.evaluate(async () => {
    const h = document.body.scrollHeight;
    const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y <= h; y += step) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 90));
    }
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 250));
  });
  // Force any not-yet-revealed elements visible so full-page captures are deterministic
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach(e => e.classList.add('in')));
  await page.waitForTimeout(500);
}

if (process.env.SCROLLY) {
  await page.evaluate(y => window.scrollTo(0, y), Number(process.env.SCROLLY));
  await page.waitForTimeout(400);
}

if (process.env.CLICK) {
  await clickSel(process.env.CLICK);
}

const outDir = path.join(__dirname, 'temporary screenshots');
fs.mkdirSync(outDir, { recursive: true });
let n = 1;
const nums = fs.readdirSync(outDir).map(f => { const m = f.match(/^screenshot-(\d+)/); return m ? Number(m[1]) : 0; });
if (nums.length) n = Math.max(...nums) + 1;
const name = `screenshot-${n}${label ? '-' + label : ''}.png`;
const outPath = path.join(outDir, name);

await page.screenshot({ path: outPath, fullPage });
console.log('saved', path.join('temporary screenshots', name));

await browser.close();
