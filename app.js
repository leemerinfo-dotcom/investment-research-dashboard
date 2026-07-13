let DATA = null;
let activeDecisionFilter = "ALL";
let activeReportFilter = "All";
let reportSearch = "";
let selectedReportId = null;
let reportReading = false;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

const VIEW_META = {
  today: ["Executive brief", "Today"],
  decisions: ["Current calls", "Decisions"],
  reports: ["Linked research notes", "Reports"],
  watch: ["Triggers and catalysts", "Watch"]
};

function md(text) {
  if (!text) return "";
  const html = window.marked ? marked.parse(text, { mangle: false, headerIds: false }) : escapeHtml(text).replace(/\n/g, "<br>");
  return window.DOMPurify ? DOMPurify.sanitize(html) : html;
}

function inlineMd(text) {
  if (!text) return "";
  const html = window.marked ? marked.parseInline(text, { mangle: false, headerIds: false }) : escapeHtml(text);
  return window.DOMPurify ? DOMPurify.sanitize(html) : html;
}

function decorateLinks(root = document) {
  $$('a[href^="http"]', root).forEach(link => {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
}

function fmtDate(value, options = {}) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, options);
}

function pct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function money(value, currency = "") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`;
}

function actionClass(action) {
  return String(action || "unknown").toLowerCase().split(/\s|—/)[0].replace(/[^a-z]/g, "");
}

function actionHeadline(action) {
  const normalized = String(action || "NONE").toUpperCase();
  if (normalized.startsWith("NONE")) return "No action today";
  if (normalized.startsWith("BUY")) return "Buy action cleared";
  if (normalized.startsWith("ADD")) return "Add action cleared";
  return normalized.split("—")[0].trim();
}

function quoteFor(ticker) {
  return (DATA.quotes || []).find(quote => quote.ticker === String(ticker || "").toUpperCase());
}

function quoteMarkup(ticker) {
  const quote = quoteFor(ticker);
  if (!quote || quote.error || quote.price === null || quote.price === undefined) return "";
  const direction = Number(quote.changePct || 0) >= 0 ? "up" : "down";
  return `<span class="quote"><strong>${money(quote.price)}</strong><span class="${direction}">${pct(quote.changePct)}</span></span>`;
}

function navButtons() {
  return $$("[data-view]");
}

function currentHash() {
  const parts = location.hash.replace(/^#/, "").split("/").filter(Boolean);
  return { view: VIEW_META[parts[0]] ? parts[0] : "today", detail: parts.slice(1).join("/") || null };
}

function updateHeader(view) {
  const [eyebrow, title] = VIEW_META[view];
  $("#viewEyebrow").textContent = eyebrow;
  $("#viewTitle").textContent = title;
  document.title = `${title} — Gus Investment Office`;
}

function switchView(view, { updateHash = true, scroll = true } = {}) {
  if (!VIEW_META[view]) view = "today";
  navButtons().forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  $$(".view").forEach(section => section.classList.toggle("active", section.id === view));
  updateHeader(view);
  if (updateHash && location.hash !== `#${view}`) history.pushState(null, "", `#${view}`);
  if (view === "reports" && !currentHash().detail && window.innerWidth < 820) {
    reportReading = false;
    renderReports();
  }
  if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
}

function reportById(id) {
  return (DATA.reports || []).find(report => report.id === id);
}

