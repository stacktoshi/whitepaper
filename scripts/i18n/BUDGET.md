# i18n TTS budget (Inworld TTS-2, $25 / 1M chars)

| lang | voice | chars billed | $ est |
|------|-------|-------------:|------:|
| en (baseline, pre-existing) | Rupert | — | — |
| en | Brian | — | — (pre-existing) |
| en | Alistair | 18,937 | 0.47 |
| es | Ignacio | 21,183 | 0.53 |
| de | Reinhard | 23,111 | 0.58 |
| it | Orietta | 22,754 | 0.57 |
| zh | Xinyi | 10,861 | 0.27 |
| ja | Hina | 16,688 | 0.42 |
| fr | Alain | 21,866 | 0.55 |
| ko | Seojun | 8,917 | 0.22 |
| ar | Omar | 15,402 | 0.39 |
| pt | Renata | 20,132 | 0.50 |
| ru | Nikolai | 19,271 | 0.48 |
| pl | Szymon | 20,322 | 0.51 |
| nl | Lennart | 21,615 | 0.54 |
| hi | Aanya | 18,908 | 0.47 |
| he | Oren | 14,787 | 0.37 |
| gr | Tristan | 22,914 | 0.57 (superseded by ElevenLabs) |

Running total: 297,668 chars ≈ $7.44 of ~$15. All 15 languages done.
Plan: remaining packs ≈ $0.55 each (CJK cheaper) — well within budget.

## ElevenLabs (Greek re-voice)

| lang | voice | model | chars billed |
|------|-------|-------|-------------:|
| gr | Theon (native Greek) | eleven_multilingual_v2 | 22,914 |

Greek narration is generated with `node scripts/build-narration.mjs --lang gr --provider elevenlabs`.
