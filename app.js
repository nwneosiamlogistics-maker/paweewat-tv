/* Paweewat TV — เว็บดูทีวีออนไลน์ (ข้อมูลจาก data/*.json ที่สร้างด้วย tools/build_web.py) */
"use strict";

const PAGE = 300;                       // จำนวนช่องที่แสดงต่อครั้ง
const $ = (id) => document.getElementById(id);
const state = {
  channels: [], countries: {}, genres: {}, sports: null, events: [], official: [],
  shown: PAGE, current: null, hls: null, favs: loadFavs(),
};

/* ---------- ที่เก็บในเบราว์เซอร์ (อาจใช้ไม่ได้ในบางโหมด) ---------- */
function loadFavs() {
  try { return new Set(JSON.parse(localStorage.getItem("pw-favs") || "[]")); } catch { return new Set(); }
}
function saveFavs() {
  try { localStorage.setItem("pw-favs", JSON.stringify([...state.favs])); } catch { /* ไม่เป็นไร */ }
}
function remember(key, value) { try { localStorage.setItem(key, value); } catch { /* ไม่เป็นไร */ } }
function recall(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }

const chKey = (c) => c.id || c.u;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const countryName = (code) => state.countries[code] || code || "-";
const genreName = (g) => state.genres[g] || g || "ทั่วไป";
const genresOf = (c) => (c.gs && c.gs.length ? c.gs : (c.g ? [c.g] : []));
const onWeb = (c) => !c.x;                       // เล่นในเบราว์เซอร์ได้
const REASON = {
  http: "ลิงก์ของช่องนี้เป็น http เบราว์เซอร์จึงไม่ยอมเล่นบนเว็บที่เป็น https",
  cors: "เซิร์ฟเวอร์ของช่องนี้ไม่อนุญาตให้เว็บอื่นเล่น",
  ua: "ช่องนี้ต้องส่งข้อมูลพิเศษที่เบราว์เซอร์ส่งเองไม่ได้",
};

async function loadJSON(name) {
  const res = await fetch(`data/${name}?v=${Date.now() / 3.6e6 | 0}`);   // แคชไม่เกิน 1 ชม.
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.json();
}

/* ---------- เริ่มต้น ---------- */
async function init() {
  const [ch, sp, ev, of] = await Promise.allSettled(
    ["channels.json", "sports.json", "events.json", "official.json"].map(loadJSON));
  if (ch.status === "fulfilled") {
    Object.assign(state, { channels: ch.value.channels, countries: ch.value.countries, genres: ch.value.genres });
    const web = ch.value.channels.filter(onWeb).length;
    $("updated").textContent = `อัปเดตรายชื่อช่องล่าสุด: ${ch.value.generated} น. · ${ch.value.channels.length} ช่องที่ใช้ได้ (ดูบนเว็บได้ ${web} ช่อง)`;
  } else {
    $("player-msg").textContent = "โหลดรายชื่อช่องไม่สำเร็จ กรุณารีเฟรชหน้าเว็บ";
  }
  if (sp.status === "fulfilled") state.sports = sp.value;
  if (ev.status === "fulfilled") state.events = ev.value.events;
  if (of.status === "fulfilled") state.official = of.value.official;

  setupFilters();
  renderChannels();
  renderSports();
  renderEvents();
  renderOfficial();
  renderAlert();
  window.addEventListener("hashchange", route);
  route();
  const deep = new URLSearchParams(location.hash.split("?")[1] || "").get("ch");
  if (deep) { const c = state.channels.find((x) => chKey(x) === deep); if (c) play(c); }
}

function route() {
  const view = (location.hash.replace("#", "").split("?")[0]) || "tv";
  for (const v of ["tv", "sports", "events", "official"]) $(`view-${v}`).hidden = v !== view;
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
}

/* ---------- ตัวกรองช่อง ---------- */
function setupFilters() {
  const counts = {};
  for (const c of state.channels) counts[c.c] = (counts[c.c] || 0) + 1;
  const codes = Object.keys(counts).sort((a, b) => (a !== "TH") - (b !== "TH") || counts[b] - counts[a]);
  $("country").innerHTML = `<option value="">ทุกประเทศ (${state.channels.length})</option>` +
    codes.map((c) => `<option value="${esc(c)}">${esc(countryName(c))} (${counts[c]})</option>`).join("");
  $("country").value = recall("pw-country", counts.TH ? "TH" : "");
  $("genre").innerHTML = `<option value="">ทุกหมวดหมู่</option>` + Object.entries(state.genres)
    .sort((a, b) => a[1].localeCompare(b[1], "th"))
    .map(([g, label]) => `<option value="${esc(g)}">${esc(label)}</option>`).join("");
  const reset = () => { state.shown = PAGE; renderChannels(); };
  $("q").addEventListener("input", reset);
  $("country").addEventListener("change", () => { remember("pw-country", $("country").value); reset(); });
  $("genre").addEventListener("change", reset);
  $("fav-only").addEventListener("change", reset);
  $("web-only").addEventListener("change", reset);
  $("btn-m3u-list").addEventListener("click", () => downloadM3U(filtered(), "paweewat-tv.m3u"));
  $("btn-m3u-one").addEventListener("click", () => state.current && downloadM3U([state.current], "channel.m3u"));
  $("btn-copy").addEventListener("click", copyLink);
  $("more").addEventListener("click", () => { state.shown += PAGE; renderChannels(); });
  $("btn-random").addEventListener("click", playRandom);
  $("btn-fav").addEventListener("click", toggleFav);
}

