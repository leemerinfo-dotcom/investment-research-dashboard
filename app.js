let DATA = null;
let selectedDoc = null;

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html !== undefined) n.innerHTML = html; return n; };

function md(text) {
  if (!text) return "";
  const html = window.marked ? marked.parse(text, { mangle: false, headerIds: false }) : text.replace(/\n/g, "<br>");
  return window.DOMPurify ? DOMPurify.sanitize(html) : html;
}

function fmtDate(s) {
  if (!s) return "";
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

async function load() {
  if (window.__SITE_DATA__) {
    DATA = window.__SITE_DATA__;
  } else {
    const res = await fetch("data/site-data.json", { cache: "no-store" });
    DATA = await res.json();
  }
  selectedDoc = DATA.latestCioNote || DATA.docs[0];
  renderShell();
  renderOverview();
  renderScorecard();
  renderAlerts();
  renderFiles();
}

function renderShell() {
  $("#generated").textContent = `Generated ${fmtDate(DATA.meta.generatedAt)} · ${DATA.meta.publicSafety}`;
  document.querySelectorAll(".nav button").forEach(btn => {
    btn.onclick = () => switchView(btn.dataset.view);
  });
  $("#search").addEventListener("input", renderFileList);
  $("#copyLink").onclick = async () => {
    await navigator.clipboard.writeText(location.href);
    $("#copyLink").textContent = "Copied";
    setTimeout(() => $("#copyLink").textContent = "Copy dashboard link", 1200);
  };
  renderFileList();
}

function switchView(view) {
  document.querySelectorAll(".nav button").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === view));
}

function renderFileList() {
  const q = $("#search").value.toLowerCase().trim();
  const list = $("#fileList");
  list.innerHTML = "";
  DATA.docs.filter(d => !q || [d.title,d.category,d.source,d.summary,d.content].join(" ").toLowerCase().includes(q)).slice(0, 60).forEach(d => {
    const item = el("div", "file-item", `<strong>${d.title}</strong><span>${d.category} · ${d.source}</span>`);
    item.onclick = () => { selectedDoc = d; renderFiles(); switchView("files"); };
    list.appendChild(item);
  });
}

function renderOverview() {
  const root = $("#overview");
  root.innerHTML = "";
  const stats = el("div", "grid cols-4");
  [
    ["Scorecard names", DATA.stats.scorecardNames],
    ["Watchlist names", DATA.stats.watchlistNames],
    ["Research docs", DATA.stats.docs],
    ["Recent alerts", DATA.stats.alerts],
  ].forEach(([label, val]) => stats.appendChild(el("div", "card", `<div class="stat">${val}</div><div class="muted">${label}</div>`)));
  root.appendChild(stats);

  const main = el("div", "grid cols-2");
  const note = DATA.latestCioNote;
  main.appendChild(el("article", "card markdown", `<h3>Latest CIO Note</h3>${md(note ? note.content : "No CIO note yet.")}`));
  main.appendChild(el("article", "card", `<h3>Focus Universe</h3><div class="pill-row">${(DATA.focus || []).map(f => `<span class="pill">${f}</span>`).join("")}</div>`));
  root.appendChild(main);
}

function renderScorecard() {
  const root = $("#scorecard");
  const rows = DATA.scorecard || [];
  root.innerHTML = `<div class="card"><h3>Active Sleeve Scorecard</h3><table class="score-table"><thead><tr><th>Name</th><th>Theme</th><th>Stance</th><th>Add only if</th><th>Risk-reduce if</th><th>Next check</th></tr></thead><tbody>${rows.map(r => `<tr><td><strong>${r.Name || ""}</strong></td><td>${r.Theme || ""}</td><td>${r["Current desk stance"] || ""}</td><td>${r["Add only if"] || ""}</td><td>${r["Risk-reduce / avoid if"] || ""}</td><td>${r["Next catalyst/check"] || ""}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderAlerts() {
  const root = $("#alerts");
  root.innerHTML = "";
  const grid = el("div", "grid");
  (DATA.latestAlerts || []).forEach(a => {
    const maxLevel = Math.max(0, ...a.levels.map(x => x.level));
    grid.appendChild(el("article", `card alert level-${maxLevel} markdown`, md(a.content)));
  });
  if (!DATA.latestAlerts.length) grid.appendChild(el("div", "card muted", "No recent alerts."));
  root.appendChild(grid);
}

function renderFiles() {
  const root = $("#files");
  if (!selectedDoc) selectedDoc = DATA.docs[0];
  const grouped = DATA.docs.reduce((acc, d) => { (acc[d.category] ||= []).push(d); return acc; }, {});
  root.innerHTML = `<div class="grid cols-2"><div class="card"><h3>Document Library</h3>${Object.entries(grouped).map(([cat, docs]) => `<h4>${cat}</h4><div class="pill-row">${docs.map(d => `<button class="doc-picker" data-doc="${d.id}">${d.title}</button>`).join("")}</div>`).join("")}</div><article class="card markdown"><div class="doc-header"><div><h3>${selectedDoc.title}</h3><div class="doc-meta">${selectedDoc.category} · ${selectedDoc.source} · ${fmtDate(selectedDoc.updated)}</div></div></div>${md(selectedDoc.content)}</article></div>`;
  root.querySelectorAll(".doc-picker").forEach(btn => btn.onclick = () => { selectedDoc = DATA.docs.find(d => d.id === btn.dataset.doc); renderFiles(); });
}

load().catch(err => {
  document.body.innerHTML = `<pre style="color:white;padding:24px">Dashboard failed to load: ${err.stack || err}</pre>`;
});
