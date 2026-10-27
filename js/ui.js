// Small rendering helpers shared by the views. Everything returns HTML strings.
import { dayKey } from "./stats.js";

export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const fmt = (n) => new Intl.NumberFormat().format(Math.round(n || 0));

export function fmtMinutes(min) {
  if (min < 60) return `${fmt(min)} min`;
  const h = min / 60;
  return h < 100 ? `${h.toFixed(1)} h` : `${fmt(h)} h`;
}

export const fmtDate = (t, opts = { day: "numeric", month: "short", year: "numeric" }) =>
  new Date(t).toLocaleDateString(undefined, opts);

export const monthLabel = (key) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
};

export const monthName = (key) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
};

export const WEEKDAYS =["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const hourLabel = (h) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;

export const initials = (name) =>
  String(name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

export function art(src, name, cls = "art", round = false) {
  if (src) {
    return `<img class="${cls}${round ? " round" : ""}" src="${esc(src)}" alt="" loading="lazy" crossorigin="anonymous" />`;
  }
  return `<div class="${cls} placeholder${round ? " round" : ""}">${esc(initials(name))}</div>`;
}

// Option names deliberately avoid Object.prototype members such as valueOf.
export function artistGrid(items, { limit = 10, valueText } = {}) {
  if (!items?.length) return `<p class="empty">Nothing here yet.</p>`;
  return `<ol class="artist-grid">${items
    .slice(0, limit)
    .map(
      (a, i) => `
      <li>
        ${art(a.image, a.name, "art")}
        <div class="rank">#${i + 1}</div>
        <div class="name" title="${esc(a.name)}">${esc(a.name)}</div>
        ${valueText ? `<div class="meta">${esc(valueText(a))}</div>` : a.genres?.length ? `<div class="meta">${esc(a.genres[0])}</div>` : ""}
      </li>`,
    )
    .join("")}</ol>`;
}

export function trackList(items, { limit = 10, valueText, round = false, subText } = {}) {
  if (!items?.length) return `<p class="empty">Nothing here yet.</p>`;
  return `<ol class="track-list">${items
    .slice(0, limit)
    .map(
      (t, i) => `
      <li>
        <span class="rank">${i + 1}</span>
        ${art(t.image, t.name, "art", round)}
        <div class="text">
          <div class="name" title="${esc(t.name)}">${esc(t.name)}</div>
          <div class="meta">${esc(subText ? subText(t) : t.artist || "")}</div>
        </div>
        <span class="value">${valueText ? esc(valueText(t)) : ""}</span>
      </li>`,
    )
    .join("")}</ol>`;
}

export function genreBars(genres) {
  if (!genres?.length) return `<p class="empty">Spotify's API no longer returns genre tags for most artists, so there is nothing to show here.</p>`;
  const max = genres[0].share || 1;
  return `<div class="bars">${genres
    .map(
      (g) => `
      <div class="bar-row">
        <span>${esc(g.name)}</span>
        <span class="pct">${Math.round(g.share * 100)}%</span>
        <div class="track"><div class="fill" style="width:${Math.max(4, (g.share / max) * 100)}%"></div></div>
      </div>`,
    )
    .join("")}</div>`;
}

export function columns(values, { labels, tip, peak }) {
  const max = Math.max(...values, 1);
  return `<div class="columns">${values
    .map(
      (v, i) =>
        `<div class="col${i === peak ? " peak" : ""}" data-tip="${esc(tip(i, v))}"><i style="height:${Math.max(2, (v / max) * 100)}%"></i></div>`,
    )
    .join("")}</div>
    ${labels ? `<div class="axis">${labels.map((l) => `<span>${esc(l)}</span>`).join("")}</div>` : ""}`;
}

// GitHub-style calendar heatmap, one grid per calendar year touched by the window.
export function heatmap(dayTotals, start, end) {
  const startDay = new Date(start);
  startDay.setHours(0, 0, 0, 0);
  const values = [...dayTotals.values()].filter((v) => v > 0).sort((a, b) => a - b);
  if (!values.length) return `<p class="empty">No listening in this period.</p>`;
  const p90 = values[Math.min(values.length - 1, Math.floor(values.length * 0.9))] || 1;
  const level = (ms) => (ms <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((ms / p90) * 4))));
  const CELL = 11;
  const GAP = 2;
  const years = [];
  for (let y = startDay.getFullYear(); y <= new Date(end).getFullYear(); y++) years.push(y);
  const grids = years.map((y) => {
    const jan1 = new Date(y, 0, 1);
    const offset = jan1.getDay();
    let cells = "";
    for (let i = 0; i < offset; i++) cells += `<i class="pad"></i>`;
    const monthLabels = [];
    let idx = 0;
    for (let d = new Date(jan1); d.getFullYear() === y; d.setDate(d.getDate() + 1), idx++) {
      if (d.getDate() === 1) {
        monthLabels.push(`<span style="left:${Math.floor((offset + idx) / 7) * (CELL + GAP)}px">${MONTHS_SHORT[d.getMonth()]}</span>`);
      }
      const t = d.getTime();
      if (t < startDay.getTime() || t > end) {
        cells += `<i class="out"></i>`;
        continue;
      }
      const ms = dayTotals.get(dayKey(d)) || 0;
      cells += `<i class="l${level(ms)}" data-tip="${esc(fmtDate(t, { weekday: "short", day: "numeric", month: "short" }))} · ${fmt(ms / 60000)} min"></i>`;
    }
    return `<div class="heat-year"><div class="heat-title">${y}</div><div class="heat-months">${monthLabels.join("")}</div><div class="heat-grid">${cells}</div></div>`;
  });
  return `<div class="scroll-x"><div class="heat-wrap">${grids.join("")}</div></div>
    <div class="heat-legend"><span>Less</span><i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>More</span></div>`;
}

