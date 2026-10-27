// Pure functions that turn normalised history records into Sound Capsule style stats.

const DAY = 86400000;
const STREAM_MS = 30000; // Spotify counts a play once 30 seconds have elapsed

export const RANGES = [
  { id: "4w", label: "Last 4 weeks", days: 28 },
  { id: "6m", label: "Last 6 months", days: 182 },
  { id: "1y", label: "Last year", days: 365 },
  { id: "all", label: "All time" },
];

export const ARTIST_MILESTONES = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000];
export const TRACK_MILESTONES = [25, 50, 100, 250, 500, 1000];
export const TOTAL_MILESTONES = [1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000];

const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function yearsIn(records) {
  const years = new Set();
  for (const r of records) years.add(new Date(r.t).getFullYear());
  return [...years].sort((a, b) => b - a);
}

// Calendar months with music plays, newest first, as "YYYY-MM".
export function monthsIn(records) {
  const months = new Set();
  for (const r of records) {
    if (r.type !== "music") continue;
    const d = new Date(r.t);
    months.add(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  }
  return [...months].sort().reverse();
}

export const isMonthId = (id) => /^\d{4}-\d{2}$/.test(id);
export const isYearId = (id) => /^\d{4}$/.test(id);

// Windows are anchored on the most recent record, since exports are always a little stale.
export function windowFor(rangeId, records) {
  if (!records.length) return { start: 0, end: 0, label: "" };
  const last = records[records.length - 1].t;
  if (isMonthId(rangeId)) {
    const [y, m] = rangeId.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    return {
      start: first.getTime(),
      end: new Date(y, m, 1).getTime() - 1,
      label: first.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    };
  }
  if (isYearId(rangeId)) {
    const y = Number(rangeId);
    return { start: new Date(y, 0, 1).getTime(), end: new Date(y + 1, 0, 1).getTime() - 1, label: String(y) };
  }
  const range = RANGES.find((r) => r.id === rangeId) || RANGES[0];
  const end = last;
  const start = range.days ? end - range.days * DAY : records[0].t;
  return { start, end, label: range.label };
}

const startOfDay = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

function bump(map, key, rec, meta) {
  let e = map.get(key);
  if (!e) {
    e = { key, ms: 0, plays: 0, count: 0, ...meta };
    map.set(key, e);
  }
  e.ms += rec.ms;
  e.count++;
  if (rec.ms >= STREAM_MS) e.plays++;
  return e;
}

const sortedTop = (map, n) => [...map.values()].sort((a, b) => b.ms - a.ms).slice(0, n);

function streaks(dayKeys) {
  const days = [...dayKeys].sort();
  let longest = 0;
  let current = 0;
  let prev = null;
  for (const k of days) {
    const t = new Date(k + "T00:00:00").getTime();
    current = prev !== null && Math.round((t - prev) / DAY) === 1 ? current + 1 : 1;
    prev = t;
    if (current > longest) longest = current;
  }
  return { longest, current };
}

export function computeStats(records, { start, end }) {
  const artists = new Map();
  const tracks = new Map();
  const albums = new Map();
  const hours = new Array(24).fill(0);
  const weekdays = new Array(7).fill(0);
  const days = new Map();
  const dayPlays = new Map();
  const dayTracks = new Map(); // dayKey -> Map(trackKey -> ms), for each day's top song
  const months = new Map();
  const artistFirst = new Map(); // artist -> first play ever (before or inside window)
  const artistBefore = new Map(); // all-time artist ms before window
  const artistThrough = new Map(); // all-time artist ms through window end
  const trackBefore = new Map();
  const trackThrough = new Map();
  let totalBefore = 0;
  let totalThrough = 0;
  let ms = 0;
  let streams = 0;
  let skips = 0;
  let podcastMs = 0;
  let podcastStreams = 0;

  for (const rec of records) {
    if (rec.t > end) break; // records are sorted
    if (rec.type !== "music") {
      if (rec.t >= start) {
        podcastMs += rec.ms;
        if (rec.ms >= STREAM_MS) podcastStreams++;
      }
      continue;
    }
    const trackKey = rec.uri || `${rec.artist}|${rec.track}`;
    const isStream = rec.ms >= STREAM_MS;
    if (isStream && !artistFirst.has(rec.artist)) artistFirst.set(rec.artist, rec.t);
    artistThrough.set(rec.artist, (artistThrough.get(rec.artist) || 0) + rec.ms);
    if (isStream) trackThrough.set(trackKey, (trackThrough.get(trackKey) || 0) + 1);
    totalThrough += rec.ms;
    if (rec.t < start) {
      artistBefore.set(rec.artist, (artistBefore.get(rec.artist) || 0) + rec.ms);
      if (isStream) trackBefore.set(trackKey, (trackBefore.get(trackKey) || 0) + 1);
      totalBefore += rec.ms;
      continue;
    }

    ms += rec.ms;
    if (isStream) streams++;
    if (rec.skipped) skips++;
    const d = new Date(rec.t);
    hours[d.getHours()] += rec.ms;
    weekdays[d.getDay()] += rec.ms;
    const dk = dayKey(d);
    days.set(dk, (days.get(dk) || 0) + rec.ms);
    if (isStream) dayPlays.set(dk, (dayPlays.get(dk) || 0) + 1);
    let dt = dayTracks.get(dk);
    if (!dt) {
      dt = new Map();
      dayTracks.set(dk, dt);
    }
    dt.set(trackKey, (dt.get(trackKey) || 0) + rec.ms);
    const mk = dk.slice(0, 7);
    months.set(mk, (months.get(mk) || 0) + rec.ms);

    const artist = bump(artists, rec.artist, rec, { name: rec.artist, topTrackUri: null, topTrackMs: 0 });
    const track = bump(tracks, trackKey, rec, { name: rec.track, artist: rec.artist, album: rec.album, uri: rec.uri });
    if (track.ms > artist.topTrackMs) {
      artist.topTrackMs = track.ms;
      artist.topTrackUri = rec.uri;
    }
    if (rec.album) bump(albums, `${rec.artist}|${rec.album}`, rec, { name: rec.album, artist: rec.artist, uri: rec.uri });
  }

  // Discoveries: artists whose first ever stream falls inside the window.
  const discoveries = [];
  for (const a of artists.values()) {
    const first = artistFirst.get(a.name);
    if (first !== undefined && first >= start) discoveries.push(a);
  }
  discoveries.sort((a, b) => b.ms - a.ms);

  // Milestones crossed inside the window.
  const milestones = [];
  for (const [name, through] of artistThrough) {
    if (!artists.has(name)) continue;
    const before = (artistBefore.get(name) || 0) / 60000;
    const after = through / 60000;
    const crossed = ARTIST_MILESTONES.filter((m) => before < m && after >= m);
    if (crossed.length) {
      milestones.push({ kind: "artist", name, value: crossed[crossed.length - 1], unit: "minutes", total: Math.round(after), ms: artists.get(name).ms });
    }
  }
  for (const [key, through] of trackThrough) {
    const t = tracks.get(key);
    if (!t) continue;
    const before = trackBefore.get(key) || 0;
    const crossed = TRACK_MILESTONES.filter((m) => before < m && through >= m);
    if (crossed.length) {
      milestones.push({ kind: "track", name: t.name, artist: t.artist, uri: t.uri, value: crossed[crossed.length - 1], unit: "plays", total: through, ms: t.ms });
    }
  }
  const totalCrossed = TOTAL_MILESTONES.filter((m) => totalBefore / 60000 < m && totalThrough / 60000 >= m);
  if (totalCrossed.length) {
    milestones.push({ kind: "total", name: "Total listening", value: totalCrossed[totalCrossed.length - 1], unit: "minutes", total: Math.round(totalThrough / 60000), ms: Infinity });
  }
  milestones.sort((a, b) => b.ms - a.ms);

  const activeDays = [...days.entries()].filter(([, v]) => v >= STREAM_MS).map(([k]) => k);
  const daysDesc = [...days.entries()].sort((a, b) => b[1] - a[1]);
  const topDayEntry = daysDesc[0] || null;
  const calendarDays = Math.max(1, Math.floor((end - startOfDay(start)) / DAY) + 1);
  const biggestDays = daysDesc.slice(0, 10).map(([k, v]) => {
    let best = null;
    for (const [tk, tms] of dayTracks.get(k)) if (!best || tms > best.ms) best = { key: tk, ms: tms };
    const tr = best ? tracks.get(best.key) : null;
    return {
      date: k,
      minutes: Math.round(v / 60000),
      plays: dayPlays.get(k) || 0,
      topTrack: tr ? { name: tr.name, artist: tr.artist, uri: tr.uri, minutes: Math.round(best.ms / 60000) } : null,
    };
  });
  const allTracks = [...tracks.values()].sort((a, b) => b.ms - a.ms);
  const peakHour = hours.indexOf(Math.max(...hours));
  const peakWeekday = weekdays.indexOf(Math.max(...weekdays));
  const monthList = [...months.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, v]) => ({ key, ms: v }));

  // Continuous per-day series for short windows (a month, 4 weeks), including silent days.
  let byDay = null;
  if (end - start <= 62 * DAY) {
    byDay = [];
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    while (cursor.getTime() <= end) {
      const k = dayKey(cursor);
      byDay.push({ key: k, ms: days.get(k) || 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return {
    start,
    end,
    minutes: Math.round(ms / 60000),
    hours: Math.round(ms / 3600000),
    streams,
    skips,
    skipRate: streams ? skips / (streams + skips) : 0,
    podcastMinutes: Math.round(podcastMs / 60000),
    podcastStreams,
    artistCount: artists.size,
    trackCount: tracks.size,
    albumCount: albums.size,
    topArtists: sortedTop(artists, 50),
    topTracks: allTracks.slice(0, 50),
    allTracks,
    topAlbums: sortedTop(albums, 20),
    discoveries,
    discoveryCount: discoveries.length,
    milestones,
    activeDays: activeDays.length,
    calendarDays,
    avgPerDay: Math.round(ms / 60000 / calendarDays),
    biggestDays,
    dayTotals: days,
    streak: streaks(activeDays),
    topDay: topDayEntry ? { date: topDayEntry[0], minutes: Math.round(topDayEntry[1] / 60000) } : null,
    byHour: hours,
    byWeekday: weekdays,
    byMonth: monthList,
    byDay,
    peakHour,
    peakWeekday,
    avgPerActiveDay: activeDays.length ? Math.round(ms / 60000 / activeDays.length) : 0,
  };
}

export function listenerType(peakHour) {
  if (peakHour < 5) return { title: "Night owl", blurb: "Your listening peaks after midnight." };
  if (peakHour < 9) return { title: "Early bird", blurb: "Mornings are when the music starts." };
  if (peakHour < 12) return { title: "Morning mover", blurb: "Late mornings are your soundtrack hours." };
  if (peakHour < 17) return { title: "Daytime devotee", blurb: "You listen most in the middle of the day." };
  if (peakHour < 21) return { title: "Evening regular", blurb: "After work is when you turn it up." };
  return { title: "Late-night listener", blurb: "The night is yours." };
}

// ---------------------------------------------------------------------------
// Tempo

export const TEMPO_BUCKETS = Array.from({ length: 14 }, (_, i) => 60 + i * 10); // 60..190, each 10 BPM wide

/**
 * entries: [{ id, name, artist, image, weight, plays, tempo? }]
 * totalWeight: the whole period's weight (ms or rank points) so coverage reflects all listening.
 */
export function tempoSummary(entries, { minPlays = 1, totalWeight } = {}) {
  const matched = entries.filter((e) => e.tempo > 0);
  const weightOf = (list) => list.reduce((sum, e) => sum + (e.weight || 0), 0);
  const matchedWeight = weightOf(matched);
  const total = totalWeight || weightOf(entries);
  if (!matched.length) return { avg: null, matchedCount: 0, total: entries.length, coverage: 0, histogram: [], fastest: null, slowest: null };

  const avg = matched.reduce((sum, e) => sum + e.tempo * (e.weight || 0), 0) / (matchedWeight || 1);
  let eligible = matched.filter((e) => e.plays >= minPlays);
  if (eligible.length < 2) eligible = matched;
  const fastest = eligible.reduce((a, b) => (b.tempo > a.tempo ? b : a));
  const slowest = eligible.reduce((a, b) => (b.tempo < a.tempo ? b : a));

  const histogram = TEMPO_BUCKETS.map((from) => ({ from, to: from + 10, weight: 0, count: 0 }));
  for (const e of matched) {
    const idx = Math.min(histogram.length - 1, Math.max(0, Math.floor((e.tempo - 60) / 10)));
    histogram[idx].weight += e.weight || 0;
    histogram[idx].count++;
  }
  return {
    avg,
    matchedCount: matched.length,
    total: entries.length,
    coverage: total ? matchedWeight / total : 0,
    histogram,
    fastest,
    slowest,
  };
}

// Play-weighted average tempo per calendar month inside the window.
export function monthlyTempo(records, tempos, { start, end }) {
  const acc = new Map();
  for (const rec of records) {
    if (rec.t > end) break;
    if (rec.t < start || rec.type !== "music" || !rec.uri) continue;
    const bpm = tempos.get(rec.uri.slice(14));
    if (!bpm) continue;
    const d = new Date(rec.t);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const a = acc.get(key) || [0, 0];
    a[0] += bpm * rec.ms;
    a[1] += rec.ms;
    acc.set(key, a);
  }
  return [...acc.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, [sum, w]]) => ({ key, bpm: sum / w }));
}

// Weighted genre tally from decorated artists ({genres, ms}).
export function genreBreakdown(artists, limit = 8) {
  const tally = new Map();
  let total = 0;
  for (const a of artists) {
    const weight = a.ms || 1;
    for (const g of a.genres || []) {
      tally.set(g, (tally.get(g) || 0) + weight);
      total += weight;
    }
  }
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, weight]) => ({ name, share: total ? weight / total : 0 }));
}
