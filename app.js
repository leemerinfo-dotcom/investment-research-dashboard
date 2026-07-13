let DATA = null;
let activeDecisionFilter = "ALL";
let activeReportFilter = "Briefs & memos";
let reportSearch = "";
let selectedReportId = null;
let reportReading = false;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

const VIEW_META = {
  today: ["Executive brief", "Today"],
  decisions: ["Research ratings", "Ideas"],
  reports: ["Linked research notes", "Reports"],
  watch: ["Markets and catalysts", "Watch"],
  guide: ["Plain-language reference", "Guide"]
};

function md(text) {
  if (!text) return "";
  if (!window.marked || !window.DOMPurify) {
    return `<pre class="render-fallback">${escapeHtml(text)}</pre>`;
  }
  const html = window.marked.parse(text, { mangle: false, headerIds: false });
  return window.DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["style", "srcdoc"]
  });
}

function inlineMd(text) {
  if (!text) return "";
  if (!window.marked || !window.DOMPurify) return escapeHtml(text);
  const html = window.marked.parseInline(text, { mangle: false, headerIds: false });
  return window.DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_TAGS: ["strong", "em", "code", "a"],
    ALLOWED_ATTR: ["href", "title"]
  });
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
  if (normalized.startsWith("NONE")) return "No trade cleared today";
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
  if (view === "reports" && updateHash && !currentHash().detail && window.innerWidth < 820) {
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
  const note = decision.note || {};
  const rating = decision.researchRating || "WATCH";
  return `<details class="decision-card ${actionClass(rating)}">
    <summary>
      <span class="decision-summary">
        <span class="ticker">${escapeHtml(decision.instrument)}</span>
        <span class="action-badge ${actionClass(rating)}">${escapeHtml(rating)}</span>
        ${quoteMarkup(decision.instrument)}
        <p class="decision-lede"><strong>${escapeHtml(note.call || "Research incomplete.")}</strong> ${escapeHtml(note.why || "")}</p>
      </span>
    </summary>
    ${decisionDetailMarkup(decision)}
  </details>`;
}

function decisionDetailMarkup(decision) {
  const profile = decision.return_profile || {};
  const note = decision.note || {};
  const relatedReports = (decision.relatedReports || []).map(id => reportById(id)).filter(Boolean);
  const metrics = [
    [profile.probability_weighted_expected_return_pct, "Weighted return", value => pct(value)],
    [profile.realistic_downside_pct, "Realistic downside", value => pct(value)],
    [profile.upside_downside_ratio, "Upside / downside", value => `${value}:1`]
  ].filter(([value]) => value !== null && value !== undefined);
  return `<div class="decision-detail">
    ${metrics.length ? `<div class="metric-line">${metrics.map(([value, label, format]) => `<div><strong>${format(value)}</strong><span>${label}</span></div>`).join("")}</div>` : ""}
    <div class="plain-note">
      <div><span>Call</span><p>${escapeHtml(note.call || "Research incomplete.")}</p></div>
      <div><span>Why</span><p>${escapeHtml(note.why || "Not yet established.")}</p></div>
      <div><span>Upside</span><p>${escapeHtml(note.upside || "Not yet modeled.")}</p></div>
      <div><span>Risk</span><p>${escapeHtml(note.risk || "Not yet established.")}</p></div>
      <div><span>Next check</span><p>${escapeHtml(note.next || "No dated check established.")}</p></div>
    </div>
    ${(decision.evidenceLinks || []).length ? `<div class="detail-field"><span class="field-label">Sources</span><ul class="source-list">${decision.evidenceLinks.map(link => `<li><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)} ↗</a></li>`).join("")}</ul></div>` : ""}
    ${relatedReports.length ? `<div class="detail-field"><span class="field-label">Read more</span><div class="related-links">${relatedReports.map(report => `<button type="button" data-report="${escapeHtml(report.id)}">${escapeHtml(report.title)}</button>`).join("")}</div></div>` : ""}
  </div>`;
}

