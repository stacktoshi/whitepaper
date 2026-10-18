// The Bitcoin whitepaper — narrated, interactive edition.
// A single Cloudflare Worker: serves the app HTML at / and /whitepaper, the
// narration audio with HTTP Range support, a tiny mempool.space market proxy,
// and every static asset from public/whitepaper/* via the ASSETS binding.
import appHtml from './whitepaper.html';

// Cloudflare Workers static assets do not honor Range requests, which breaks
// media seeking (the browser reports seekable [(0,0)] and every scrub/word
// click clamps to 0). This handler loads the mp3 from the asset bundle once
// per isolate and serves byte ranges itself. Voice is picked via ?voice= and
// the language pack via ?lang= (en = Rupert/Brian/Alistair at the legacy
// paths; any other lang serves whitepaper/i18n/<lang>/narration.audio).
const VOICE_ASSETS: Record<string, string> = {
  'en:ru': 'whitepaper/narration.audio',
  'en:br': 'whitepaper/narration-brian.audio',
  'en:al': 'whitepaper/narration-alistair.audio',
};

const audioCache = new Map<string, ArrayBuffer>();

function assetForVoice(url: URL): string {
  const voice = url.searchParams.get('voice') || 'ru';
  const lang = url.searchParams.get('lang') || 'en';
  const known = VOICE_ASSETS[`${lang}:${voice}`];
  if (known) return known;
  if (lang !== 'en') return `whitepaper/i18n/${lang}/narration.audio`;
  return VOICE_ASSETS[`en:ru`];
}

async function loadAudio(file: string): Promise<ArrayBuffer> {
  const cached = audioCache.get(file);
  if (cached) return cached;
  const res = await env.ASSETS.fetch(`https://assets.local/${file}`);
  if (!res.ok) throw new Error('narration audio unavailable');
  const buffer = await res.arrayBuffer();
  audioCache.set(file, buffer);
  return buffer;
}

function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m) return null;

  let start: number;
  let end: number;
  if (m[1] === '') {
    // suffix range: bytes=-N
    const n = Number.parseInt(m[2], 10);
    if (Number.isNaN(n) || n === 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number.parseInt(m[1], 10);
    end = m[2] === '' ? size - 1 : Number.parseInt(m[2], 10);
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return null;
  if (end > size - 1) end = size - 1;
  return { start, end };
}

async function narration(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const file = assetForVoice(url);
  const buffer = await loadAudio(file);
  const size = buffer.byteLength;

  const headers = new Headers({
    'content-type': 'audio/mpeg',
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=86400',
  });

  const rangeHeader = request.headers.get('range');
  if (!rangeHeader) {
    headers.set('content-length', String(size));
    return new Response(buffer.slice(0), { status: 200, headers });
  }

  const range = parseRange(rangeHeader, size);
  if (!range) {
    headers.set('content-range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  headers.set('content-range', `bytes ${range.start}-${range.end}/${size}`);
  headers.set('content-length', String(range.end - range.start + 1));
  return new Response(buffer.slice(range.start, range.end + 1), { status: 206, headers });
}

// GET /api/market -> { height, price, change24h } from mempool.space, cached 5 min.
let marketCache: { at: number; body: string } | null = null;
const FIVE_MIN = 5 * 60 * 1000;
async function market(): Promise<Response> {
  if (marketCache && Date.now() - marketCache.at < FIVE_MIN) {
    return new Response(marketCache.body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  try {
    const [hRes, pRes] = await Promise.all([
      fetch('https://mempool.space/api/blocks/tip/height'),
      fetch('https://mempool.space/api/v1/prices'),
    ]);
    if (!hRes.ok || !pRes.ok) throw new Error('upstream');
    const height = Number((await hRes.text()).trim());
    const prices = await pRes.json() as { USD?: number; USD_24h?: number };
    const price = prices.USD;
    const change = prices.USD_24h ? ((prices.USD_24h - price) / prices.USD_24h) * 100 : null;
    const body = JSON.stringify({ height, price, change24h: change });
    marketCache = { at: Date.now(), body };
    return new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch {
    return new Response('{}', { status: 502, headers: { 'content-type': 'application/json' } });
  }
}

const htmlHeaders = {
  'content-type': 'text/html; charset=utf-8',
  // must revalidate: a long cache served stale UI after deployments
  'cache-control': 'no-cache',
};

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/whitepaper/narration.mp3') return narration(request);
    if (path === '/api/market') return market();
    if (path === '/' || path === '/whitepaper' || path === '/whitepaper/') {
      return new Response(appHtml, { headers: htmlHeaders });
    }
    // static assets under /whitepaper/* (and anything else in the bundle)
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<{ ASSETS: Fetcher }>;
