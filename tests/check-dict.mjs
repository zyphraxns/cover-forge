/* 临时：检查 i18n 的 zh 字典是否与 index.html 内联原文一致（跑完即删） */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = 'file://' + path.resolve(here, '..', 'index.html');

// 从 i18n.js 里抽出 DOM 映射表（sel / key / attr / html）
const i18n = fs.readFileSync(path.resolve(here, '..', 'i18n.js'), 'utf8');
const domBlock = i18n.slice(i18n.indexOf('var DOM = ['), i18n.indexOf('];', i18n.indexOf('var DOM = [')));
const entries = [...domBlock.matchAll(/\{ sel: '([^']+)', key: '([^']+)'(?:, attr: '([^']+)')?(?:, html: (\w+))? \}/g)]
  .map((m) => ({ sel: m[1], key: m[2], attr: m[3] || null, html: m[4] === 'true' }));

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function readDOM(block) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  if (block) await page.route('**/i18n.js', (r) => r.abort());
  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const out = await page.evaluate((list) => list.map((m) => {
    let node = null;
    try { node = document.querySelector(m.sel); } catch (e) { return { sel: m.sel, val: null }; }
    if (!node) return { sel: m.sel, val: null };
    if (m.attr) return { sel: m.sel, val: node.getAttribute(m.attr) };
    return { sel: m.sel, val: m.html ? node.innerHTML.trim() : node.textContent.trim() };
  }), entries);
  await ctx.close();
  return out;
}

const original = await readDOM(true);   // 屏蔽 i18n.js → 读到 index.html 内联原文
const translated = await readDOM(false); // 正常 → 读到 zh 字典文案

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const diffs = [];
const notApplicable = [];
for (let i = 0; i < entries.length; i++) {
  const a = norm(original[i].val), b = norm(translated[i].val);
  if (a === b) continue;
  // 屏蔽 i18n.js 后，由 app.js 在运行时写入的节点会拿到 app.js 的兜底返回值
  // （即键名本身）。这类节点比较不了，跳过而不是误报 ——
  // 它们的文案由 app.js 的 tr() 负责，不属于「HTML 内联原文」。
  if (a === entries[i].key) { notApplicable.push(entries[i].sel); continue; }
  diffs.push({ sel: entries[i].sel, key: entries[i].key, html: a || '(空)', dict: b || '(空)' });
}

console.log('比对条目: ' + entries.length);
console.log('在 index.html 中未找到的条目: ' + original.filter((o) => o.val === null).map((o) => o.sel).join(', ') || '(无)');
console.log('不适用（由 app.js 运行时写入，非 HTML 内联原文）: '
  + (notApplicable.length ? notApplicable.join(', ') : '0 个'));
console.log('\nzh 字典与 HTML 内联原文不一致的条目: ' + diffs.length);
diffs.forEach((d) => {
  console.log('\n  ✗ ' + d.sel + '  [' + d.key + ']');
  console.log('     HTML 原文: ' + d.html.slice(0, 110));
  console.log('     字典 zh  : ' + d.dict.slice(0, 110));
});

await browser.close();
process.exit(diffs.length ? 1 : 0);