function bindDecisionLinks(root) {
  $$('[data-report]', root).forEach(button => button.addEventListener("click", event => {
    event.preventDefault();
    openReport(button.dataset.report);
  }));
  decorateLinks(root);
}

function marketNoteMarkup(item) {
  const links = item.links || [];
  return `<details class="market-note">
    <summary><span class="market-scope">${escapeHtml(item.scope || "Market")}</span><p>${escapeHtml(item.notice || "No material change.")}</p></summary>
    <div class="market-note-body">
      <div><span>Prediction</span><p>${escapeHtml(item.prediction || "No forecast established.")}</p></div>
      <div><span>Investment effect</span><p>${escapeHtml(item.implication || "No action implied.")}</p></div>
      <div><span>What changes the view</span><p>${escapeHtml(item.change || "New primary evidence.")}</p></div>
      ${links.length ? `<div><span>Sources</span><p>${links.map(link => `<a href="${escapeHtml(link.url)}">${escapeHtml(link.label)} ↗</a>`).join(" · ")}</p></div>` : ""}
    </div>
  </details>`;
}

function renderToday() {
  const root = $("#today");
  const executive = DATA.executive || {};
  const ratingOrder = { "BUY": 0, "CONDITIONAL BUY": 1, "WATCH": 2, "AVOID": 3 };
  const decisions = (DATA.decisions || []).slice().sort((a, b) => (ratingOrder[a.researchRating] ?? 9) - (ratingOrder[b.researchRating] ?? 9)).slice(0, 3);
  const action = executive.action || "NONE";
  const buyText = (DATA.currentBuys || []).length ? `${DATA.currentBuys.length} cleared` : "None";
  const candidateText = (DATA.buyCandidates || []).length ? `${DATA.buyCandidates.length}` : "None yet";
  const sizingText = DATA.portfolio.authoritative ? "Ready" : "Blocked";
  const report = reportById(executive.reportId);

  root.innerHTML = `<div class="page-intro"><span class="eyebrow">Executive investment note</span><h2>Today</h2><p>The call, the best ideas, and what could change next.</p></div>
    <section class="decision-banner ${actionClass(action)}">
      <div class="banner-top"><div><span class="section-label">Today’s trade decision · ${escapeHtml(executive.date || "Current edition")}</span><h2>${escapeHtml(actionHeadline(action))}</h2></div><span class="urgency">${escapeHtml(executive.urgency || "Trigger-dependent")}</span></div>
      <p class="banner-note">${DATA.portfolio.authoritative ? "Portfolio inputs are current, so approved ideas can be sized." : "Research can still produce buy candidates. Personal trade sizing is blocked until holdings, cash, and account limits are connected."}</p>
      <div class="banner-links">${report ? `<button type="button" class="link-button" data-report="${escapeHtml(report.id)}">Read the brief →</button>` : ""}<button type="button" class="link-button" data-go="guide">Why is sizing blocked? →</button></div>
    </section>

    <div class="status-strip" aria-label="Executive status">
      <div class="status-cell"><span class="status-value text">${escapeHtml(candidateText)}</span><span class="status-label">Buy candidates</span></div>
      <div class="status-cell"><span class="status-value text">${escapeHtml(buyText)}</span><span class="status-label">Current buys</span></div>
      <div class="status-cell"><span class="status-value text">${escapeHtml(sizingText)}</span><span class="status-label">Trade sizing</span></div>
    </div>

    <div class="today-grid">
      <div class="today-main">
        <section class="section">
          <div class="section-head"><div><span class="section-label">Opportunity list</span><h3>Best ideas now</h3></div><p>Research ranking—not a price-move leaderboard</p></div>
          <div class="decision-list compact">${decisions.length ? decisions.map(priorityDecisionMarkup).join("") : `<div class="empty-state">No current research ratings.</div>`}</div>
          <button type="button" class="link-button" data-go="decisions">See all ideas →</button>
        </section>
      </div>

      <aside class="today-side">
        ${(DATA.marketNotes || []).length ? `<section class="section">
          <div class="section-head"><div><span class="section-label">Market and industries</span><h3>Current view</h3></div></div>
          <div class="market-note-list">${DATA.marketNotes.slice(0, 3).map(marketNoteMarkup).join("")}</div>
          <button type="button" class="link-button" data-go="watch">See all market notes →</button>
        </section>` : ""}
        <section class="section">
          <div class="section-head"><div><span class="section-label">Since prior brief</span><h3>What changed</h3></div></div>
          <ul class="change-list">${(executive.materialChanges || []).map(item => `<li>${inlineMd(item)}</li>`).join("") || "<li>No decision-relevant change recorded.</li>"}</ul>
        </section>
        <section class="section">
          <div class="section-head"><div><span class="section-label">Next checks</span><h3>Catalysts</h3></div></div>
          <ul class="catalyst-list">${(executive.catalysts || []).map(item => `<li>${inlineMd(item)}</li>`).join("") || "<li>No dated catalyst recorded.</li>"}</ul>
        </section>
      </aside>
    </div>`;

  $$('[data-report]', root).forEach(button => button.addEventListener("click", () => openReport(button.dataset.report)));
  $$('[data-go]', root).forEach(button => button.addEventListener("click", () => switchView(button.dataset.go)));
  bindDecisionLinks(root);
}

