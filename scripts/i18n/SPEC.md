# Language pack spec (`scripts/i18n/<lang>.json`)

One JSON file per language. Compile + validate with:

```
node scripts/i18n/build-locale.mjs <lang>
```

It exits 0 and writes `public/whitepaper/i18n/<lang>/` only when every check passes.
Fix the reported problems and re-run until clean. Do not edit anything else.

## Top-level shape

```json
{
  "paper": { "sections": [ ...same sections as scripts/i18n/en.json "paper", display text translated... ] },
  "ui": {
    "labels": { ...every key from en.json "labels", value translated... },
    "chrome": { ...every key from en.json "chrome", value translated... },
    "caps":   { "coin": ["cap step 0", "cap step 1", ...], "merkle": [...], "merkle": {"fig": "..."} },
    "caps":   { "<scene>": [ caption per step, same order/count as en.json "caps" ], "<scene>": { "fig": "figure caption" } },
    "cues":   { "The cost of mediation": "translated phrase that occurs verbatim in that section", ... }
  }
}
```

(`caps` is keyed by scene id from en.json `caps`; `cues` keys are the English cue
phrases from en.json `cues`, values are translations.)

## Paper body rules

- **Source of truth**: the official bitcoin.org translation at
  `scripts/i18n/src/<lang>.txt` (extracted from `https://bitcoin.org/files/bitcoin-paper/bitcoin_<code>.pdf`).
  Do NOT re-translate paragraphs that exist there; clean up PDF line breaks and
  footnote markers (superscript numbers that the PDF uses for footnotes) and drop
  any translator credit lines.
- Preserve the **exact section structure** of en.json `paper`: same section ids,
  order, `num`, `scene`, same item types in the same order, same counts.
  `refs` items: keep the bibliography entries in their original English form
  (only that item's `list`, untranslated).
- Text syntax: plain text, or `{display|spoken}` groups. Empty spoken (`{...|}`)
  = silent (citations). Inline citation markers like `[1]`/`[2-5]` become
  `{[1]|}` / `{[2-5]|}` (displayed but silent) exactly where the official text has them.
- Spoken side defaults to the display side. Only add a `{display|spoken}` group
  where reading the display text literally would sound wrong in TTS
  (formulas, "SHA-256", "2GB", rare). Keep groups rare.
- `title` item: exactly 4 `lines` (styled tl0..tl3): line 0 = the work's name
  ("Bitcoin"), lines 1–3 the subtitle, split to mirror the English visual
  hierarchy (large → small). Keep each line short enough for a 2220px-wide
  poster at ~150–270px type.
- `byline` item: must tokenize to exactly 4 tokens. Use the same shape as English:
  `Satoshi Nakamoto {satoshin@gmx.com|} {www.bitcoin.org|}` (name in Latin script).
- `math` items (ids `qz`, `lambda`, `sum`, `rearr`): keep `id`; `say` is the
  formula read out in natural spoken <lang> ("q sub z equals one if..." style of
  en.json `paper`), not the literal symbols.
- `ztable`: `head` + 8 rows × 2 cells, cells as `{display|spoken}` like English
  (`{q=0.10|q equals 0.10,}` → spoken words in <lang>).
- `code` and `results` items: keep `hold` values (5 and 5.5). `fig` items keep `h`.
- Keep `hold` values, item order and section `scene` values untouched.

## ui rules

- `labels`: translate every value (diagram strings, scene text). `{n}`/`{h}`/`{m}`
  placeholders must survive. Keys never change. Keep `\n` where the English has it.
  Technical tokens that are universal (`SHA-256`, `Tx`, `12:00`, `? → ?  1.5 BTC`,
  `10:02 · 0.5 BTC`, `IP 10.0.0.1`) stay as-is.
- `chrome`: translate every value; `{voice}`, `{minutes}`, `{hint}`, `{n}` survive.
- `caps`: same array lengths as en.json `caps` per scene (step captions), plus
  `fig` where the English scene has one (only `merkle` and `spv`).
- `cues`: for each English cue phrase (key), write a **short phrase that occurs
  verbatim in that scene's section of your translated paper** (the phrase the
  narration says when the scene step should fire). Copy it from your own paper
  text — do not invent phrasing. `#qz` style keys don't appear here (handled by id).
- Script notes: Arabic/Hebrew — keep math/code snippets (`SHA-256`, `q/p`, `80 bytes`)
  LTR inside the value; the UI isolates them automatically.

## Checks you must pass

1. `node scripts/i18n/build-locale.mjs <lang>` exits 0.
2. Spot-check: title + byline + abstract render as 4/1/2 items etc. (enforced).
3. Every caps array length matches en.json exactly (enforced).
4. Every cue resolves inside its section (enforced).
