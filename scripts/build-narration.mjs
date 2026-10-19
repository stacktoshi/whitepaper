#!/usr/bin/env node
// Generates whitepaper narration audio + narration metadata (per-word timestamps).
//   node scripts/build-narration.mjs [Voice]              (English; default Rupert)
//   node scripts/build-narration.mjs --lang es            (language pack, default voice)
//   node scripts/build-narration.mjs --lang es --voice Ignacio
// Voices: Inworld TTS-2. Word timings come from Inworld's WORD timestamp
// alignment, then mapped onto the paper's own tokens. The cache key includes the
// full TTS config (voice + language), so re-voicing or re-langing re-fetches.
// Output:
//   en      -> public/whitepaper/narration*.mp3 + narration*.js (legacy names)
//   <lang>  -> public/whitepaper/i18n/<lang>/narration.mp3 + narration.js
//              (narration.js = window.NARRATION_PACK = [{ id, name, nar }])
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RATE = 24000;
const LEAD_IN = 0.35;
const GAP = { title: 0.5, byline: 1.1, abs1: 0.55, abs2: 0.9, h: 0.3, p: 0.55, li: 0.25, def: 0.25, math: 0.6, ztable: 0.6, code: 0, results: 0 };
const SECTION_GAP = 0.6;
const INWORLD = 'https://api.inworld.ai/tts/v1/voice';

// Per-voice TTS settings. Cache keys include this config, so a changed
// instruction or rate re-fetches that voice's clips.
const INSTRUCTION = 'Read as a calm academic narrator presenting a research paper: clear, unhurried, and precise.';
const EN_VOICES = {
  Rupert: { languageCode: 'en-GB' },
  Brian: { languageCode: 'en-GB' },
  Alistair: { languageCode: 'en-GB' },
};
// Default narrator per language (calm, native SYSTEM voices).
const LANG_VOICES = {
  es: { voiceId: 'Ignacio', languageCode: 'es-ES' },
  zh: { voiceId: 'Xinyi', languageCode: 'zh-CN' },
  ja: { voiceId: 'Hina', languageCode: 'ja-JP' },
  ko: { voiceId: 'Seojun', languageCode: 'ko-KR' },
  fr: { voiceId: 'Alain', languageCode: 'fr-FR' },
  de: { voiceId: 'Reinhard', languageCode: 'de-DE' },
  pt: { voiceId: 'Renata', languageCode: 'pt-BR' },
  ru: { voiceId: 'Nikolai', languageCode: 'ru-RU' },
  ar: { voiceId: 'Omar', languageCode: 'ar-SA' },
  it: { voiceId: 'Orietta', languageCode: 'it-IT' },
  hi: { voiceId: 'Aanya', languageCode: 'hi-IN' },
  pl: { voiceId: 'Szymon', languageCode: 'pl-PL' },
  nl: { voiceId: 'Lennart', languageCode: 'nl-NL' },
  he: { voiceId: 'Oren', languageCode: 'he-IL' },
};

const args = process.argv.slice(2);
let lang = 'en', voice = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--lang') lang = args[++i];
  else if (args[i] === '--voice') voice = args[++i];
  else voice = args[i];
}
const OUT = lang === 'en' ? path.join(ROOT, 'public', 'whitepaper') : path.join(ROOT, 'public', 'whitepaper', 'i18n', lang);
const CACHE = path.join(ROOT, 'public', 'whitepaper', '.cache');

let voiceId, languageCode, stem, globalName, shortId;
if (lang === 'en') {
  voice = voice || 'Rupert';
  if (!EN_VOICES[voice]) throw new Error(`unknown English voice "${voice}" — options: ${Object.keys(EN_VOICES).join(', ')}`);
  languageCode = EN_VOICES[voice].languageCode;
  voiceId = voice;
  stem = voice === 'Rupert' ? 'narration' : `narration-${voice.toLowerCase()}`;
  globalName = voice === 'Rupert' ? 'window.NARRATION' : `window.NARRATION_${voice.toUpperCase()}`;
  shortId = voice === 'Rupert' ? 'ru' : voice === 'Brian' ? 'br' : 'al';
} else {
  const def = LANG_VOICES[lang];
  if (!def) throw new Error(`unknown language "${lang}" — options: ${Object.keys(LANG_VOICES).join(', ')}`);
  voiceId = voice || def.voiceId;
  languageCode = def.languageCode;
  stem = 'narration';
  shortId = `${lang}1`;
}
const TTS = { modelId: 'inworld-tts-2', lang, voiceId, languageCode, timestampType: 'WORD', speakingRate: 0.95, deliveryMode: 'STABLE', instruction: INSTRUCTION };

