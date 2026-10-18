#!/usr/bin/env node
// Compiles a language pack: scripts/i18n/<lang>.json -> public/whitepaper/i18n/<lang>/
// Validates the pack against the English reference (scripts/i18n/en.json) and the
// tokenizer, then writes paper.js + ui.js and regenerates the locales catalog.
//   node scripts/i18n/build-locale.mjs <lang> [moreLangs...]
// Validation failures exit non-zero with a report; nothing is written for a bad pack.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'scripts', 'i18n');
const OUT = path.join(ROOT, 'public', 'whitepaper');

const sb = { window: {} };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(OUT, 'tokens.js'), 'utf8'), sb);
const { build, sig, norm, tokenize } = sb.window.PaperTokens;

const ref = JSON.parse(fs.readFileSync(path.join(SRC, 'en.json'), 'utf8'));
const META = JSON.parse(fs.readFileSync(path.join(SRC, 'meta.json'), 'utf8'));

const errors = [];
const fail = (msg) => errors.push(msg);

function loadPaper(pack) {
  const doc = build(pack.paper);
  return doc;
}

function validate(lang, pack) {
  const paper = pack.paper;
  if (!pack.ui || typeof pack.ui !== 'object') fail('ui object missing');
  const ui = pack.ui || {};
  const secRef = ref.paper, secGot = paper.sections;
  if (secGot.length !== secRef.length) fail(`sections: ${secGot.length} != ${secRef.length}`);
  for (let si = 0; si < Math.min(secRef.length, secGot.length); si++) {
    const R = secRef[si], G = secGot[si];
    const tag = `[${R.id}]`;
    if (G.id !== R.id) fail(`${tag} id ${G.id} != ${R.id}`);
    if (String(G.num || '') !== String(R.num || '')) fail(`${tag} num mismatch`);
    if (!G.label) fail(`${tag} missing label`);
    if ((G.scene || null) !== (R.scene || null)) fail(`${tag} scene mismatch`);
    if ((G.items || []).length !== R.items.length) { fail(`${tag} item count ${G.items.length} != ${R.items.length}`); continue; }
    R.items.forEach((RI, ii) => {
      const GI = G.items[ii];
      const gtag = `${tag}#${ii}(${RI.t})`;
      if (GI.t !== RI.t) fail(`${gtag} type ${GI.t} != ${RI.t}`);
      if (RI.t === 'title') {
        if (!Array.isArray(GI.lines) || GI.lines.length !== RI.lines.length) fail(`${gtag} must have ${RI.lines.length} lines`);
      } else if (RI.t === 'math') {
        if (GI.id !== RI.id) fail(`${gtag} id ${GI.id} != ${RI.id}`);
        if (!GI.say || norm(GI.say) === norm(RI.say)) fail(`${gtag} say: missing or untranslated`);
      } else if (RI.t === 'ztable') {
        if (!GI.rows || GI.rows.length !== RI.rows.length) fail(`${gtag} rows ${GI.rows && GI.rows.length} != ${RI.rows.length}`);
        else GI.rows.forEach((row, ri) => { if (row.length !== 2) fail(`${gtag} row ${ri} must have 2 cells`); });
      } else if (RI.t === 'refs') {
        if (!GI.list || GI.list.length !== RI.list.length) fail(`${gtag} refs list must keep ${RI.list.length} entries`);
      } else if (RI.t === 'code' || RI.t === 'results' || RI.t === 'fig') {
        if (RI.hold && GI.hold !== RI.hold) fail(`${gtag} hold ${GI.hold} != ${RI.hold}`);
        if (RI.h && GI.h !== RI.h) fail(`${gtag} fig height ${GI.h} != ${RI.h}`);
        if (RI.t === 'fig' && GI.scene !== RI.scene) fail(`${gtag} fig scene ${GI.scene} != ${RI.scene}`);
      } else if (GI.text === undefined) {
        fail(`${gtag} missing text`);
      }
    });
  }
  // byline must produce exactly 4 tokens (rendered positionally)
  for (const s of paper.sections) {
    const b = (s.items || []).find((i) => i.t === 'byline');
    if (b && tokenize(b.text).length !== 4) fail(`byline must tokenize to exactly 4 tokens (got ${tokenize(b.text).length})`);
  }
  // ui key coverage
  for (const k of Object.keys(ref.labels)) if (ui.labels && ui.labels[k] === undefined) fail(`labels.${k} missing`);
  if (ui.labels) for (const k of Object.keys(ui.labels)) if (!(k in ref.labels)) fail(`labels.${k} unknown key`);
  for (const k of Object.keys(ref.chrome)) if (ui.chrome && ui.chrome[k] === undefined) fail(`chrome.${k} missing (ok to omit only if identical to English)`);
  if (ui.chrome) for (const k of Object.keys(ui.chrome)) if (!(k in ref.chrome)) fail(`chrome.${k} unknown key`);
  // caps: every step caption must be present
  const caps = ui.caps || {};
  for (const [scene, list] of Object.entries(ref.caps)) {
    const got = caps[scene];
    if (!Array.isArray(got)) { fail(`caps.${scene} missing (array of ${list.length})`); continue; }
    if (list.fig !== undefined && got.fig === undefined) fail(`caps.${scene}.fig missing`);
    if (got.length < list.length) fail(`caps.${scene}: ${got.length} < ${list.length} steps`);
  }
  // cues: every cue must have a translation, occur verbatim in its section, and
  // resolve in order (each at or after the previous cue's match) — scene steps
  // fire in narration order, so an out-of-order cue breaks stepping.
  const cues = ui.cues || {};
  const doc = loadPaper(pack);
  const sceneToSection = new Map();
  paper.sections.forEach((s, si) => { if (s.scene) sceneToSection.set(s.scene, si); });
  for (const [scene, list] of Object.entries(ref.cues)) {
    const si = sceneToSection.get(scene);
    if (si === undefined) { fail(`cues.${scene}: no section with that scene`); continue; }
    const sec = doc.sections[si];
    let buf = '';
    for (let i = sec.start; i < sec.end; i++) buf += norm(doc.tokens[i].d || '');
    let from = 0;
    list.forEach((cue, ci) => {
      if (cue[0] === '#') return; // math ids resolved by item id
      const tr = cues[cue];
      if (tr === undefined) { fail(`cues.${scene}[${ci}] '${cue}' missing translation`); return; }
      const at = buf.indexOf(norm(tr), from);
      if (at < 0) {
        const anywhere = buf.indexOf(norm(tr));
        const why = anywhere < 0 ? (norm(tr) === norm(cue) ? 'untranslated and not found' : 'not found in section') : 'only occurs earlier than the previous cue — pick a phrase from the correct later sentence';
        fail(`cues.${scene}[${ci}] '${cue}' -> "${tr}": ${why} (section ${paper.sections[si].id}, after offset ${from})`);
        return;
      }
      from = at + norm(tr).length;
    });
  }
  return doc;
}