function filtered() {
  const q = $("q").value.trim().toLowerCase();
  const country = $("country").value, genre = $("genre").value;
  const favOnly = $("fav-only").checked, webOnly = $("web-only").checked;
  return state.channels.filter((c) =>
    (!country || c.c === country) && (!genre || genresOf(c).includes(genre)) &&
    (!favOnly || state.favs.has(chKey(c))) && (!webOnly || onWeb(c)) &&
    (!q || c.n.toLowerCase().includes(q) || genresOf(c).some((g) => genreName(g).toLowerCase().includes(q))));
}

function renderChannels() {
  const list = filtered();
  list.sort((a, b) => state.favs.has(chKey(b)) - state.favs.has(chKey(a)) || onWeb(b) - onWeb(a));
  $("count").textContent = `แสดง ${Math.min(list.length, state.shown)} จาก ${list.length} ช่อง` +
    ` (ดูบนเว็บได้ ${list.filter(onWeb).length})`;
  const ul = $("channels");
  ul.innerHTML = list.slice(0, state.shown).map((c, i) => {
    const initials = esc(c.n.replace(/\(.*?\)|\[.*?\]/g, "").trim().slice(0, 3));
    const logo = c.l ? `<img src="${esc(c.l)}" alt="" loading="lazy" onerror="this.replaceWith('${initials}')">` : initials;
    const fav = state.favs.has(chKey(c)) ? `<span class="star">★</span> ` : "";
    const playing = state.current && chKey(state.current) === chKey(c) ? " playing" : "";
    const tag = onWeb(c) ? "" : `<span class="tag">ในแอป</span>`;
    return `<li class="${playing}${onWeb(c) ? "" : " app"}" data-i="${i}"><span class="logo">${logo}</span>
      <span class="ch-text"><div class="ch-name">${fav}${esc(c.n)}${tag}</div>
      <div class="ch-meta">${esc(countryName(c.c))} · ${esc(genresOf(c).map(genreName).join(", ") || "ทั่วไป")}</div></span></li>`;
  }).join("") || `<li class="muted">ไม่พบช่องที่ตรงกับตัวกรอง</li>`;
  const shown = list.slice(0, state.shown);
  ul.querySelectorAll("li[data-i]").forEach((li) => li.addEventListener("click", () => play(shown[+li.dataset.i])));
  $("more").hidden = list.length <= state.shown;
}

/* ---------- ตัวเล่น ---------- */
function play(c) {
  const video = $("video"), msg = $("player-msg");
  state.current = c;
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  msg.hidden = false;
  msg.textContent = "กำลังเปิดช่อง...";
  $("now-name").textContent = c.n;
  $("now-meta").textContent = `${countryName(c.c)} · ${genresOf(c).map(genreName).join(", ") || "ทั่วไป"}`;
  $("btn-fav").hidden = false;
  updateFavButton();
  history.replaceState(null, "", `#tv?ch=${encodeURIComponent(chKey(c))}`);
  document.title = `${c.n} — Paweewat TV`;
  $("app-only").hidden = onWeb(c);
  if (!onWeb(c)) {                        // เล่นบนเว็บไม่ได้: บอกเหตุผลและทางเลือก
    video.pause(); video.removeAttribute("src"); video.load();
    msg.hidden = true;
    $("app-only-text").textContent = `${REASON[c.x] || "ช่องนี้เล่นบนเว็บไม่ได้"} เปิดดูด้วยแอปแทนได้`;
    $("btn-vlc").href = vlcLink(c.u);
    renderChannels();
    return;
  }

  const fail = () => { msg.hidden = false; msg.textContent = "ช่องนี้เปิดไม่ได้ในตอนนี้ (สตรีมอาจปิดหรือย้าย) ลองช่องอื่น หรือกด สุ่มช่อง"; };
  video.onplaying = () => { msg.hidden = true; document.title = `▶ ${c.n} — Paweewat TV`; };
  video.onerror = fail;
  if (window.Hls && Hls.isSupported()) {
    const hls = new Hls({ maxBufferLength: 20 });
    state.hls = hls;
    hls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) { hls.destroy(); state.hls = null; fail(); } });
    hls.loadSource(c.u);
    hls.attachMedia(video);
  } else {
    video.src = c.u;                      // Safari/iOS เล่น HLS ได้เอง
  }
  video.play().catch(() => { msg.textContent = "กดปุ่มเล่นที่ตัววิดีโอเพื่อเริ่มดู"; });
  renderChannels();
  if (matchMedia("(max-width: 900px)").matches) window.scrollTo({ top: 0, behavior: "smooth" });
}

