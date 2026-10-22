// Extended Streaming History importer: parses Spotify's data export (JSON or ZIP),
// normalises both the extended and the legacy account-data formats, de-duplicates
// and persists everything in IndexedDB so it survives reloads.

const DB_NAME = "sound-capsule";
const STORE = "kv";
const RECORDS_KEY = "records";
const META_KEY = "meta";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const idbGet = (key) => withStore("readonly", (s) => s.get(key));
const idbSet = (key, value) => withStore("readwrite", (s) => s.put(value, key));
const idbDel = (key) => withStore("readwrite", (s) => s.delete(key));

export async function loadStoredHistory() {
  const [records, meta] = await Promise.all([idbGet(RECORDS_KEY), idbGet(META_KEY)]);
  return { records: records || [], meta: meta || { sources: [] } };
}

export async function clearStoredHistory() {
  await idbDel(RECORDS_KEY);
  await idbDel(META_KEY);
}

// ---------------------------------------------------------------------------
// Parsing

const recordKey = (r) => `${r.t}|${r.ms}|${r.uri || r.track}`;

function normaliseItem(item) {
  // Extended streaming history (Streaming_History_Audio_*.json)
  if (item.ts !== undefined) {
    const t = Date.parse(item.ts);
    if (!Number.isFinite(t)) return null;
    const ms = Number(item.ms_played) || 0;
    if (item.master_metadata_track_name) {
      return {
        t,
        ms,
        type: "music",
        track: item.master_metadata_track_name,
        artist: item.master_metadata_album_artist_name || "Unknown artist",
        album: item.master_metadata_album_album_name || null,
        uri: item.spotify_track_uri || null,
        skipped: item.skipped === true,
      };
    }
    if (item.episode_name) {
      return {
        t,
        ms,
        type: "podcast",
        track: item.episode_name,
        artist: item.episode_show_name || "Unknown show",
        album: null,
        uri: item.spotify_episode_uri || null,
        skipped: item.skipped === true,
      };
    }
    return null;
  }
  // Legacy account data (StreamingHistory_music_*.json): endTime is UTC "YYYY-MM-DD HH:MM"
  if (item.endTime !== undefined) {
    const t = Date.parse(item.endTime.replace(" ", "T") + ":00Z");
    if (!Number.isFinite(t)) return null;
    return {
      t,
      ms: Number(item.msPlayed) || 0,
      type: "music",
      track: item.trackName || "Unknown track",
      artist: item.artistName || "Unknown artist",
      album: null,
      uri: null,
      skipped: false,
    };
  }
  return null;
}

function parseJsonText(text, into) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON.");
  }
  if (!Array.isArray(data)) return 0;
  let n = 0;
  for (const item of data) {
    const rec = normaliseItem(item);
    if (rec) {
      into.push(rec);
      n++;
    }
  }
  return n;
}

const looksLikeHistoryFile = (name) => {
  const base = name.split("/").pop();
  return /\.json$/i.test(base) && /^(Streaming_History|StreamingHistory)/i.test(base);
};

// Parses dropped files (JSON and/or ZIP). Returns new records plus per-file counts.
export async function parseFiles(files, onProgress = () => {}) {
  const records = [];
  const sources = [];
  const list = Array.from(files);
  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    onProgress(`Reading ${file.name} (${i + 1}/${list.length})`);
    if (/\.zip$/i.test(file.name)) {
      if (!window.JSZip) throw new Error("ZIP support failed to load. Unzip the export and drop the JSON files instead.");
      const zip = await window.JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter((e) => !e.dir && looksLikeHistoryFile(e.name));
      if (!entries.length) throw new Error(`${file.name} contains no Streaming_History JSON files.`);
      for (const entry of entries) {
        onProgress(`Parsing ${entry.name.split("/").pop()}`);
        const count = parseJsonText(await entry.async("string"), records);
        sources.push({ name: entry.name.split("/").pop(), count });
      }
    } else if (/\.json$/i.test(file.name)) {
      const count = parseJsonText(await file.text(), records);
      sources.push({ name: file.name, count });
    } else {
      sources.push({ name: file.name, count: 0, skipped: true });
    }
  }
  return { records, sources };
}

// Merge new records into the stored set, de-duplicating, and persist.
export async function addToHistory(newRecords, newSources) {
  const { records, meta } = await loadStoredHistory();
  const seen = new Set(records.map(recordKey));
  let added = 0;
  for (const r of newRecords) {
    const key = recordKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    records.push(r);
    added++;
  }
  records.sort((a, b) => a.t - b.t);
  const byName = new Map((meta.sources || []).map((s) => [s.name, s]));
  for (const s of newSources) if (!s.skipped) byName.set(s.name, s);
  const sources = [...byName.values()];
  const newMeta = { sources, importedAt: Date.now() };
  await idbSet(RECORDS_KEY, records);
  await idbSet(META_KEY, newMeta);
  return { records, meta: newMeta, added, duplicates: newRecords.length - added };
}