const envFiles = [
  process.env.INWORLD_API_KEY ? ['process.env', { INWORLD_API_KEY: process.env.INWORLD_API_KEY }] : null,
  path.join(ROOT, '.env'),
  path.join(ROOT, '.env.local'),
  path.join(ROOT, '..', 'palindrome-969696', '.env'),
].filter(Boolean);
let env = {};
for (const f of envFiles) {
  if (typeof f === 'object') { env = f[1]; continue; }
  if (!fs.existsSync(f)) continue;
  for (const l of fs.readFileSync(f, 'utf8').split('\n').map((x) => x.trim())) {
    if (!l || l.startsWith('#') || !l.includes('=')) continue;
    const k = l.slice(0, l.indexOf('=')).trim(), v = l.slice(l.indexOf('=') + 1).trim();
    if (!env[k]) env[k] = v;
  }
}
if (!env.INWORLD_API_KEY) throw new Error('INWORLD_API_KEY missing from .env');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'whitepaper', 'tokens.js'), 'utf8'), sandbox);
if (lang === 'en') vm.runInContext(fs.readFileSync(path.join(OUT, 'paper.js'), 'utf8'), sandbox);
else vm.runInContext(fs.readFileSync(path.join(OUT, 'paper.js'), 'utf8'), sandbox);
const PAPER = lang === 'en' ? sandbox.window.PAPER : sandbox.window.WP_PAPERS[lang];
if (!PAPER) throw new Error(`no paper for language "${lang}" — run scripts/i18n/build-locale.mjs ${lang} first`);
const { build, sig, norm } = sandbox.window.PaperTokens;
const { tokens, items } = build(PAPER);