function playRandom() {
  const pool = filtered().filter(onWeb);
  if (pool.length) play(pool[Math.floor(Math.random() * pool.length)]);
}

function toggleFav() {
  if (!state.current) return;
  const k = chKey(state.current);
  state.favs.has(k) ? state.favs.delete(k) : state.favs.add(k);
  saveFavs(); updateFavButton(); renderChannels();
}
function updateFavButton() {
  const on = state.current && state.favs.has(chKey(state.current));
  $("btn-fav").textContent = on ? "★ โปรดแล้ว" : "☆ เพิ่มในโปรด";
}

/* ช่องบนเว็บที่ตรงกับชื่อช่องถ่ายทอด (เช่น "Thairath") */
function findChannel(query) {
  if (!query) return null;
  const q = query.toLowerCase();
  return state.channels.find((c) => onWeb(c) && c.n.toLowerCase().includes(q)) || null;
}

/* ---------- เปิดด้วยแอป / ดาวน์โหลดเพลย์ลิสต์ ---------- */
function vlcLink(url) {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) {             // VLC for Android
    const [scheme, rest] = url.split("://");
    return `intent://${rest}#Intent;scheme=${scheme};package=org.videolan.vlc;type=video/*;end`;
  }
  if (/iphone|ipad|ipod|macintosh.*mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /mac/i.test(ua))) {
    return `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(url)}`;   // VLC for iOS/iPadOS
  }
  return `vlc://${url}`;                  // คอมพิวเตอร์ (ถ้ายังเปิดไม่ได้ ให้ใช้ไฟล์ .m3u)
}

function downloadM3U(list, filename) {
  if (!list.length) return;
  const lines = ["#EXTM3U"];
  for (const c of list) {
    const logo = c.l ? ` tvg-logo="${c.l}"` : "";
    lines.push(`#EXTINF:-1 tvg-id="${c.id || ""}"${logo} group-title="${genresOf(c).join(";")}",${c.n}`, c.u);
  }
  const blob = new Blob([lines.join("\n") + "\n"], { type: "audio/x-mpegurl" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function copyLink() {
  if (!state.current) return;
  try { await navigator.clipboard.writeText(state.current.u); $("btn-copy").textContent = "คัดลอกแล้ว"; }
  catch { prompt("คัดลอกลิงก์นี้", state.current.u); }
  setTimeout(() => { $("btn-copy").textContent = "คัดลอกลิงก์"; }, 2000);
}

/* ---------- กีฬาวันนี้ ---------- */
function renderSports() {
  const sp = state.sports;
  if (!sp) { $("sports").innerHTML = `<p class="muted">ยังไม่มีข้อมูลตารางกีฬา</p>`; return; }
  const days = Object.keys(sp.days);
  const dayLabel = (d, i) => `${["วันนี้", "พรุ่งนี้"][i] || d} (${d.split("-").reverse().join("/")})`;
  $("sport-day").innerHTML = days.map((d, i) => `<option value="${d}">${dayLabel(d, i)}</option>`).join("");
  const kinds = [...new Set(Object.values(sp.days).flat().map((e) => e.sport))];
  $("sport-kind").innerHTML = `<option value="">ทุกกีฬา</option><option value="*top">ฟุตบอลลีกชั้นนำ</option>` +
    kinds.map((k) => `<option>${esc(k)}</option>`).join("");
  $("sport-note").textContent = `ช่องในไทยอ้างอิงข่าวสิทธิ์ถ่ายทอด ${sp.rights_checked} · อัปเดต ${sp.generated} น.`;
  for (const id of ["sport-day", "sport-kind", "sport-th"]) $(id).addEventListener("change", drawSports);
  drawSports();
}

function drawSports() {
  const list = state.sports.days[$("sport-day").value] || [];
  const kind = $("sport-kind").value, thOnly = $("sport-th").checked;
  const rows = list.filter((e) => (!thOnly || e.th.length) &&
    (!kind || (kind === "*top" ? e.top && e.sport === "ฟุตบอล" : e.sport === kind)));
  const groups = new Map();
  for (const e of rows.sort((a, b) => (!a.th.length) - (!b.th.length) || (!a.top) - (!b.top))) {
    const key = `${e.sport}: ${e.league}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  if (!groups.size) { $("sports").innerHTML = `<p class="muted">ไม่มีรายการที่ตรงกับตัวกรอง</p>`; return; }
  $("sports").innerHTML = [...groups].map(([league, evs]) => `<div class="league"><h3>${esc(league)}</h3>` +
    evs.sort((a, b) => a.t.localeCompare(b.t)).map((e, i) => {
      const th = e.th.map((w) => {
        const ch = findChannel(w.q);
        return ch ? `<button class="btn primary" data-play="${esc(chKey(ch))}">▶ ${esc(w.label)}</button>`
                  : `<a class="btn" href="${esc(w.url)}" target="_blank" rel="noopener" title="${esc(w.note)}">${esc(w.label)}</a>`;
      }).join("");
      const intl = e.intl.length ? `<details class="intl"><summary>ถ่ายทอดในต่างประเทศ (${e.intl.length})</summary>` +
        e.intl.map((b) => b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener" title="${esc(b.access)}">${esc(b.label)}</a>`
                                : `<span>${esc(b.label)}</span> `).join(" ") + `</details>` : "";
      return `<div class="match"><div class="time">${esc(e.t)}</div>
        <div><div class="title">${esc(e.title)}</div><div class="status${e.live ? " live" : ""}">${esc(e.status)}</div></div>
        <div class="watch">${th || `<span class="muted small">ยังไม่มีข้อมูลช่องในไทย</span>`}</div>${intl}</div>`;
    }).join("") + `</div>`).join("");
  $("sports").querySelectorAll("[data-play]").forEach((b) => b.addEventListener("click", () => {
    const c = state.channels.find((x) => chKey(x) === b.dataset.play);
    if (c) { location.hash = "#tv"; play(c); }
  }));
}