function decisionFilters() {
  const available = ["ALL", "BUY", "CONDITIONAL BUY", "WATCH", "AVOID"]
    .filter(rating => rating === "ALL" || (DATA.decisions || []).some(item => item.researchRating === rating));
  return available.map(rating => {
    const count = (DATA.decisions || []).filter(item => item.researchRating === rating).length;
    return `<button type="button" class="filter-chip ${activeDecisionFilter === rating ? "active" : ""}" data-decision-filter="${rating}">${rating === "ALL" ? "All ideas" : `${rating} ${count}`}</button>`;
  }).join("");
}

function renderDecisions() {
  const root = $("#decisions");
  const decisions = (DATA.decisions || []).filter(item => activeDecisionFilter === "ALL" || item.researchRating === activeDecisionFilter);
  root.innerHTML = `<div class="page-intro"><span class="eyebrow">Current research ratings</span><h2>Ideas</h2><p>Simple calls first. Tap an idea for the upside, risk, next check, and sources.</p></div>
    <div class="rating-key"><strong>Research rating</strong> answers “is the stock attractive?” <strong>Trade sizing</strong> answers “how much belongs in your accounts?”</div>
    <div class="filters" aria-label="Idea filters">${decisionFilters()}</div>
    <div class="decision-list">${decisions.length ? decisions.map(priorityDecisionMarkup).join("") : `<div class="empty-state">No ideas match this filter.</div>`}</div>`;
  $$('[data-decision-filter]', root).forEach(button => button.addEventListener("click", () => {
    activeDecisionFilter = button.dataset.decisionFilter;
    renderDecisions();
  }));
  bindDecisionLinks(root);
}

function reportCategories() {
  return ["Briefs & memos", ...new Set((DATA.reports || []).map(report => report.category))];
}

