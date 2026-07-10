let DATA = null;
let selectedDoc = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

const VIEW_META = {
  overview: {
    title: "Executive Office",
    dek: "Actions, risk, active theses, and the evidence that changes the call."
  },
  tape: {
    title: "Market Tape",
    dek: "A compact ledger of public quote snapshots captured when this edition was generated."
  },
  scorecard: {
    title: "Underwriting Scorecard",
    dek: "Stance, add conditions, thesis-breakers, and the next evidence check for every covered name."
  },
  alerts: {
    title: "Market Alerts",
    dek: "Recent trigger reports, ordered newest first and collapsed for rapid severity scanning."
  },
  files: {
    title: "Research Archive",
    dek: "The complete public-safe manuscript: core research, desk outputs, and market alerts."
  }
};

function md(text) {
  if (!text) return "";
  const html = window.marked
    ? marked.parse(text, { mangle: false, headerIds: false })
    : escapeHtml(text).replace(/\n/g, "<br>");
  return window.DOMPurify ? DOMPurify.sanitize(html) : html;
}

function fmtDate(value, options = {}) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, options);
}

function pct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function money(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function quoteColor(quote) {
  return Number(quote.changePct || 0) >= 0 ? "up" : "down";
}

function quoteByTicker(ticker) {
  return (DATA.quotes || []).find(quote => quote.ticker === String(ticker || "").toUpperCase());
}

function sparkline(values, cls = "") {
  if (!values || values.length < 2) {
    return `<svg class="spark ${cls}" viewBox="0 0 120 42" aria-hidden="true"><path d="M0 22 L120 22"/></svg>`;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 120;
    const y = 38 - ((value - min) / span) * 34;
    return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  return `<svg class="spark ${cls}" viewBox="0 0 120 42" preserveAspectRatio="none" aria-hidden="true"><path d="${points}"/></svg>`;
}

function topQuotes(limit = 8) {
  return [...(DATA.quotes || [])]
    .filter(quote => !quote.error && quote.changePct !== null && quote.changePct !== undefined)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, limit);
}

function quoteRow(quote) {
  const color = quoteColor(quote);
  if (quote.error) {
    return `<div class="quote-row"><div class="quote-id"><span class="ticker">${escapeHtml(quote.ticker)}</span><span class="exchange">Unavailable</span></div><div></div><div class="quote-numbers"><span class="price">n/a</span></div></div>`;
  }
  return `<div class="quote-row ${color}" aria-label="${escapeHtml(quote.ticker)} ${money(quote.price)}, ${pct(quote.changePct)}">
    <div class="quote-id"><span class="ticker">${escapeHtml(quote.ticker)}</span><span class="exchange">${escapeHtml(quote.exchange || "Snapshot")}</span></div>
    ${sparkline(quote.sparkline, color)}
    <div class="quote-numbers"><span class="price">${money(quote.price)}</span><span class="change ${color}">${pct(quote.changePct)}</span></div>
  </div>`;
}

function firstSections(text, count = 2) {
  if (!text) return "";
  const sections = text.split(/(?=^##\s)/m).filter(part => part.trim());
  return sections.slice(0, count).join("\n\n");
}

function selectDocument(id) {
  selectedDoc = (DATA.docs || []).find(doc => doc.id === id) || selectedDoc;
  renderFiles();
  switchView("files");
  const search = $("#search");
  search.value = "";
  renderFileList();
}

async function copyEditionLink() {
  const button = $("#copyLink");
  const previous = button.textContent;
  try {
    await navigator.clipboard.writeText(location.href);
    button.textContent = "Link copied";
  } catch {
    button.textContent = "Copy unavailable";
  }
  window.setTimeout(() => { button.textContent = previous; }, 1400);
}

function renderShell() {
  $("#generated").textContent = `Updated ${fmtDate(DATA.meta.generatedAt, { dateStyle: "medium", timeStyle: "short" })}`;
  $("#editionStats").textContent = `${DATA.stats.quotes || 0} quotes · ${DATA.stats.docs || 0} documents · public-safe edition`;
  $$(".nav button").forEach(button => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  $("#search").addEventListener("input", renderFileList);
  $("#search").addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.currentTarget.value = "";
      renderFileList();
      event.currentTarget.blur();
    }
  });
  $("#copyLink").addEventListener("click", copyEditionLink);
  window.addEventListener("hashchange", () => {
    const view = location.hash.slice(1);
    if (VIEW_META[view]) switchView(view, { updateHash: false, scroll: false });
  });
  renderFileList();
}

function switchView(view, { updateHash = true, scroll = true } = {}) {
  if (!VIEW_META[view]) view = "overview";
  $$(".nav button").forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  $$(".view").forEach(section => section.classList.toggle("active", section.id === view));
  $("#pageTitle").textContent = VIEW_META[view].title;
  $("#pageDek").textContent = VIEW_META[view].dek;
  document.title = `${VIEW_META[view].title} — Hermes Personal Investment Office`;
  if (updateHash && location.hash !== `#${view}`) history.pushState(null, "", `#${view}`);
  if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderFileList() {
  const query = $("#search").value.toLowerCase().trim();
  const list = $("#fileList");
  const matches = (DATA.docs || []).filter(doc => {
    if (!query) return true;
    return [doc.title, doc.category, doc.source, doc.summary, doc.content].join(" ").toLowerCase().includes(query);
  }).slice(0, 60);

  list.innerHTML = matches.length
    ? matches.map(doc => `<button type="button" class="file-item" data-doc="${escapeHtml(doc.id)}"><strong>${escapeHtml(doc.title)}</strong><span>${escapeHtml(doc.category)} · ${escapeHtml(doc.source)}</span></button>`).join("")
    : `<div class="search-empty">No research matches “${escapeHtml(query)}”.</div>`;
  list.classList.toggle("is-open", Boolean(query));
  $$(".file-item", list).forEach(button => button.addEventListener("click", () => selectDocument(button.dataset.doc)));
}

function renderOverview() {
  const root = $("#overview");
  const note = DATA.latestCioNote;
  const metrics = [
    ["Coverage", DATA.stats.scorecardNames],
    ["Watchlist", DATA.stats.watchlistNames],
    ["Active theses", DATA.stats.activeTheses],
    ["Alerts", DATA.stats.alerts],
    ["Sources", DATA.stats.sourceEntries]
  ];

  root.innerHTML = `
    <section class="desk-pulse" aria-labelledby="pulseTitle">
      <div class="section-header">
        <div><p class="section-kicker">At a glance</p><h3 id="pulseTitle">Desk pulse</h3></div>
        <p class="section-meta">Coverage breadth, not portfolio sizing</p>
      </div>
      <div class="metric-strip">
        ${metrics.map(([label, value]) => `<div class="metric"><span class="metric-value">${value ?? "—"}</span><span class="metric-label">${escapeHtml(label)}</span></div>`).join("")}
      </div>
    </section>

    <div class="overview-layout">
      <article class="paper-section briefing">
        <div class="section-header">
          <div><p class="section-kicker">Morning manuscript</p><h3>Latest CIO note</h3></div>
          <p class="briefing-stamp">${note ? `${escapeHtml(note.source)}<br>${fmtDate(note.updated, { dateStyle: "medium", timeStyle: "short" })}` : "Awaiting next edition"}</p>
        </div>
        <div class="markdown-body">${md(note ? firstSections(note.content, 1) : "No CIO note yet.")}</div>
        ${note ? `<button type="button" id="openCio" class="text-button">Continue reading in archive →</button>` : ""}
      </article>

      <aside class="paper-section market-section" aria-labelledby="moversTitle">
        <div class="section-header">
          <div><p class="section-kicker">Absolute move</p><h3 id="moversTitle">Largest moves</h3></div>
        </div>
        <div class="mover-list">${topQuotes(6).map(quoteRow).join("")}</div>
        <button type="button" id="openTape" class="text-button">View full market tape →</button>
      </aside>
    </div>`;

  if (note) $("#openCio").addEventListener("click", () => selectDocument(note.id));
  $("#openTape").addEventListener("click", () => switchView("tape"));
}

function renderTape() {
  const root = $("#tape");
  const quotes = [...(DATA.quotes || [])].sort((a, b) => (a.ticker || "").localeCompare(b.ticker || ""));
  root.innerHTML = `
    <section class="paper-section">
      <div class="section-header">
        <div><p class="section-kicker">Static quote ledger</p><h3>Covered market tape</h3></div>
        <p class="section-meta">Prices are snapshots, not a live execution feed</p>
      </div>
      <p class="market-intro">Sorted alphabetically for lookup. Green and red indicate change versus the captured previous close.</p>
      <div class="table-wrap">
        <table class="market-table">
          <thead><tr><th>Ticker</th><th>Venue</th><th>Five-day trace</th><th class="numeric">Price</th><th class="numeric">Change</th><th>Captured</th></tr></thead>
          <tbody>${quotes.map(quote => {
            const color = quoteColor(quote);
            return `<tr class="${color}">
              <td><span class="ticker">${escapeHtml(quote.ticker)}</span></td>
              <td><span class="exchange">${escapeHtml(quote.exchange || "—")}</span></td>
              <td>${sparkline(quote.sparkline, color)}</td>
              <td class="numeric">${quote.error ? "n/a" : money(quote.price)}</td>
              <td class="numeric"><span class="change ${color}">${quote.error ? "—" : pct(quote.changePct)}</span></td>
              <td><span class="quote-time">${quote.quoteTime ? fmtDate(quote.quoteTime, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "snapshot"}</span></td>
            </tr>`;
          }).join("")}</tbody>
        </table>
      </div>
    </section>`;
}

function renderScorecard() {
  const root = $("#scorecard");
  const rows = DATA.scorecard || [];
  if (!rows.length) {
    root.innerHTML = `<div class="empty-state">No active scorecard entries in this edition.</div>`;
    return;
  }
  root.innerHTML = `
    <div class="section-header">
      <div><p class="section-kicker">Conditional underwriting</p><h3>${rows.length} covered names</h3></div>
      <p class="section-meta">Open a name to inspect add conditions and thesis-breakers</p>
    </div>
    <div class="score-grid">${rows.map(row => {
      const quote = quoteByTicker(row.Name);
      const color = quote ? quoteColor(quote) : "";
      return `<details class="score-entry ${color}">
        <summary>
          <span class="score-summary">
            <span class="score-name">${escapeHtml(row.Name || "—")}</span>
            <span class="score-theme">${escapeHtml(row.Theme || "")}</span>
            <span class="score-quote">${quote ? `<span class="price">${money(quote.price)}</span><span class="change ${color}">${pct(quote.changePct)}</span>` : ""}</span>
            <span class="score-stance">${escapeHtml(row["Current desk stance"] || "")}</span>
          </span>
        </summary>
        <div class="score-detail">
          ${quote ? sparkline(quote.sparkline, color) : ""}
          <dl class="condition-grid">
            <div><dt>Add only if</dt><dd>${escapeHtml(row["Add only if"] || "—")}</dd></div>
            <div><dt>Risk-reduce / avoid if</dt><dd>${escapeHtml(row["Risk-reduce / avoid if"] || "—")}</dd></div>
            <div><dt>Next catalyst / check</dt><dd>${escapeHtml(row["Next catalyst/check"] || "—")}</dd></div>
            <div><dt>Evidence quality</dt><dd>${escapeHtml(row["Evidence quality"] || "—")}</dd></div>
          </dl>
        </div>
      </details>`;
    }).join("")}</div>`;
}

function alertDate(alert) {
  const match = String(alert.file || alert.title || "").match(/(\d{4})-(\d{2})-(\d{2})[ _](\d{2})-(\d{2})-(\d{2})/);
  if (!match) return alert.file || "Recent report";
  return fmtDate(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`, { dateStyle: "medium", timeStyle: "short" });
}

function renderAlerts() {
  const root = $("#alerts");
  const alerts = DATA.latestAlerts || [];
  if (!alerts.length) {
    root.innerHTML = `<div class="empty-state">No recent market alerts.</div>`;
    return;
  }
  root.innerHTML = `
    <div class="section-header">
      <div><p class="section-kicker">Trigger reports</p><h3>${alerts.length} recent alerts</h3></div>
      <p class="section-meta">Severity is the highest level recorded inside each report</p>
    </div>
    <div class="alert-list">${alerts.map(alert => {
      const maxLevel = Math.max(0, ...(alert.levels || []).map(item => item.level));
      const firstTitle = (alert.levels || [])[0]?.title || "Market trigger report";
      return `<details class="alert-entry level-${maxLevel}">
        <summary>
          <span class="alert-heading">
            <span><span class="alert-title">${escapeHtml(firstTitle)}</span><span class="alert-date">${escapeHtml(alertDate(alert))}</span></span>
            <span class="level-badge">Level ${maxLevel || "—"}</span>
          </span>
        </summary>
        <div class="alert-detail markdown-body">${md(alert.content)}</div>
      </details>`;
    }).join("")}</div>`;
}

function renderFiles() {
  const root = $("#files");
  const docs = DATA.docs || [];
  if (!docs.length) {
    root.innerHTML = `<div class="empty-state">No public research documents in this edition.</div>`;
    return;
  }
  if (!selectedDoc) selectedDoc = docs[0];
  const grouped = docs.reduce((groups, doc) => {
    (groups[doc.category] ||= []).push(doc);
    return groups;
  }, {});

  root.innerHTML = `<div class="files-layout">
    <aside class="document-index" aria-label="Document index">
      <p class="section-kicker">Document index</p>
      <h3>${docs.length} manuscripts</h3>
      ${Object.entries(grouped).map(([category, categoryDocs]) => `<section class="document-group">
        <h4>${escapeHtml(category)}</h4>
        <div class="document-list">${categoryDocs.map(doc => `<button type="button" class="doc-picker ${doc.id === selectedDoc.id ? "active" : ""}" data-doc="${escapeHtml(doc.id)}">${escapeHtml(doc.title)}</button>`).join("")}</div>
      </section>`).join("")}
    </aside>
    <article class="document-paper">
      <header class="doc-header">
        <p class="section-kicker">${escapeHtml(selectedDoc.category)}</p>
        <h3>${escapeHtml(selectedDoc.title)}</h3>
        <div class="doc-meta">${escapeHtml(selectedDoc.source)} · updated ${fmtDate(selectedDoc.updated, { dateStyle: "medium", timeStyle: "short" })}</div>
      </header>
      <div class="markdown-body">${md(selectedDoc.content)}</div>
    </article>
  </div>`;

  $$(".doc-picker", root).forEach(button => button.addEventListener("click", () => {
    selectedDoc = docs.find(doc => doc.id === button.dataset.doc) || selectedDoc;
    renderFiles();
    $("#files").scrollIntoView({ block: "start" });
  }));
}

async function load() {
  if (window.__SITE_DATA__) {
    DATA = window.__SITE_DATA__;
  } else {
    const response = await fetch("data/site-data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Data request failed with ${response.status}`);
    DATA = await response.json();
  }
  selectedDoc = DATA.latestCioNote || (DATA.docs || [])[0] || null;
  renderShell();
  renderOverview();
  renderTape();
  renderScorecard();
  renderAlerts();
  renderFiles();
  const requestedView = location.hash.slice(1);
  switchView(VIEW_META[requestedView] ? requestedView : "overview", { updateHash: false, scroll: false });
}

load().catch(error => {
  document.body.innerHTML = `<main style="max-width:760px;margin:48px auto;padding:24px;font-family:Times New Roman,serif;color:#18150f"><h1>Dashboard failed to load</h1><pre style="white-space:pre-wrap">${escapeHtml(error.stack || error)}</pre></main>`;
});
