// Tempo (BPM) lookups. Spotify closed its Audio Features endpoint to new apps in
// November 2024, so tempo comes from ReccoBeats (batch lookup by Spotify track ID,
// CORS-enabled, no key) with Deezer as a fallback (by ISRC, or by artist + title
// search; JSONP because Deezer sends no CORS header). Results, including misses,
// are cached in IndexedDB so every track is looked up at most once a month.
import { idbGet, idbSet } from "./db.js";
import { getTracks } from "./api.js";

const RECCOBEATS = "https://api.reccobeats.com/v1/audio-features";
const DEEZER = "https://api.deezer.com";
const BATCH = 40;
const MISS_TTL = 30 * 24 * 3600 * 1000;
const CACHE_KEY = "tempoCache";

let cache = null;
let saveTimer = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadCache() {
  if (!cache) {
    try {
      cache = (await idbGet(CACHE_KEY)) || {};
    } catch {
      cache = {};
    }
  }
  return cache;
}

function remember(id, entry) {
  cache[id] = { ...(cache[id] || {}), ...entry, t: Date.now() };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => idbSet(CACHE_KEY, cache).catch(() => {}), 400);
}

const spotifyIdFromHref = (href) => (href || "").split("/").pop().split("?")[0];

async function fetchReccoBeats(ids, attempt = 0) {
  const res = await fetch(`${RECCOBEATS}?ids=${ids.join(",")}`);
  if (res.status === 429 && attempt < 3) {
    const wait = Math.min(Number(res.headers.get("Retry-After") || 2), 10) * 1000;
    await sleep(wait);
    return fetchReccoBeats(ids, attempt + 1);
  }
  if (res.status === 400) {
    // Batch too large or a bad id: split and retry, but never down to single-id requests.
    if (ids.length <= 10) return [];
    const half = Math.ceil(ids.length / 2);
    return [...(await fetchReccoBeats(ids.slice(0, half))), ...(await fetchReccoBeats(ids.slice(half)))];
  }
  if (!res.ok) throw new Error(`ReccoBeats returned ${res.status}`);
  const json = await res.json();
  return json.content || [];
}

function jsonp(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const cb = `dz_cb_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Deezer request timed out"));
    }, timeout);
    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
    }
    window[cb] = (data) => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("Deezer request failed"));
    };
    script.src = `${url}${url.includes("?") ? "&" : "?"}output=jsonp&callback=${cb}`;
    document.head.appendChild(script);
  });
}

const bpmOf = (track) => (track && !track.error && Number(track.bpm) > 0 ? Number(track.bpm) : null);

// Deezer's search endpoint returns empty result sets in some regions, so the fallback
// relies on the ISRC lookup only. ISRCs come from ReccoBeats or Spotify's track objects.
async function deezerByIsrc(isrc) {
  return bpmOf(await jsonp(`${DEEZER}/track/isrc:${encodeURIComponent(isrc)}`));
}

/**
 * items: [{ id: spotifyTrackId, name, artist, isrc? }] in priority order (most-played first).
 * Returns Map(spotifyTrackId -> bpm) for every track a tempo was found for.
 */
export async function lookupTempos(items, { loggedIn = false, onProgress = () => {}, fallbackLimit = 25 } = {}) {
  await loadCache();
  const now = Date.now();
  const result = new Map();
  const needRecco = [];
  const reccoMissed = [];

  const validId = /^[0-9A-Za-z]{22}$/;
  for (const it of items) {
    if (!it.id || !validId.test(it.id)) continue;
    const c = cache[it.id];
    if (c?.tempo > 0) {
      result.set(it.id, c.tempo);
    } else if (c && c.tempo === null && now - c.t < MISS_TTL) {
      // Recently missed. If Deezer was never tried, it may still get a chance below.
      if (!c.deezer) reccoMissed.push(it);
    } else {
      needRecco.push(it);
    }
  }

  // 1. ReccoBeats, in batches.
  for (let i = 0; i < needRecco.length; i += BATCH) {
    const chunk = needRecco.slice(i, i + BATCH);
    onProgress(`Looking up tempo for ${Math.min(i + BATCH, needRecco.length)} of ${needRecco.length} songs…`);
    let content;
    try {
      content = await fetchReccoBeats(chunk.map((it) => it.id));
    } catch (e) {
      console.warn("ReccoBeats lookup failed", e);
      // Leave the rest unknown; a later visit will retry.
      for (const it of needRecco.slice(i)) reccoMissed.push(it);
      break;
    }
    const found = new Set();
    for (const c of content) {
      const id = spotifyIdFromHref(c.href);
      if (!id || !(c.tempo > 0)) continue;
      found.add(id);
      result.set(id, c.tempo);
      remember(id, { tempo: c.tempo, isrc: c.isrc || null, src: "reccobeats" });
    }
    for (const it of chunk) {
      if (found.has(it.id)) continue;
      reccoMissed.push(it);
      remember(it.id, { tempo: null, isrc: it.isrc || cache[it.id]?.isrc || null });
    }
    if (i + BATCH < needRecco.length) await sleep(200);
  }

  // 2. Deezer fallback for the most-played misses.
  const candidates = reccoMissed.slice(0, fallbackLimit);
  if (candidates.length) {
    if (loggedIn) {
      const needIsrc = candidates.filter((it) => !it.isrc && !cache[it.id]?.isrc);
      if (needIsrc.length) {
        try {
          const tracks = await getTracks(needIsrc.map((it) => it.id));
          for (const it of needIsrc) it.isrc = tracks.get(it.id)?.isrc || null;
        } catch (e) {
          console.warn("ISRC lookup failed", e);
        }
      }
    }
    const withIsrc = candidates.filter((it) => it.isrc || cache[it.id]?.isrc);
    let n = 0;
    for (const it of withIsrc) {
      n++;
      onProgress(`Checking Deezer for ${n} of ${withIsrc.length} songs ReccoBeats did not know…`);
      const isrc = it.isrc || cache[it.id]?.isrc;
      let bpm = null;
      try {
        bpm = await deezerByIsrc(isrc);
      } catch (e) {
        console.warn("Deezer lookup failed", e);
      }
      if (bpm) {
        result.set(it.id, bpm);
        remember(it.id, { tempo: bpm, isrc, src: "deezer" });
      } else {
        remember(it.id, { tempo: null, isrc, deezer: true });
      }
      await sleep(150); // Deezer allows 50 requests per 5 seconds
    }
  }

  return result;
}

// True when some misses could still be resolved by signing in (ISRCs come from Spotify).
export async function hasUnresolvedMisses(ids) {
  await loadCache();
  return ids.some((id) => cache[id] && cache[id].tempo === null && !cache[id].deezer);
}

export async function tempoCacheSize() {
  await loadCache();
  return Object.values(cache).filter((c) => c.tempo > 0).length;
}