function filteredReports() {
  const query = reportSearch.toLowerCase().trim();
  return (DATA.reports || []).filter(report => {
    const categoryMatch = activeReportFilter === "Briefs & memos" ? report.category !== "Market Signal" : report.category === activeReportFilter;
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
    ${decisions.length ? `<section class="backlinks"><span class="section-label">Backlinks</span><h3>Related decisions</h3><div class="related-links">${decisions.map(decision => `<button type="button" data-decision="${escapeHtml(decision.instrument)}">${escapeHtml(decision.instrument)} · ${escapeHtml(decision.researchRating || "WATCH")}</button>`).join("")}</div></section>` : ""}`;
}

function renderReports() {
  const root = $("#reports");
  root.classList.toggle("reading-mode", reportReading);
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
  root.innerHTML = `<div class="page-intro"><span class="eyebrow">Markets and catalysts</span><h2>Watch</h2><p>Broad market, industry outlooks, and the events that can change an investment call.</p></div>
    ${(DATA.marketNotes || []).length ? `<section class="section">
      <div class="section-head"><div><span class="section-label">Outlook</span><h3>Market and industry notes</h3></div><p>Notice → prediction → investment effect</p></div>
      <div class="market-note-list full">${DATA.marketNotes.map(marketNoteMarkup).join("")}</div>
    </section>` : ""}
    <section class="section">
      <div class="section-head"><div><span class="section-label">Action conditions</span><h3>Watchlist</h3></div><p>${DATA.watchlist.length} current instruments</p></div>
      <div class="watch-list">${DATA.watchlist.map(watchCardMarkup).join("") || `<div class="empty-state">No watchlist entries.</div>`}</div>
    </section>
    <section class="section">
      <div class="section-head"><div><span class="section-label">Recent triggers</span><h3>Market signals</h3></div><p>Tap a signal to read the report</p></div>
      <div class="signal-list">${alerts.map(alert => `<button type="button" class="signal-row" data-report="${escapeHtml(alert.reportId)}"><span class="signal-level ${alert.level >= 3 ? "high" : ""}">L${alert.level || "—"}</span><strong>${escapeHtml(alert.title)}</strong><time>${escapeHtml(alert.date)}</time></button>`).join("") || `<div class="empty-state">No recent market signals.</div>`}</div>
    </section>`;
  $$('[data-report]', root).forEach(button => button.addEventListener("click", () => openReport(button.dataset.report)));
  decorateLinks(root);
}

function renderGuide() {
  const root = $("#guide");
  const missing = DATA.portfolio.missing || [];
  root.innerHTML = `<div class="page-intro"><span class="eyebrow">Plain-language reference</span><h2>Guide</h2><p>What each investment term means and why a trade may be blocked.</p></div>
    <section class="guide-lead">
      <span class="section-label">Why sizing is blocked</span>
      <h3>${escapeHtml(DATA.portfolio.status)}</h3>
      <p><strong>Simple answer:</strong> I do not have a current, verified picture of what you own, your cash, and your account limits. Research can still find attractive stocks; only the personal trade size is blocked.</p>
      ${missing.length ? `<div class="missing-list">${missing.map(item => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
    </section>
    <section class="section">
      <div class="section-head"><div><span class="section-label">Note format</span><h3>How to read an idea</h3></div></div>
      <div class="plain-note guide-format">
        <div><span>Call</span><p>Buy, conditional buy, watch, or avoid.</p></div>
        <div><span>Why</span><p>The one fact that matters most.</p></div>
        <div><span>Upside / risk</span><p>What can go right and the main way we lose.</p></div>
        <div><span>Next check</span><p>The evidence or event that can change the call.</p></div>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><div><span class="section-label">Glossary</span><h3>Terms in this app</h3></div></div>
      <dl class="glossary-list">${(DATA.glossary || []).map(item => `<div><dt>${escapeHtml(item.term)}</dt><dd>${escapeHtml(item.definition)}</dd></div>`).join("")}</dl>
    </section>`;
}

function routeFromHash() {
  const route = currentHash();
  if (route.view === "reports" && route.detail && reportById(route.detail)) {
    selectedReportId = route.detail;
    reportReading = true;
    renderReports();
  } else if (route.view === "reports") {
    reportReading = false;
    renderReports();
  } else {
    reportReading = false;
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
  renderGuide();
  routeFromHash();
  decorateLinks();
  if (!window.__STANDALONE__ && "serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

load().catch(error => {
  document.body.innerHTML = `<main class="load-error"><h1>Investment Office failed to load</h1><pre>${escapeHtml(error.stack || error)}</pre></main>`;
});
