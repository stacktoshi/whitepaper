// Shared by whitepaper.html and scripts/build-narration.mjs so word indices always line up.
// Text syntax: plain words, or {display|spoken} groups (empty spoken = silent, e.g. citations).
// CJK text (Han / Kana / fullwidth punctuation) carries no spaces, so those runs are split
// into per-character tokens to keep word-level timing and cue matching usable.
(function (root) {
  const RE = /\{([^{}|]*)\|([^{}]*)\}(\S*)|(\S+)/g;
  // Han, Hiragana, Katakana, CJK punctuation and fullwidth forms.
  const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff01-\uff60]/;

  // Split a whitespace-free chunk into renderable units: each CJK char is its own
  // token, contiguous latin/digit/punctuation runs stay together.
  function splitUnits(s) {
    if (!s || !CJK.test(s)) return [s];
    const out = [];
    let cur = '';
    for (const ch of s) {
      if (CJK.test(ch)) { if (cur) { out.push(cur); cur = ''; } out.push(ch); }
      else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }

  function tokenize(text) {
    const out = [];
    RE.lastIndex = 0;
    let m;
    while ((m = RE.exec(text))) {
      if (m[4] !== undefined) {
        for (const u of splitUnits(m[4])) out.push({ d: u, s: u });
      } else {
        const spoken = (m[2] + m[3]).trim();
        const dparts = splitUnits(m[1] + m[3]);
        const sparts = spoken ? splitUnits(spoken) : [];
        if (dparts.length === sparts.length) {
          dparts.forEach((d, i) => out.push({ d, s: sparts[i] }));
        } else if (!spoken) {
          dparts.forEach((d) => out.push({ d, s: '' }));
        } else {
          // display/spoken split counts differ (rare): time the whole spoken
          // phrase against the first display unit.
          dparts.forEach((d, i) => out.push({ d, s: i === 0 ? spoken : '' }));
        }
      }
    }
    return out;
  }

  // Unicode-aware normalization for cue matching and TTS alignment: strip
  // diacritics/marks, lowercase, keep letters + digits from every script
  // (Latin, CJK, Arabic, Hebrew, Devanagari, ...).
  const norm = (s) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

  function build(paper) {
    const tokens = [], items = [], sections = [];
    paper.sections.forEach((sec, si) => {
      const secStart = tokens.length;
      sec.items.forEach((item, ii) => {
        const start = tokens.length;
        const push = (tok, extra) => tokens.push({ ...tok, sec: si, item: items.length, ...extra });
        const meta = { sec: si, idx: ii, t: item.t, src: item, start, end: start };
        if (item.t === 'title') {
          meta.lines = item.lines.map((line) => {
            const a = tokens.length;
            tokenize(line).forEach((tk) => push(tk));
            return [a, tokens.length];
          });
        } else if (item.text !== undefined) {
          tokenize(item.text).forEach((tk) => push(tk));
        } else if (item.t === 'math') {
          push({ d: '', s: item.say }, { kind: 'math' });
        } else if (item.hold) {
          push({ d: '', s: '' }, { kind: item.t, hold: item.hold });
        } else if (item.t === 'ztable') {
          tokenize(item.head).forEach((tk) => push(tk));
          meta.rows = item.rows.map((row) => row.map((cell) => {
            const a = tokens.length;
            tokenize(cell).forEach((tk) => push(tk));
            return [a, tokens.length];
          }));
        }
        meta.end = tokens.length;
        items.push(meta);
      });
      sections.push({ id: sec.id, label: sec.label, num: sec.num, scene: sec.scene, start: secStart, end: tokens.length });
    });
    return { tokens, items, sections };
  }

  function sig(tokens) {
    let h = 0x811c9dc5;
    const str = tokens.map((t) => t.d + '\u241f' + t.s).join('\u241e');
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16) + ':' + tokens.length;
  }

  root.PaperTokens = { tokenize, build, sig, norm };
})(typeof window !== 'undefined' ? window : globalThis);