fs.mkdirSync(path.join(CACHE, 'tts'), { recursive: true });
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function inworld(text) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(INWORLD, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${env.INWORLD_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        voiceId: TTS.voiceId,
        modelId: TTS.modelId,
        languageCode: TTS.languageCode,
        timestampType: TTS.timestampType,
        deliveryMode: TTS.deliveryMode,
        speakingRate: TTS.speakingRate,
        instruction: TTS.instruction,
        audioConfig: { audioEncoding: 'WAV', sampleRateHertz: RATE },
      }),
    });
    const body = Buffer.from(await res.arrayBuffer());
    if (res.ok) return JSON.parse(body.toString('utf8'));
    const errText = body.toString('utf8').slice(0, 400);
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 6) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** attempt;
      console.warn(`  tts: HTTP ${res.status}, retrying in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    throw new Error(`tts: HTTP ${res.status} ${errText}`);
  }
}

function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV');
  let off = 12, fmt = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') {
      if (size === 0 || size === 0xffffffff || off + 8 + size > buf.length) size = buf.length - off - 8;
      if (!fmt || fmt.channels !== 1 || fmt.rate !== RATE || fmt.bits !== 16) throw new Error('unexpected WAV format ' + JSON.stringify(fmt));
      return buf.subarray(off + 8, off + 8 + (size & ~1));
    }
    off += 8 + size + (size & 1);
  }
  throw new Error('WAV has no data chunk');
}

function wordsFromAlignment(timestampInfo) {
  const wa = timestampInfo?.wordAlignment;
  if (!wa?.words?.length) throw new Error('TTS returned no word timestamps');
  const out = [];
  for (let i = 0; i < wa.words.length; i++) {
    const word = wa.words[i];
    if (!norm(word)) continue;
    out.push({ word, start: wa.wordStartTimeSeconds[i], end: wa.wordEndTimeSeconds[i] });
  }
  if (!out.length) throw new Error('TTS timestamps were all silence/punctuation');
  return out;
}

async function tts(text) {
  if (text.length > 2000) throw new Error('clip too long for Inworld unary TTS: ' + text.slice(0, 60));
  const key = sha(JSON.stringify([TTS, text]));
  const wavFile = path.join(CACHE, 'tts', key + '.wav');
  const jsonFile = path.join(CACHE, 'tts', key + '.json');
  if (!fs.existsSync(wavFile) || !fs.existsSync(jsonFile)) {
    const json = await inworld(text);
    if (!json.audioContent) throw new Error('TTS returned no audioContent');
    fs.writeFileSync(wavFile, Buffer.from(json.audioContent, 'base64'));
    fs.writeFileSync(jsonFile, JSON.stringify(json.timestampInfo || {}));
    stats.ttsChars += text.length;
  }
  const wav = fs.readFileSync(wavFile);
  return {
    key, file: wavFile, pcm: parseWav(wav),
    words: wordsFromAlignment(JSON.parse(fs.readFileSync(jsonFile, 'utf8'))),
  };
}

// Character-level edit-distance alignment between the paper's spoken tokens and
// Inworld's WORD timestamps (which split punctuation into their own tokens).
function align(clipTokens, words) {
  const E = [], Eown = [];
  clipTokens.forEach((tk, k) => { for (const ch of norm(tk.s)) { E.push(ch); Eown.push(k); } });
  const R = [], Rs = [], Re = [];
  for (const w of words) {
    const n = norm(w.word);
    for (let j = 0; j < n.length; j++) {
      R.push(n[j]);
      const a = w.start + ((w.end - w.start) * j) / n.length, b = w.start + ((w.end - w.start) * (j + 1)) / n.length;
      Rs.push(j === 0 ? w.start : a);
      Re.push(j === n.length - 1 ? w.end : b);
    }
  }
  const n = E.length, m = R.length, W = m + 1;
  const back = new Uint8Array((n + 1) * W);
  let prev = new Int32Array(W), cur = new Int32Array(W);
  for (let j = 0; j <= m; j++) { prev[j] = j; back[j] = 2; }
  for (let i = 1; i <= n; i++) {
    cur[0] = i; back[i * W] = 1;
    for (let j = 1; j <= m; j++) {
      const diag = prev[j - 1] + (E[i - 1] === R[j - 1] ? 0 : 1), up = prev[j] + 1, left = cur[j - 1] + 1;
      if (diag <= up && diag <= left) { cur[j] = diag; back[i * W + j] = 0; }
      else if (up <= left) { cur[j] = up; back[i * W + j] = 1; }
      else { cur[j] = left; back[i * W + j] = 2; }
    }
    [prev, cur] = [cur, prev];
  }
  const K = clipTokens.length, st = new Array(K).fill(null), en = new Array(K).fill(null);
  let matched = 0;
  for (let i = n, j = m; i > 0 || j > 0;) {
    const b = back[i * W + j];
    if (i > 0 && j > 0 && b === 0) {
      const k = Eown[i - 1];
      if (E[i - 1] === R[j - 1]) matched++;
      st[k] = st[k] === null ? Rs[j - 1] : Math.min(st[k], Rs[j - 1]);
      en[k] = en[k] === null ? Re[j - 1] : Math.max(en[k], Re[j - 1]);
      i--; j--;
    } else if (i > 0 && (b === 1 || j === 0)) i--;
    else j--;
  }
  const weight = clipTokens.map((tk) => norm(tk.s).length);
  const first = words.length ? words[0].start : 0, last = words.length ? words[words.length - 1].end : 0;
  for (let k = 0; k < K;) {
    if (st[k] !== null) { k++; continue; }
    let e = k;
    while (e < K && st[e] === null) e++;
    const a = k > 0 ? en[k - 1] : first, b = e < K ? st[e] : last;
    const total = weight.slice(k, e).reduce((x, y) => x + y, 0);
    let acc = 0;
    for (let q = k; q < e; q++) {
      const t0 = a + (total ? ((b - a) * acc) / total : 0);
      acc += weight[q];
      st[q] = t0;
      en[q] = a + (total ? ((b - a) * acc) / total : 0);
    }
    k = e;
  }
  for (let k = 1; k < K; k++) st[k] = Math.max(st[k], st[k - 1]);
  for (let k = 0; k < K; k++) en[k] = Math.max(en[k], st[k]);
  return { st, en, quality: n ? matched / n : 1 };
}

async function pool(list, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < list.length) { const i = next++; await fn(list[i], i); }
  }));
}

const stats = { ttsChars: 0 };
const clips = items.filter((it) => it.end > it.start).map((it) => {
  const toks = tokens.slice(it.start, it.end);
  const lastInSection = !items.some((o) => o.sec === it.sec && o.idx > it.idx && o.end > o.start);
  const hold = toks.length === 1 && toks[0].hold;
  return {
    item: it, toks, hold,
    text: hold ? '' : toks.map((t) => t.s).filter(Boolean).join(' '),
    gap: (GAP[it.t] ?? 0.5) + (lastInSection ? SECTION_GAP : 0),
  };
});

console.log(`[${lang}/${TTS.voiceId}] ${tokens.length} words in ${clips.length} clips (${clips.reduce((a, c) => a + c.text.length, 0)} characters to narrate)`);
let done = 0;
await pool(clips, 3, async (clip) => {
  if (clip.hold) { clip.duration = clip.hold; done++; return; }
  clip.audio = await tts(clip.text);
  clip.duration = clip.audio.pcm.length / 2 / RATE;
  clip.map = align(clip.toks, clip.audio.words);
  process.stdout.write(`\r  ${++done}/${clips.length} clips`);
});
process.stdout.write('\n');

const times = new Array(tokens.length * 2).fill(0);
const parts = [Buffer.alloc(Math.round(LEAD_IN * RATE) * 2)];
let offset = LEAD_IN;
const weak = [];
for (const clip of clips) {
  const { start } = clip.item;
  clip.toks.forEach((_, k) => {
    const i = start + k;
    if (clip.hold) { times[i * 2] = offset; times[i * 2 + 1] = offset + clip.hold; }
    else { times[i * 2] = offset + clip.map.st[k]; times[i * 2 + 1] = offset + clip.map.en[k]; }
  });
  if (clip.map && clip.map.quality < 0.85) weak.push(`${(clip.map.quality * 100).toFixed(0)}% "${clip.text.slice(0, 50)}…"`);
  parts.push(clip.hold ? Buffer.alloc(Math.round(clip.hold * RATE) * 2) : clip.audio.pcm);
  offset += clip.duration;
  parts.push(Buffer.alloc(Math.round(clip.gap * RATE) * 2));
  offset += Math.round(clip.gap * RATE) / RATE;
}
const pcm = Buffer.concat(parts);
const duration = pcm.length / 2 / RATE;

const pcmFile = path.join(CACHE, 'narration.pcm');
fs.writeFileSync(pcmFile, pcm);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', String(RATE), '-ac', '1', '-i', pcmFile,
  '-codec:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', path.join(OUT, stem + '.mp3')]);
fs.unlinkSync(pcmFile);

const narration = {
  v: 1, model: TTS.modelId, voice: TTS.voiceId, lang: TTS.lang, speed: TTS.speakingRate, aligner: 'inworld-word',
  duration: +duration.toFixed(2), count: tokens.length, sig: sig(tokens),
  t: times.map((x) => +x.toFixed(2)),
};
if (lang === 'en') {
  fs.writeFileSync(path.join(OUT, stem + '.js'), `${globalName} = ${JSON.stringify(narration)};\n`);
} else {
  const pack = [{ id: shortId, name: TTS.voiceId, nar: narration }];
  fs.writeFileSync(path.join(OUT, stem + '.js'), `window.NARRATION_PACK_LANG = ${JSON.stringify(lang)};\nwindow.NARRATION_PACK = ${JSON.stringify(pack)};\n`);
}

const mb = (fs.statSync(path.join(OUT, stem + '.mp3')).size / 1e6).toFixed(1);
console.log(`[${lang}/${TTS.voiceId}] ${stem}.audio: ${Math.floor(duration / 60)}m${Math.round(duration % 60)}s, ${mb} MB`);
console.log(`[${lang}/${TTS.voiceId}] new API usage this run: ${stats.ttsChars} TTS characters`);
if (weak.length) console.log('low-confidence alignments (interpolated):\n  ' + weak.join('\n  '));