/* ---------- มหกรรมกีฬา ---------- */
function eventStatus(e, today) {
  const start = new Date(e.start), end = new Date(e.end);
  if (today < start) {
    const days = Math.round((start - today) / 864e5);
    return { text: days === 1 ? "เริ่มพรุ่งนี้" : `อีก ${days} วัน`, live: false };
  }
  if (today > end) return { text: "จบแล้ว", live: false };
  const n = Math.round((today - start) / 864e5) + 1, total = Math.round((end - start) / 864e5) + 1;
  return { text: `แข่งวันที่ ${n}/${total}`, live: true };
}
function todayTH() {
  const d = new Date(Date.now() + 7 * 3.6e6);            // วันที่ตามเวลาไทย
  return new Date(d.toISOString().slice(0, 10));
}

function renderEvents() {
  const today = todayTH();
  $("events").innerHTML = state.events.filter((e) => new Date(e.end) >= today).map((e) => {
    const st = eventStatus(e, today);
    const links = [
      ...e.th.map((w) => `<a class="btn primary" href="${esc(w.url)}" target="_blank" rel="noopener">ดูที่ ${esc(w.label)}</a>`),
      e.website ? `<a class="btn" href="${esc(e.website)}" target="_blank" rel="noopener">เว็บไซต์ทางการ</a>` : "",
    ].join("");
    const intl = e.intl.length ? `<details class="intl"><summary>ถ่ายทอดในประเทศอื่น (${e.intl.length})</summary>` +
      e.intl.map((b) => b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.label)}</a>` : esc(b.label)).join(" ") +
      `</details>` : "";
    return `<article class="card"><span class="badge${st.live ? " live" : ""}">${esc(st.text)}</span>
      <h3>${esc(e.name)}</h3><div class="muted small">${esc(e.kind)} · ${esc(e.host)}</div>
      <div>${esc(e.dates)}</div><div class="links">${links}</div>${intl}</article>`;
  }).join("") || `<p class="muted">ยังไม่มีข้อมูล</p>`;
}

function renderAlert() {
  const today = todayTH();
  const live = state.events.filter((e) => eventStatus(e, today).live);
  const soon = state.events.filter((e) => { const d = (new Date(e.start) - today) / 864e5; return d > 0 && d <= 14; });
  const parts = [...live.map((e) => `กำลังแข่ง: ${e.name} (${eventStatus(e, today).text})`),
                 ...soon.map((e) => `${e.name} ${eventStatus(e, today).text}`)];
  if (parts.length) { $("alert").textContent = `มหกรรมกีฬา · ${parts.join(" · ")}`; $("alert").hidden = false; }
}

/* ---------- ช่องทางการ ---------- */
function renderOfficial() {
  $("official").innerHTML = state.official.map((o) =>
    `<a class="btn" href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.label)}</a>`).join("");
}

init().catch((e) => { $("player-msg").textContent = `เกิดข้อผิดพลาด: ${e.message}`; });
