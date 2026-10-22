// Thin Spotify Web API client with caching, rate-limit handling and batch lookups.
import { getAccessToken, logout, AuthError } from "./auth.js";

const BASE = "https://api.spotify.com/v1";
const CACHE_PREFIX = "sc_cache:";
const HOUR = 3600 * 1000;

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { expires, value } = JSON.parse(raw);
    if (Date.now() > expires) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function cacheSet(key, value, ttl) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ expires: Date.now() + ttl, value }));
  } catch {
    // Quota exceeded: drop the whole cache and carry on.
    clearCache();
  }
}

export function clearCache() {
  Object.keys(localStorage)
    .filter((k) => k.startsWith(CACHE_PREFIX))
    .forEach((k) => localStorage.removeItem(k));
}

export async function api(path, params = {}, { ttl = HOUR, retry = 1 } = {}) {
  const query = new URLSearchParams(params).toString();
  const url = `${BASE}${path}${query ? `?${query}` : ""}`;
  const cached = ttl > 0 ? cacheGet(url) : null;
  if (cached) return cached;

  const token = await getAccessToken();
  if (!token) throw new AuthError("Not signed in.");

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401) {
    logout();
    throw new AuthError("Session expired. Please sign in again.");
  }
  if (response.status === 429 && retry > 0) {
    const wait = Math.min(Number(response.headers.get("Retry-After") || 2), 15) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return api(path, params, { ttl, retry: retry - 1 });
  }
  if (response.status === 403) {
    const body = await response.text().catch(() => "");
    throw new Error(
      body.includes("not registered")
        ? "This Spotify account is not allowlisted on the app. Add it under User Management in the developer dashboard."
        : `Forbidden (403). ${body}`,
    );
  }
  if (response.status >= 500 && retry > 0) {
    await new Promise((r) => setTimeout(r, 1500));
    return api(path, params, { ttl, retry: retry - 1 });
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = typeof body.error === "string" ? body.error : body.error?.message || "";
    throw new Error(`Spotify returned ${response.status} for ${path}${detail ? `: ${detail}` : ""}`);
  }
  const json = response.status === 204 ? null : await response.json();
  if (ttl > 0 && json) cacheSet(url, json, ttl);
  return json;
}

export const getMe = () => api("/me", {}, { ttl: 24 * HOUR });

export const getTop = (type, timeRange, limit = 50) =>
  api(`/me/top/${type}`, { time_range: timeRange, limit });

export const getRecentlyPlayed = (limit = 50) => api("/me/player/recently-played", { limit }, { ttl: 5 * 60 * 1000 });

// --- Batch lookups used to decorate history data with artwork and genres ---

const smallestImage = (images, min = 160) => {
  if (!images?.length) return null;
  const sorted = [...images].sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find((i) => (i.width || 0) >= min) || sorted[sorted.length - 1]).url;
};

export const slimArtist = (a) => ({
  id: a.id,
  name: a.name,
  image: smallestImage(a.images),
  genres: a.genres || [],
  url: a.external_urls?.spotify,
});

export const slimTrack = (t) => ({
  id: t.id,
  name: t.name,
  artists: (t.artists || []).map((a) => ({ id: a.id, name: a.name })),
  album: t.album?.name,
  image: smallestImage(t.album?.images),
  url: t.external_urls?.spotify,
  duration_ms: t.duration_ms,
});

async function batchLookup(kind, ids, slim) {
  const unique = [...new Set(ids.filter(Boolean))];
  const results = new Map();
  const missing = [];
  for (const id of unique) {
    const cached = cacheGet(`${kind}:${id}`);
    if (cached) results.set(id, cached);
    else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50);
    const json = await api(`/${kind}`, { ids: chunk.join(",") }, { ttl: 0 });
    for (const item of json[kind] || []) {
      if (!item) continue;
      const value = slim(item);
      results.set(item.id, value);
      cacheSet(`${kind}:${item.id}`, value, 30 * 24 * HOUR);
    }
  }
  return results;
}

export const getTracks = (ids) => batchLookup("tracks", ids, slimTrack);
export const getArtists = (ids) => batchLookup("artists", ids, slimArtist);

export const trackIdFromUri = (uri) => (uri && uri.startsWith("spotify:track:") ? uri.slice(14) : null);
