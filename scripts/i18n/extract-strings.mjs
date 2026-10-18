#!/usr/bin/env node
// Extracts every translatable UI string from whitepaper.html into
// scripts/i18n/en.json — the reference file that language packs translate.
//   node scripts/i18n/extract-strings.mjs
// Outputs: chrome (HUD/chrome), labels (diagram/scene), caps {scene: [captions]},
// cues {scene: [cue keys]}, paper (structure reference with per-section text).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'scripts', 'i18n', 'en.json');
const html = fs.readFileSync(path.join(ROOT, 'whitepaper.html'), 'utf8');

// --- EN table (chrome + labels) --------------------------------------------
const start = html.indexOf('const EN = {');
const end = html.indexOf('\n};', start);
if (start < 0 || end < 0) throw new Error('EN table not found');
// evaluate the object literal directly
const EN2 = vm.runInNewContext(`(${html.slice(start + 'const EN ='.length, end + 2)})`, {});

// --- scene blocks ------------------------------------------------------------
function sceneBlocks(src) {
  const blocks = {};
  const re = /SCENES\.(\w+) = \{/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1, i = re.lastIndex;
    while (depth > 0 && i < src.length) { const c = src[i]; if (c === '{') depth++; else if (c === '}') depth--; i++; }
    blocks[m[1]] = src.slice(re.lastIndex, i - 1);
  }
  return blocks;
}
const unesc = (s) => s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
const blocks = sceneBlocks(html);
const caps = {}, cues = {};
const strVals = (body, key) => {
  const out = [];
  for (const m of body.matchAll(new RegExp(`\\\\b${key}: '(?:[^'\\\\]|\\\\.)*'`, 'g'))) out.push({ v: unesc(m[0].slice(key.length + 3, -1)) });
  for (const m of body.matchAll(new RegExp(`\\\\b${key}: "(?:[^"\\\\]|\\\\.)*"`, 'g'))) out.push({ v: unesc(m[0].slice(key.length + 3, -1)) });
  return out;
};
for (const [id, body] of Object.entries(blocks)) {
  const c = [], q = [];
  // extract cap:/cue: in document order, single or double quoted
  const found = [];
  for (const m of body.matchAll(/\b(cap|cue): ('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g)) {
    const raw = m[2].slice(1, -1);
    found.push({ key: m[1], at: m.index, v: unesc(raw) });
  }
  for (const f of found) (f.key === 'cap' ? c : q).push(f.v);
  const fm = body.match(/figCap: '((?:[^'\\]|\\.)*)'/);
  caps[id] = c; if (fm) caps[id].fig = unesc(fm[1]);
  cues[id] = q;
}

// --- paper structure reference -----------------------------------------------
const sb = { window: {} };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'whitepaper', 'paper.js'), 'utf8'), sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'whitepaper', 'tokens.js'), 'utf8'), sb);
const paper = sb.window.PAPER;
const { build } = sb.window.PaperTokens;
const doc = build(paper);

const out = {
  _note: 'Reference for language packs. chrome/labels/caps/cues: translate every value; keep keys. caps[scene][i] is the caption of step i; cues[scene] are the English cue phrases (map each to a phrase that occurs verbatim in the translated section). paper: structure each locale paper.js must mirror (ids, types, counts).',
  chrome: EN2.chrome,
  labels: EN2.labels,
  caps,
  cues,
  paper: paper.sections.map((s, si) => ({
    id: s.id, num: s.num, scene: s.scene,
    items: doc.items.filter((it) => it.sec === si).map((it) => ({ t: it.t, text: it.src.text, lines: it.src.lines, id: it.src.id, say: it.src.say, head: it.src.head, rows: it.src.rows, hold: it.src.hold, h: it.src.h, list: it.src.list, scene: it.src.scene })),
  })),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
const ncaps = Object.entries(caps).map(([k, v]) => `${k}:${v.length}`).join(' ');
console.log(`en.json written: ${Object.keys(EN2.chrome).length} chrome, ${Object.keys(EN2.labels).length} labels, caps [${ncaps}]`);