function writeLocale(lang, pack, doc) {
  const dir = path.join(OUT, 'i18n', lang);
  fs.mkdirSync(dir, { recursive: true });
  // flatten caps: { scene: [cap0, cap1, ..., {fig}] } -> { "scene.0": cap0, ..., "scene.fig": fig }
  const capsFlat = {};
  for (const [scene, list] of Object.entries(pack.ui.caps || {})) {
    list.forEach((c, i) => {
      if (c && typeof c === 'object' && c.fig !== undefined) capsFlat[`${scene}.fig`] = c.fig;
      else capsFlat[`${scene}.${i}`] = c;
    });
  }
  const paperJs = `// ${lang} paper — generated by scripts/i18n/build-locale.mjs from scripts/i18n/${lang}.json. Do not edit by hand.\nwindow.WP_PAPERS = window.WP_PAPERS || {};\nwindow.WP_PAPERS[${JSON.stringify(lang)}] = ${JSON.stringify(pack.paper)};\n`;
  const uiJs = `// ${lang} UI — generated by scripts/i18n/build-locale.mjs. Do not edit by hand.\nwindow.WP_UI_LANG = ${JSON.stringify(lang)};\nwindow.WP_UI_CUR = ${JSON.stringify({ labels: pack.ui.labels, chrome: pack.ui.chrome, caps: capsFlat, cues: pack.ui.cues })};\n`;
  fs.writeFileSync(path.join(dir, 'paper.js'), paperJs);
  fs.writeFileSync(path.join(dir, 'ui.js'), uiJs);
  return { dir, count: doc.tokens.length, sig: sig(doc.tokens) };
}

function writeCatalog() {
  const entries = [];
  const langs = ['en', ...Object.keys(META).filter((k) => k !== 'en')];
  for (const id of langs) {
    const m = META[id];
    const has = id === 'en' || (fs.existsSync(path.join(OUT, 'i18n', id, 'paper.js')) && fs.existsSync(path.join(OUT, 'i18n', id, 'narration.js')));
    if (!has) continue;
    entries.push({ id, bcp47: m.bcp47, dir: m.dir, script: m.script, name: m.name, nativeName: m.nativeName });
  }
  fs.writeFileSync(path.join(OUT, 'locales.js'), `// Generated by scripts/i18n/build-locale.mjs — packs present on disk.\nwindow.WP_LOCALES = ${JSON.stringify(entries, null, 2)};\n`);
  return entries.map((e) => e.id);
}

const langs = process.argv.slice(2);
if (!langs.length) { console.error('usage: node scripts/i18n/build-locale.mjs <lang>...'); process.exit(1); }
let ok = true;
for (const lang of langs) {
  const file = path.join(SRC, `${lang}.json`);
  if (!fs.existsSync(file)) { console.error(`${lang}: ${file} not found`); ok = false; continue; }
  errors.length = 0;
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  validate(lang, pack);
  if (errors.length) {
    ok = false;
    console.error(`\n${lang}: ${errors.length} problem(s):`);
    for (const e of errors.slice(0, 40)) console.error('  - ' + e);
    if (errors.length > 40) console.error(`  … and ${errors.length - 40} more`);
    continue;
  }
  const doc = loadPaper(pack);
  const { dir, count, sig: s } = writeLocale(lang, pack, doc);
  console.log(`${lang}: OK — ${count} tokens, sig ${s} -> ${path.relative(ROOT, dir)}`);
}
const cat = writeCatalog();
console.log('catalog:', cat.join(', '));
process.exit(ok ? 0 : 1);
