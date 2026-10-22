// Small rendering helpers shared by the views. Everything returns HTML strings.

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
  if (!genres?.length) return `<p class="empty">No genre data for these artists.</p>`;
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

// The shareable Sound Capsule card.
export function capsuleCard({ id, theme, eyebrow, title, stat, artist, track, artists, tracks, footer }) {
  return `
  <article class="capsule ${theme}" id="${esc(id)}">
    <div class="eyebrow">${esc(eyebrow)}</div>
    <div class="title">${esc(title)}</div>
    ${stat ? `<div class="big-stat"><div class="n">${esc(stat.value)}</div><div class="l">${esc(stat.label)}</div></div>` : ""}
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