function openReport(id, { updateHash = true } = {}) {
  if (!reportById(id)) return;
  selectedReportId = id;
  reportReading = true;
  renderReports();
  switchView("reports", { updateHash: false });
  if (updateHash) history.pushState(null, "", `#reports/${id}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeReport() {
  reportReading = false;
  history.pushState(null, "", "#reports");
  renderReports();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function shareApp() {
  const shareData = { title: document.title, text: "Gus Investment Office", url: location.href };
  if (navigator.share) {
    navigator.share(shareData).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(location.href).then(() => {
      const button = $("#shareApp");
      const old = button.textContent;
      button.textContent = "Copied";
      setTimeout(() => { button.textContent = old; }, 1200);
    }).catch(() => {});
  }
}

function renderShell() {
  const updated = fmtDate(DATA.meta.generatedAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  $("#mobileUpdated").textContent = `Updated ${updated}`;
  $("#railUpdated").textContent = `Updated ${updated}`;
  $("#railGateLabel").textContent = DATA.portfolio.status;
  $("#railGate").classList.toggle("pass", DATA.portfolio.authoritative);
  navButtons().forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));
  $("#shareApp").addEventListener("click", shareApp);
  window.addEventListener("hashchange", routeFromHash);
}

function priorityDecisionMarkup(decision) {
  const lede = (decision.executive_thesis || [])[0] || "No executive thesis recorded.";
  return `<details class="decision-card ${actionClass(decision.action)}">
    <summary>
      <span class="decision-summary">
        <span class="ticker">${escapeHtml(decision.instrument)}</span>
        <span class="action-badge ${actionClass(decision.action)}">${escapeHtml(decision.action)}</span>
        ${quoteMarkup(decision.instrument)}
        <p class="decision-lede">${escapeHtml(lede)}</p>
      </span>
    </summary>
    ${decisionDetailMarkup(decision)}
  </details>`;
}

function decisionDetailMarkup(decision) {
  const profile = decision.return_profile || {};
  const execution = decision.execution || {};
  const thesis = decision.executive_thesis || [];
  const risks = (decision.risks || []).slice().sort((a, b) => Number(a.rank || 99) - Number(b.rank || 99));
  const relatedReports = (decision.relatedReports || []).map(id => reportById(id)).filter(Boolean);
  const expectedReturn = profile.probability_weighted_expected_return_pct;
  const downside = profile.realistic_downside_pct;
  const ratio = profile.upside_downside_ratio;
  const scenarios = profile.scenarios || [];
  return `<div class="decision-detail">
    <div class="metric-line">
      <div><strong>${escapeHtml(decision.conviction ?? "—")}/10</strong><span>Research conviction</span></div>
      <div><strong>${expectedReturn === null || expectedReturn === undefined ? "—" : pct(expectedReturn)}</strong><span>Weighted return</span></div>
      <div><strong>${downside === null || downside === undefined ? "—" : pct(downside)}</strong><span>Realistic downside</span></div>
      <div><strong>${ratio === null || ratio === undefined ? "—" : `${ratio}:1`}</strong><span>Upside / downside</span></div>
    </div>
    <div class="detail-grid">
      <div class="detail-field"><span class="field-label">Executive thesis</span><ul>${thesis.map(item => `<li>${escapeHtml(item)}</li>`).join("") || "<li>Not established.</li>"}</ul></div>
      <div class="detail-field"><span class="field-label">Execution status</span><p>${escapeHtml(execution.entry_method || "No execution plan cleared.")}</p></div>
      <div class="detail-field"><span class="field-label">Catalyst</span><ul>${(decision.catalysts || []).map(item => `<li><strong>${escapeHtml(item.timing || "Timing open")}</strong> — ${escapeHtml(item.event || "")}</li>`).join("") || "<li>No dated catalyst established.</li>"}</ul></div>
      <div class="detail-field"><span class="field-label">Key risks</span><ul>${risks.map(item => `<li>${escapeHtml(item.risk || "")}</li>`).join("") || "<li>Not established.</li>"}</ul></div>
      <div class="detail-field"><span class="field-label">Add only if</span><ul>${(execution.add_conditions || []).map(item => `<li>${escapeHtml(item)}</li>`).join("") || "<li>No add condition cleared.</li>"}</ul></div>
      <div class="detail-field"><span class="field-label">Invalidation</span><ul>${(decision.invalidation || []).map(item => `<li>${escapeHtml(item)}</li>`).join("") || "<li>Not established.</li>"}</ul></div>
      ${scenarios.length ? `<div class="detail-field"><span class="field-label">Scenario range</span><ul>${scenarios.map(item => `<li><strong>${escapeHtml(item.name || "Scenario")}: ${pct(item.total_return_pct)}</strong> at ${escapeHtml(item.probability_pct)}% probability</li>`).join("")}</ul></div>` : ""}
      ${(decision.open_questions || []).length ? `<div class="detail-field"><span class="field-label">Open questions</span><ul>${decision.open_questions.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
    </div>
    ${(decision.evidenceLinks || []).length ? `<div class="detail-field"><span class="field-label">Primary evidence</span><ul class="source-list">${decision.evidenceLinks.map(link => `<li><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)} ↗</a></li>`).join("")}</ul></div>` : ""}
    ${relatedReports.length ? `<div class="detail-field"><span class="field-label">Related reports</span><div class="related-links">${relatedReports.map(report => `<button type="button" data-report="${escapeHtml(report.id)}">${escapeHtml(report.title)}</button>`).join("")}</div></div>` : ""}
  </div>`;
}

function bindDecisionLinks(root) {
  $$('[data-report]', root).forEach(button => button.addEventListener("click", event => {
    event.preventDefault();
    openReport(button.dataset.report);
  }));
  decorateLinks(root);
}

function renderToday() {
  const root = $("#today");
  const executive = DATA.executive || {};
  const decisions = (DATA.decisions || []).filter(item => item.action !== "AVOID").slice(0, 3);
  const action = executive.action || "NONE";
  const buyText = DATA.currentBuys.length ? `${DATA.currentBuys.length} cleared` : "None cleared";
  const gateText = DATA.portfolio.authoritative ? "Ready" : "Blocked";
  const report = reportById(executive.reportId);

  root.innerHTML = `<div class="page-intro"><span class="eyebrow">Executive decision book</span><h2>Today</h2><p>What changed, what requires action, and what could change the call.</p></div>
    <section class="decision-banner ${actionClass(action)}">
      <div class="banner-top"><div><span class="section-label">CIO decision · ${escapeHtml(executive.date || "Current edition")}</span><h2>${escapeHtml(actionHeadline(action))}</h2></div><span class="urgency">${escapeHtml(executive.urgency || "Trigger-dependent")}</span></div>
      <p class="banner-note">${DATA.portfolio.authoritative ? "Portfolio inputs are current; cleared actions can include sizing." : "No capital action is authorized. Portfolio holdings and account constraints are not current, so the office can only investigate or avoid."}</p>
      ${report ? `<button type="button" class="link-button" data-report="${escapeHtml(report.id)}">Read today’s full brief →</button>` : ""}
    </section>

    <div class="status-strip" aria-label="Executive status">
      <div class="status-cell"><span class="status-value text">${escapeHtml(buyText)}</span><span class="status-label">Current buys</span></div>
      <div class="status-cell"><span class="status-value text">${escapeHtml(gateText)}</span><span class="status-label">Portfolio gate</span></div>
      <div class="status-cell"><span class="status-value">${DATA.decisions.length}</span><span class="status-label">Current calls</span></div>
    </div>

    <div class="today-grid">
      <div class="today-main">
        <section class="section">
          <div class="section-head"><div><span class="section-label">Decision queue</span><h3>Priority calls</h3></div><p>Latest CIO records, not a price-move leaderboard</p></div>
          <div class="decision-list compact">${decisions.length ? decisions.map(priorityDecisionMarkup).join("") : `<div class="empty-state">No current decision records.</div>`}</div>
          <button type="button" class="link-button" data-go="decisions">See all decisions →</button>
        </section>
      </div>

      <aside class="today-side">
        <section class="section">
          <div class="section-head"><div><span class="section-label">Since prior brief</span><h3>Material changes</h3></div></div>
          <ul class="change-list">${(executive.materialChanges || []).map(item => `<li>${inlineMd(item)}</li>`).join("") || "<li>No decision-relevant change recorded.</li>"}</ul>
        </section>
        <section class="section">
          <div class="section-head"><div><span class="section-label">Next checks</span><h3>Catalysts</h3></div></div>
          <ul class="catalyst-list">${(executive.catalysts || []).map(item => `<li>${inlineMd(item)}</li>`).join("") || "<li>No dated catalyst recorded.</li>"}</ul>
        </section>
        <section class="portfolio-callout ${DATA.portfolio.authoritative ? "pass" : ""}">
          <span class="section-label">Portfolio status</span><h3>${escapeHtml(DATA.portfolio.status)}</h3><p>${escapeHtml(DATA.portfolio.message)}</p>
          ${DATA.portfolio.missing.length ? `<div class="missing-list">${DATA.portfolio.missing.map(item => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
        </section>
      </aside>
    </div>`;

  $$('[data-report]', root).forEach(button => button.addEventListener("click", () => openReport(button.dataset.report)));
  $$('[data-go]', root).forEach(button => button.addEventListener("click", () => switchView(button.dataset.go)));
  bindDecisionLinks(root);
}

function decisionFilters() {
  const available = ["ALL", "BUY", "ADD", "HOLD", "INVESTIGATE", "AVOID", "REDUCE", "EXIT"]
    .filter(action => action === "ALL" || (DATA.decisions || []).some(item => item.action === action));
  return available.map(action => `<button type="button" class="filter-chip ${activeDecisionFilter === action ? "active" : ""}" data-decision-filter="${action}">${action === "ALL" ? "All calls" : `${action} ${DATA.actionCounts[action] || ""}`}</button>`).join("");
}

function renderDecisions() {
  const root = $("#decisions");
  const decisions = (DATA.decisions || []).filter(item => activeDecisionFilter === "ALL" || item.action === activeDecisionFilter);
  root.innerHTML = `<div class="page-intro"><span class="eyebrow">Current investment calls</span><h2>Decisions</h2><p>One current record per instrument. Expand a call for thesis, catalyst, risk, sizing gate, and primary evidence.</p></div>
    <div class="filters" aria-label="Decision filters">${decisionFilters()}</div>
    <div class="decision-list">${decisions.length ? decisions.map(priorityDecisionMarkup).join("") : `<div class="empty-state">No decisions match this filter.</div>`}</div>`;
  $$('[data-decision-filter]', root).forEach(button => button.addEventListener("click", () => {
    activeDecisionFilter = button.dataset.decisionFilter;
    renderDecisions();
  }));
  bindDecisionLinks(root);
}

function reportCategories() {
  return ["All", ...new Set((DATA.reports || []).map(report => report.category))];
}

function filteredReports() {
  const query = reportSearch.toLowerCase().trim();
  return (DATA.reports || []).filter(report => {
    const categoryMatch = activeReportFilter === "All" || report.category === activeReportFilter;
    const queryMatch = !query || [report.title, report.summary, report.category, ...(report.tags || [])].join(" ").toLowerCase().includes(query);
    return categoryMatch && queryMatch;
  });
}

function reportListMarkup() {
  const reports = filteredReports();
  return reports.length ? reports.map(report => `<button type="button" class="report-row ${selectedReportId === report.id ? "active" : ""}" data-open-report="${escapeHtml(report.id)}">
    <span class="report-row-top"><span>${escapeHtml(report.category)}</span><time>${escapeHtml(report.date)}</time></span>
    <strong>${escapeHtml(report.title)}</strong>
    <p>${escapeHtml(report.summary)}</p>
  </button>`).join("") : `<div class="empty-state">No reports match this search.</div>`;
}

function reportReaderMarkup(report) {
  if (!report) return `<div class="empty-state">Select a report to read it.</div>`;
  const decisions = (report.related_decisions || []).map(ticker => (DATA.decisions || []).find(item => item.instrument === ticker)).filter(Boolean);
  return `<div class="reader-toolbar"><button type="button" class="back-button" id="closeReport">← Reports</button><span class="reader-meta">${escapeHtml(report.category)} · ${escapeHtml(report.date)}</span></div>
    <header class="reader-header"><span class="section-label">${escapeHtml(report.category)}</span><h2>${escapeHtml(report.title)}</h2><p>Updated ${fmtDate(report.updated, { dateStyle: "medium", timeStyle: "short" })}</p>${report.tags.length ? `<div class="tag-row">${report.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}</header>
    <article class="markdown-body">${md(report.content)}</article>
    ${(report.links || []).length ? `<section class="backlinks"><span class="section-label">Direct sources</span><h3>Links in this report</h3><ul class="source-list">${report.links.map(link => `<li><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)} ↗</a></li>`).join("")}</ul></section>` : ""}
    ${decisions.length ? `<section class="backlinks"><span class="section-label">Backlinks</span><h3>Related decisions</h3><div class="related-links">${decisions.map(decision => `<button type="button" data-decision="${escapeHtml(decision.instrument)}">${escapeHtml(decision.instrument)} · ${escapeHtml(decision.action)}</button>`).join("")}</div></section>` : ""}`;
}

function renderReports() {
  const root = $("#reports");
  if (!selectedReportId) selectedReportId = (DATA.reports || [])[0]?.id || null;
  const selected = reportById(selectedReportId);
  root.innerHTML = `<div class="page-intro"><span class="eyebrow">Linked research notes</span><h2>Reports</h2><p>Daily briefs, weekly investment committee notes, investment memos, and material market signals. Raw ledgers and system files are intentionally excluded.</p></div>
    <div class="reports-layout ${reportReading ? "reading" : ""}">
      <div class="report-browser">
        <div class="search-row"><label for="reportSearch">Search reports</label><input id="reportSearch" type="search" value="${escapeHtml(reportSearch)}" placeholder="Ticker, decision, catalyst…" /></div>
        <div class="filters">${reportCategories().map(category => `<button type="button" class="filter-chip ${activeReportFilter === category ? "active" : ""}" data-report-filter="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("")}</div>
        <div class="report-list">${reportListMarkup()}</div>
      </div>
      <div class="report-reader">${reportReaderMarkup(selected)}</div>
    </div>`;

  $("#reportSearch")?.addEventListener("input", event => {
    reportSearch = event.currentTarget.value;
    const list = $(".report-list", root);
    list.innerHTML = reportListMarkup();
    bindReportRows(root);
  });
  $$('[data-report-filter]', root).forEach(button => button.addEventListener("click", () => {
    activeReportFilter = button.dataset.reportFilter;
    renderReports();
  }));
  bindReportRows(root);
  $("#closeReport")?.addEventListener("click", closeReport);
  $$('[data-decision]', root).forEach(button => button.addEventListener("click", () => {
    activeDecisionFilter = "ALL";
    renderDecisions();
    switchView("decisions");
    const target = (DATA.decisions || []).findIndex(item => item.instrument === button.dataset.decision);
    const cards = $$("#decisions .decision-card");
    if (target >= 0 && cards[target]) {
      cards[target].open = true;
      cards[target].scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }));
  decorateLinks(root);
}

function bindReportRows(root) {
  $$('[data-open-report]', root).forEach(button => button.addEventListener("click", () => openReport(button.dataset.openReport)));
}

function watchCardMarkup(item) {
  return `<details class="watch-card">
    <summary><span class="watch-head"><span class="ticker">${escapeHtml(item.instrument)}</span><span class="watch-theme">${escapeHtml(item.theme || item.sector || "")}</span><span class="priority">${escapeHtml(String(item.research_priority || "priority open").replaceAll("_", " "))}</span><span class="watch-stage">${escapeHtml(String(item.stage || "").replaceAll("_", " "))}</span></span></summary>
    <div class="watch-detail"><div class="detail-grid">
      <div class="detail-field"><span class="field-label">Action trigger</span><p>${escapeHtml(item.trigger || "Not established")}</p></div>
      <div class="detail-field"><span class="field-label">Invalidation</span><p>${escapeHtml(item.invalidation || "Not established")}</p></div>
      <div class="detail-field"><span class="field-label">Next event</span><p>${escapeHtml(item.next_event || "Trigger-dependent")}</p></div>
      <div class="detail-field"><span class="field-label">Current status</span><p><span class="action-badge ${actionClass(item.action)}">${escapeHtml(item.action || "INVESTIGATE")}</span></p></div>
    </div></div>
  </details>`;
}

function renderWatch() {
  const root = $("#watch");
  const alerts = DATA.alerts || [];
  const tasks = DATA.researchTasks || [];
  root.innerHTML = `<div class="page-intro"><span class="eyebrow">Triggers and catalysts</span><h2>Watch</h2><p>Observable conditions that can change a decision. No vague “monitoring,” and no raw system status.</p></div>
    <section class="section">
      <div class="section-head"><div><span class="section-label">Action conditions</span><h3>Watchlist</h3></div><p>${DATA.watchlist.length} current instruments</p></div>
      <div class="watch-list">${DATA.watchlist.map(watchCardMarkup).join("") || `<div class="empty-state">No watchlist entries.</div>`}</div>
    </section>
    <section class="section">
      <div class="section-head"><div><span class="section-label">Recent triggers</span><h3>Market signals</h3></div><p>Tap a signal to read the report</p></div>
      <div class="signal-list">${alerts.map(alert => `<button type="button" class="signal-row" data-report="${escapeHtml(alert.reportId)}"><span class="signal-level ${alert.level >= 3 ? "high" : ""}">L${alert.level || "—"}</span><strong>${escapeHtml(alert.title)}</strong><time>${escapeHtml(alert.date)}</time></button>`).join("") || `<div class="empty-state">No recent market signals.</div>`}</div>
    </section>
    <section class="section">
      <div class="section-head"><div><span class="section-label">Office work</span><h3>Next deliverables</h3></div><p>Only work that can advance a decision</p></div>
      <ul class="change-list">${tasks.map(task => `<li><strong>${escapeHtml(task.priority || "")}</strong> · ${escapeHtml(task.task || "")}<br><span class="watch-stage">Next: ${escapeHtml(task.next_trigger || "Open")}</span></li>`).join("") || "<li>No open decision work.</li>"}</ul>
    </section>`;
  $$('[data-report]', root).forEach(button => button.addEventListener("click", () => openReport(button.dataset.report)));
}

function routeFromHash() {
  const route = currentHash();
  if (route.view === "reports" && route.detail && reportById(route.detail)) {
    selectedReportId = route.detail;
    reportReading = true;
    renderReports();
  }
  switchView(route.view, { updateHash: false, scroll: false });
}

async function load() {
  if (window.__SITE_DATA__) {
    DATA = window.__SITE_DATA__;
  } else {
    const response = await fetch("data/site-data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Dashboard data request failed: ${response.status}`);
    DATA = await response.json();
  }
  selectedReportId = (DATA.reports || [])[0]?.id || null;
  renderShell();
  renderToday();
  renderDecisions();
  renderReports();
  renderWatch();
  routeFromHash();
  decorateLinks();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

load().catch(error => {
  document.body.innerHTML = `<main style="max-width:760px;margin:50px auto;padding:24px;font-family:Times New Roman,serif"><h1>Investment Office failed to load</h1><pre style="white-space:pre-wrap">${escapeHtml(error.stack || error)}</pre></main>`;
});