// Simple SVG line chart. points: [{ label, value }]
export function lineChart(points, { format = (v) => String(Math.round(v)) } = {}) {
  if (!points || points.length < 2) return `<p class="empty">Not enough months to draw a trend.</p>`;
  const w = 600;
  const h = 140;
  const padX = 10;
  const padY = 14;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i) => padX + (i / (points.length - 1)) * (w - padX * 2);
  const y = (v) => padY + (1 - (v - min) / span) * (h - padY * 2);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const gradId = `lg${Math.random().toString(36).slice(2, 7)}`;
  return `<svg class="line-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Trend">
      <defs><linearGradient id="${gradId}" x1="0" x2="1"><stop offset="0" stop-color="#1db954"/><stop offset="1" stop-color="#ff2d75"/></linearGradient></defs>
      <path d="${path}" fill="none" stroke="url(#${gradId})" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      ${points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4"><title>${esc(p.label)} · ${esc(format(p.value))}</title></circle>`).join("")}
    </svg>
    <div class="axis"><span>${esc(points[0].label)}</span><span>${esc(format(min))} to ${esc(format(max))}</span><span>${esc(points[points.length - 1].label)}</span></div>`;
}

// Table of days: [{ date, minutes, plays, topTrack }]
export function dayTable(days) {
  if (!days?.length) return `<p class="empty">No listening days in this period.</p>`;
  return `<table class="day-table">
    <thead><tr><th>Day</th><th class="num">Minutes</th><th class="num">Plays</th><th>Top song</th></tr></thead>
    <tbody>${days
      .map(
        (d) => `<tr>
        <td>${esc(fmtDate(d.date + "T12:00:00", { weekday: "short", day: "numeric", month: "short", year: "numeric" }))}</td>
        <td class="num">${fmt(d.minutes)}</td>
        <td class="num">${fmt(d.plays)}</td>
        <td class="song">${d.topTrack ? `<b title="${esc(d.topTrack.name)}">${esc(d.topTrack.name)}</b><span>${esc(d.topTrack.artist)} · ${fmt(d.topTrack.minutes)} min</span>` : "–"}</td>
      </tr>`,
      )
      .join("")}</tbody>
  </table>`;
}

// The shareable Sound Capsule card.
export function capsuleCard({ id, theme, eyebrow, title, stat, artist, track, artists, tracks, footer }) {
  return `
  <article class="capsule ${theme}" id="${esc(id)}">
    <div class="eyebrow">${esc(eyebrow)}</div>
    <div class="title">${esc(title)}</div>
    ${stat ? `<div class="big-stat"><div class="n${stat.text ? " text" : ""}">${esc(stat.value)}</div><div class="l">${esc(stat.label)}</div></div>` : ""}
    ${
      artist
        ? `<div class="feature artist">${art(artist.image, artist.name, "")}<div><div class="k">Top artist</div><div class="v">${esc(artist.name)}</div>${artist.sub ? `<div class="s">${esc(artist.sub)}</div>` : ""}</div></div>`
        : ""
    }
    ${
      track
        ? `<div class="feature">${art(track.image, track.name, "")}<div><div class="k">Top song</div><div class="v">${esc(track.name)}</div><div class="s">${esc(track.sub || "")}</div></div></div>`
        : ""
    }
    <div class="lists">
      <div><h4>Top artists</h4><ol>${(artists || []).slice(0, 5).map((a) => `<li>${esc(a)}</li>`).join("")}</ol></div>
      <div><h4>Top songs</h4><ol>${(tracks || []).slice(0, 5).map((t) => `<li>${esc(t)}</li>`).join("")}</ol></div>
    </div>
    <div class="foot"><span>${esc(footer)}</span><span class="pill"></span></div>
  </article>`;
}

let toastTimer;
export function toast(message, { error = false, duration = 3500 } = {}) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), duration);
}
