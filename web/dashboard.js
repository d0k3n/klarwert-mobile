const BASE = "";
const CHART_COLORS = [
  "#58a6ff", "#3fb950", "#d29922", "#bc8cff",
  "#ffa657", "#79c0ff", "#f778ba", "#e6edf3"
];
const CHART_GREEN = "#3fb950";
const CHART_RED = "#f85149";
const CHART_BLUE = "#58a6ff";

async function loadJSON(url) {
const r = await fetch(url);
if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
return r.json();
}

let cashFlowChart = null;
let weeklyPLChart = null;
let plEvolutionChart = null;
let allocationChart = null;
let dividendChart = null;
let incomeChart = null;
let spendingCatChart = null;
let spendingMonthChart = null;
let currentUserSettings = { projection_active_days_per_week: 3 };
let dashboardHasData = false;
let pdfExportInProgress = false;

function setPdfExportAvailability(available) {
  const button = document.getElementById("export-pdf-btn");
  if (!button || pdfExportInProgress) return;
  button.disabled = !available;
}

window.exportDashboardPdf = async function () {
  const button = document.getElementById("export-pdf-btn");
  const status = document.getElementById("pdf-export-status");
  if (!button || button.disabled || pdfExportInProgress || !dashboardHasData) return;
  if (document.getElementById('results-analysis') && !resultsState.analysis) return;

  if (!window.KlarwertReport || typeof window.KlarwertReport.exportDashboardPdf !== "function") {
    if (status) {
      status.textContent = "PDF export is unavailable. Please reload the app.";
      status.classList.add("error");
    }
    return;
  }

  pdfExportInProgress = true;
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }
  if (status) {
    status.textContent = "Preparing dashboard PDF…";
    status.classList.remove("error");
  }

  try {
    const result = window.KlarwertNative?.isNative && typeof window.KlarwertNative.sharePdf === "function"
      ? await window.KlarwertReport.exportDashboardPdf({
        analysis: resultsState.analysis ? structuredClone(resultsState.analysis) : undefined,
        shareBase64: (filename, base64) => window.KlarwertNative.sharePdf(filename, base64),
      })
      : await window.KlarwertReport.exportDashboardPdf({ analysis: resultsState.analysis ? structuredClone(resultsState.analysis) : undefined });
    if (status) status.textContent = result?.shared ? "PDF ready to share." : "PDF downloaded.";
  } catch (error) {
    console.error("Dashboard PDF export failed:", error);
    if (status) {
      const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
      status.textContent = `PDF export failed.${detail}`;
      status.classList.add("error");
    }
  } finally {
    pdfExportInProgress = false;
    if (button) {
      button.disabled = false;
      if (document.getElementById('results-analysis') && !resultsState.analysis) button.disabled = true;
      button.removeAttribute("aria-busy");
    }
  }
};

const TABLE_CONFIGS = {
  'open-positions-table': {
    groupColumns: ['asset_class'],
    groupLabels: { asset_class: 'Asset Class' },
    numericFields: ['shares', 'total_cost', 'market_value', 'unrealized_pl', 'weight'],
    averageFields: ['average_cost', 'market_price'],
  },
  'closed-positions-table': {
    groupColumns: ['asset_class'],
    groupLabels: { asset_class: 'Asset Class' },
    numericFields: ['total_realized_pl', 'closed_lots', 'total_shares_sold'],
  },
  'product-results-table': {
    groupColumns: ['asset_class', 'status'],
    groupLabels: { asset_class: 'Asset Class', status: 'Status' },
    numericFields: ['total_invested', 'total_realized_pl', 'total_dividends', 'total_dividend_tax', 'total_fees', 'total_trades'],
    averageFields: ['yield_on_cost'],
  },
  'derivative-executions-table': {
    groupColumns: ['asset_class', 'reconciled'],
    groupLabels: { asset_class: 'Asset Class', reconciled: 'Reconciled?' },
    numericFields: ['ko_quantity', 'ko_total', 'warrant_return', 'net_result'],
  },
  'card-expenses-table': {
    groupColumns: ['name'],
    groupLabels: { name: 'Merchant' },
    numericFields: ['amount'],
  },
   'transactions-table': {
    groupColumns: ['type', 'asset_class'],
    groupLabels: { type: 'Type', asset_class: 'Asset Class' },
    numericFields: ['shares', 'amount'],
  },
  'lot-matches-table': {
    groupColumns: ['name', 'isin'],
    groupLabels: { name: 'Name', isin: 'ISIN' },
    numericFields: ['shares', 'proceeds', 'cost_basis', 'pl'],
  },
};

async function loadAllData() {
invalidateTaxReport();
const [summary, valuedPositions, closedPositions, cashFlow, transactions, products, monthlyPl, dailyPl, annualProjection, settings, derivativeExecutions, cardTransactions, lotMatches, perfData, income, spending, cardRules] = await Promise.all([
loadJSON(`${BASE}/api/summary`),
loadJSON(`${BASE}/api/valued_positions`),
loadJSON(`${BASE}/api/closed_positions`),
loadJSON(`${BASE}/api/cash_flow`),
loadJSON(`${BASE}/api/transactions`),
loadJSON(`${BASE}/api/products`),
loadJSON(`${BASE}/api/monthly_pl`),
loadJSON(`${BASE}/api/daily_pl`),
loadJSON(`${BASE}/api/annual_pl_projection`),
loadJSON(`${BASE}/api/settings`),
loadJSON(`${BASE}/api/derivative_executions`),
loadJSON(`${BASE}/api/card_transactions`),
loadJSON(`${BASE}/api/lot_matches`),
loadJSON(`${BASE}/api/performance`),
loadJSON(`${BASE}/api/income`),
loadJSON(`${BASE}/api/spending`),
loadJSON(`${BASE}/api/card_rules`),
]);

currentUserSettings = settings || currentUserSettings;

const empty = !summary || Object.keys(summary).length === 0;
dashboardHasData = !empty;
setPdfExportAvailability(dashboardHasData);
document.getElementById("empty-state").style.display = empty ? "block" : "none";
document.getElementById("summary-cards").innerHTML = "";
document.getElementById("summary-by-asset-class").innerHTML = "";
if (empty) return;
renderSummary(summary);
renderPerformance(perfData);
renderSummaryByAssetClass(summary);
renderRecon(summary);
const openPositions = valuedPositions.positions || [];
renderTable("open-positions-table", openPositions, TABLE_CONFIGS['open-positions-table']);
renderPriceInputs(openPositions);
renderValuedCards(valuedPositions.totals || {}, openPositions);
renderTable("closed-positions-table", closedPositions, TABLE_CONFIGS['closed-positions-table']);
renderCashFlowChart(cashFlow);
renderTransactions(transactions);
renderMonthlyPLChart(dailyPl);
renderWeeklyPLChart(dailyPl);
renderAnnualPLProjection(annualProjection);
renderPLEvolutionChart(monthlyPl);
renderDerivativeUnderlyings(products, settings);
renderTable("product-results-table", products, TABLE_CONFIGS['product-results-table']);
renderAllocationChart(openPositions);
renderDividendChart(products);
renderIncomeChart(income.monthly);
renderTable("dividend-history-table", income.dividends, null);
renderTable("derivative-executions-table", derivativeExecutions, TABLE_CONFIGS['derivative-executions-table']);
renderTable("lot-matches-table", lotMatches, TABLE_CONFIGS['lot-matches-table']);
renderTable("card-expenses-table", cardTransactions, TABLE_CONFIGS['card-expenses-table']);
renderSpendingCharts(spending);
renderCardRules(cardRules);
}

window.loadCSV = function () {
  if (window.KlarwertNative && window.KlarwertNative.isNative) {
    window.uploadCSV(null);
  } else {
    document.getElementById('csv-input').click();
  }
};

window.uploadCSV = async function (input) {
const status = document.getElementById("reload-status");
let file = input && input.files ? input.files[0] : null;
if (!file && window.KlarwertNative && window.KlarwertNative.isNative) {
  try {
    const picked = await window.KlarwertNative.pickCSV();
    if (picked) file = new File([picked.content], picked.name, { type: "text/csv" });
  } catch (e) {
    status.textContent = `Failed: ${e.message}`;
    return;
  }
}
if (!file) return;
status.textContent = "Loading...";
try {
const form = new FormData();
form.append("file", file);
if (resultsEl('replace')?.checked) {
  if (!confirm('Replace all imported history with this complete statement? The previous revision remains recoverable.')) return;
  form.append('mode', 'replace');
}
const r = await fetch(`${BASE}/api/upload`, { method: "POST", body: form });
const data = await r.json();
if (!data.ok) throw new Error(data.error);
await loadResults();
await loadAllData();
status.textContent = `Imported ${data.added ?? data.count} new movements; ${data.duplicates ?? 0} duplicates ignored. ${data.count} total · revision ${data.revision ?? 'legacy'}.`;
} catch (e) {
status.textContent = `Failed: ${e.message}`;
} finally {
  if (input) input.value = "";
}
};

const supportConfig = {};
window.SUPPORT_URLS = supportConfig;

function openSupportUrl(url) {
  if (window.KlarwertNative && window.KlarwertNative.isNative) {
    window.KlarwertNative.openUrl(url);
  } else if (window.pywebview && window.pywebview.api && window.pywebview.api.open_url) {
    window.pywebview.api.open_url(url);
  } else {
    window.open(url, "_blank");
  }
}

window.openSupport = function () {
  if (supportConfig.DONATION_URL) openSupportUrl(supportConfig.DONATION_URL);
};

window.openFeatureRequest = function () {
  if (supportConfig.GITHUB_URL) openSupportUrl(supportConfig.GITHUB_URL);
};

function bindSupportLinks() {
  bindSupportButton("support-btn", "DONATION_URL");
  bindSupportButton("feature-btn", "GITHUB_URL");
  const footerLink = document.getElementById("footer-support-link");
  if (footerLink) {
    if (!supportConfig.DONATION_URL) {
      footerLink.style.display = "none";
    } else {
      footerLink.addEventListener("click", (e) => {
        e.preventDefault();
        openSupportUrl(supportConfig.DONATION_URL);
      });
    }
  }
}

function bindSupportButton(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!supportConfig[key]) {
    el.style.display = "none";
    return;
  }
  el.addEventListener("click", () => openSupportUrl(supportConfig[key]));
}

(async () => {
  try {
    const r = await fetch(`${BASE}/api/support`);
    const data = await r.json();
    supportConfig.DONATION_URL = data.donation_url || "";
    supportConfig.GITHUB_URL = data.github_url || "";
    bindSupportLinks();
  } catch (e) {
    bindSupportLinks();
  }
  initDashGroups();
  await loadAllData();
})();

function groupData(data, groupBy, numericFields, averageFields) {
  const groups = {};
  data.forEach(row => {
    let key;
    if (row[groupBy] === null || row[groupBy] === undefined) {
      key = '(empty)';
    } else if (typeof row[groupBy] === 'boolean') {
      key = row[groupBy] ? 'Yes' : 'No';
    } else {
      key = String(row[groupBy]);
    }
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  });

  const rows = [];
  const totals = {};
  numericFields.forEach(f => totals[f] = 0);

  Object.keys(groups).sort().forEach(key => {
    const items = groups[key];
    const grp = {};
    numericFields.forEach(f => {
      grp[f] = items.reduce((acc, r) => acc + (r[f] || 0), 0);
      totals[f] += grp[f];
    });
    if (averageFields) {
      averageFields.forEach(f => {
        if (f === 'average_cost') {
          const tc = items.reduce((acc, r) => acc + (r.total_cost || 0), 0);
          const sh = items.reduce((acc, r) => acc + (r.shares || 0), 0);
          grp[f] = sh > 0 ? tc / sh : 0;
        } else if (f === 'market_price') {
          const priced = items.filter(r => r.market_price != null);
          const val = priced.reduce((acc, r) => acc + ((r.shares || 0) * r.market_price), 0);
          const sh = priced.reduce((acc, r) => acc + (r.shares || 0), 0);
          grp[f] = sh > 0 ? val / sh : null;
        } else if (f === 'yield_on_cost') {
          const net = items.reduce((acc, r) => acc + (r.total_dividends_net || 0), 0);
          const cost = items.reduce((acc, r) => acc + (r.total_cost || 0), 0);
          grp[f] = cost > 0 ? Math.round(100 * net / cost * 100) / 100 : null;
        } else {
          grp[f] = items.reduce((acc, r) => acc + (r[f] || 0), 0);
        }
      });
    }
    grp._groupKey = key;
    const first = items[0];
    Object.keys(first).forEach(k => {
      if (!numericFields.includes(k) && (!averageFields || !averageFields.includes(k)) && k !== groupBy && k !== '_groupKey') {
        grp[k] = first[k];
      }
    });
    rows.push(grp);
  });

  const totalRow = { _groupKey: 'Total' };
  numericFields.forEach(f => totalRow[f] = totals[f]);
  if (averageFields) averageFields.forEach(f => totalRow[f] = '—');

  return { rows, totals: totalRow };
}

function insertGroupDropdown(table, config, onChange) {
  const existing = table.parentNode.querySelector('.grouping-controls');
  if (existing) existing.remove();
  const wrapper = document.createElement('div');
  wrapper.className = 'grouping-controls';

  const select = document.createElement('select');
  select.className = 'group-dropdown';

  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = 'None (no grouping)';
  select.appendChild(noneOpt);

  config.groupColumns.forEach(col => {
    const opt = document.createElement('option');
    opt.value = col;
    opt.textContent = config.groupLabels[col] || col;
    select.appendChild(opt);
  });

  select.addEventListener('change', () => onChange(select.value || null));
  wrapper.appendChild(select);

  const header = table.previousElementSibling;
  if (header && header.tagName === 'H2') {
    header.parentNode.insertBefore(wrapper, table);
  } else {
    table.parentNode.insertBefore(wrapper, table);
  }

  return select;
}

function formatShares(value) {
  if (value == null) return '';
  const options = value !== 0 && Math.abs(value) < 0.0001
    ? { maximumSignificantDigits: 6 }
    : { minimumFractionDigits: 4, maximumFractionDigits: 6 };
  return value.toLocaleString(undefined, options);
}

function formatVal(key, val) {
  if (typeof val !== 'number') return val ?? '';
  if (key === 'weight') return `${(val * 100).toFixed(1)}%`;
  if (key === 'yield_on_cost') return val == null ? '' : `${val.toFixed(2)}%`;
   if (key === 'average_cost' || key.endsWith('_cost') || key === 'total_realized_pl' || key === 'total_invested' || key === 'total_dividends' || key === 'total_dividend_tax' || key === 'total_dividends_net' || key === 'total_fees' || key === 'fees' || key === 'amount' || key === 'price' || key === 'ko_total' || key === 'warrant_return' || key === 'net_result' || key === 'proceeds' || key === 'cost_basis' || key === 'pl' || key === 'market_value' || key === 'unrealized_pl' || key === 'market_price' || key === 'gross' || key === 'wht' || key === 'net') {
    return `\u20AC${val.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  }
  if (key === 'shares' || key === 'total_shares_sold') {
    return formatShares(val);
  }
  return val.toLocaleString();
}

function renderSummary(s) {
const pl = s.total_realized_pl || 0;
const spending = s.total_card_spending || 0;
let coverage, coverageCls;
if (pl <= 0 || spending === 0) {
coverage = pl > 0 && spending === 0 ? "100%" : "N/A";
coverageCls = pl > 0 && spending === 0 ? "positive" : "";
} else {
const pct = Math.min(100, pl / spending * 100);
coverage = `${pct.toFixed(1)}%`;
coverageCls = pct >= 100 ? "positive" : "negative";
}

const cards = [
{ label: "Expenses covered by P/L", value: coverage, fmt: v => v, cls: () => coverageCls },
{ label: "Total Invested", value: s.total_invested, fmt: v => `\u20AC${v.toLocaleString()}` },
{ label: "Realized P&L", value: pl, fmt: v => `\u20AC${v.toLocaleString()}`, cls: (v) => v >= 0 ? "positive" : "negative" },
{ label: "Dividends", value: s.total_dividends, fmt: v => `\u20AC${v.toLocaleString()}` },
{ label: "Dividend WHT", value: s.total_dividend_tax, fmt: v => `\u20AC${v.toLocaleString()}` },
{ label: "Interest", value: s.total_interest, fmt: v => `\u20AC${v.toLocaleString()}` },
{ label: "Fees", value: s.total_fees, fmt: v => `\u20AC${v.toLocaleString()}` },
{ label: "Card Spending", value: s.total_card_spending, fmt: v => `\u20AC${v.toLocaleString()}` },
{ label: "Net Deposits", value: s.net_deposits, fmt: v => `\u20AC${v.toLocaleString()}` },
];
const container = document.getElementById("summary-cards");
cards.forEach(c => {
const div = document.createElement("div");
div.className = "card";
const cls = c.cls ? c.cls(c.value) : "";
div.innerHTML = `<div class="label">${c.label}</div><div class="value ${cls}">${c.fmt(c.value)}</div>`;
container.appendChild(div);
});

const realizedCard = container.querySelector(".card:nth-child(3) .value");
if (realizedCard) realizedCard.textContent = `\u20AC${pl.toLocaleString()}`;
}

function renderPerformance(p) {
if (!p || Object.keys(p).length === 0) return;
const container = document.getElementById("summary-cards");
const eur = v => v == null ? "N/A" : `\u20AC${v.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
const cards = [
  { label: "Investment XIRR (est., annualized)", value: p.xirr_total == null ? "N/A — incomplete valuation or duration" : `${(p.xirr_total * 100).toFixed(2)}%` },
  { label: "XIRR at cost (annualized)", value: p.xirr_at_cost == null ? "N/A" : `${(p.xirr_at_cost * 100).toFixed(2)}%` },
  { label: "Valuation date (saved quotes)", value: p.as_of ? new Date(p.as_of).toLocaleDateString() : "N/A" },
  { label: "Win Rate (closed)", value: p.win_rate == null ? "N/A" : `${p.win_rate}% (${p.winners}W/${p.losers}L)` },
  { label: "Avg Win", value: eur(p.avg_win), cls: "positive" },
  { label: "Avg Loss", value: eur(p.avg_loss), cls: "negative" },
];
cards.forEach(c => {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `<div class="label">${c.label}</div><div class="value ${c.cls || ""}">${c.value}</div>`;
  container.appendChild(div);
});
}

function renderSummaryByAssetClass(s) {
if (!s.by_asset_class) return;
const labels = { STOCK: "Stocks", DERIVATIVE: "Derivatives", FUND: "Funds" };
const container = document.getElementById("summary-by-asset-class");
Object.entries(s.by_asset_class).forEach(([ac, data]) => {
const div = document.createElement("div");
div.className = "card";
const plCls = data.total_realized_pl >= 0 ? "positive" : "negative";
div.innerHTML = `
<div class="label">${labels[ac] || ac} (${data.count})</div>
<div class="value">Invested: \u20AC${data.total_invested.toLocaleString()}</div>
<div class="value ${plCls}">P&amp;L: \u20AC${data.total_realized_pl.toLocaleString()}</div>
<div class="value">Dividends: \u20AC${data.total_dividends.toLocaleString()}</div>
`;
container.appendChild(div);
});
}

function renderRecon(s) {
const tbody = document.querySelector("#recon-table tbody");
tbody.innerHTML = "";
if (!s.reconciliation) return;
const r = s.reconciliation;
const eur = v => `\u20AC${(v || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
const rows = [
  ["Net deposits", r.net_deposits],
  ["Income (dividends net, interest, saveback)", r.income],
  ["Realized P&L", r.realized_pl],
  ["Cash balance", r.cash_balance],
  ["Open positions at cost", r.open_positions_cost],
  ["Card spending", r.card_spending],
  ["Standalone fees", r.fees],
  ["Unreconciled difference", r.difference],
];
rows.forEach(([label, val], i) => {
  const tr = document.createElement("tr");
  if (i === rows.length - 1) tr.className = "total-row";
  tr.innerHTML = `<td>${label}</td><td class="num">${eur(val)}</td>`;
  tbody.appendChild(tr);
});
}

function renderTable(tableId, data, groupConfig) {
const table = document.getElementById(tableId);
const tbody = table.querySelector("tbody");
const thead = table.querySelector("thead");

let currentSort = null;
let currentAsc = true;
let groupBy = null;
let groupDropdown = null;

if (groupConfig) {
groupDropdown = insertGroupDropdown(table, groupConfig, (val) => {
groupBy = val;
renderRows(data);
});
}

function renderRows(sorted) {
tbody.innerHTML = "";
const cols = thead.querySelectorAll("th");

if (groupBy) {
const result = groupData(sorted, groupBy, groupConfig.numericFields, groupConfig.averageFields);

let groupRows = result.rows;
if (currentSort) {
groupRows = [...groupRows].sort((a, b) => {
const va = a[currentSort], vb = b[currentSort];
if (va == null || va === '—') return 1;
if (vb == null || vb === '—') return -1;
if (typeof va === "number" && typeof vb === "number") return currentAsc ? va - vb : vb - va;
return currentAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
});
}

const groupColIndex = Array.from(cols).findIndex(th => th.dataset.sort === groupBy);
const useFirstCol = groupColIndex === -1;

groupRows.forEach(grp => {
const tr = document.createElement("tr");
tr.className = "group-row";
cols.forEach((th, i) => {
const key = th.dataset.sort;
if (!key) return;
const td = document.createElement("td");
if (useFirstCol && i === 0) {
td.textContent = grp._groupKey;
td.style.fontWeight = "600";
} else if (key === groupBy) {
td.textContent = grp._groupKey;
td.style.fontWeight = "600";
} else if ((groupConfig.numericFields || []).includes(key) || (groupConfig.averageFields || []).includes(key)) {
td.textContent = formatVal(key, grp[key] != null ? grp[key] : '—');
td.className = "num";
} else {
td.textContent = '—';
}
tr.appendChild(td);
});
tbody.appendChild(tr);
});

const tr = document.createElement("tr");
tr.className = "total-row";
cols.forEach((th, i) => {
const key = th.dataset.sort;
if (!key) return;
const td = document.createElement("td");
if (useFirstCol && i === 0) {
td.textContent = 'Total';
td.style.fontWeight = "700";
} else if (key === groupBy) {
td.textContent = 'Total';
td.style.fontWeight = "700";
} else if ((groupConfig.numericFields || []).includes(key)) {
td.textContent = formatVal(key, result.totals[key]);
td.className = "num";
} else if ((groupConfig.averageFields || []).includes(key)) {
td.textContent = '—';
td.className = "num";
} else {
td.textContent = '';
}
tr.appendChild(td);
});
tbody.appendChild(tr);

return;
}

sorted.forEach(row => {
const tr = document.createElement("tr");
cols.forEach(th => {
const key = th.dataset.sort;
if (!key) return;
const td = document.createElement("td");
td.className = th.className;
let val = row[key];
if (typeof val === "number") {
td.textContent = formatVal(key, val);
} else if (key === 'reconciled') {
td.textContent = val ? '\u2713' : '\u2717';
} else if (key.endsWith('datetime') && val) {
td.textContent = new Date(val).toLocaleDateString();
} else {
td.textContent = val || "";
}
tr.appendChild(td);
});
tbody.appendChild(tr);
});
}

function sort(key) {
if (currentSort === key) { currentAsc = !currentAsc; }
else { currentSort = key; currentAsc = true; }

if (groupBy) {
renderRows(data);
return;
}

const sorted = [...data].sort((a, b) => {
const va = a[key], vb = b[key];
if (typeof va === "number" && typeof vb === "number") return currentAsc ? va - vb : vb - va;
return currentAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
});
renderRows(sorted);
}

thead.querySelectorAll("th[data-sort]").forEach(th => {
th.addEventListener("click", () => sort(th.dataset.sort));
});

renderRows(data);
}

function renderCashFlowChart(cf) {
  if (cashFlowChart) cashFlowChart.destroy();
  const ctx = document.getElementById("cash-flow-chart").getContext("2d");
  const labels = cf.map(d => d.month);
  cashFlowChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Deposits", data: cf.map(d => d.deposit), backgroundColor: "#7ee787" },
        { label: "Withdrawals", data: cf.map(d => d.withdrawal), backgroundColor: CHART_RED },
        { label: "Dividends", data: cf.map(d => d.dividend), backgroundColor: "#bc8cff" },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "top", labels: { color: "#8b949e" } },
        tooltip: { backgroundColor: "#21262d", titleColor: "#e6edf3", bodyColor: "#e6edf3" },
      },
      scales: {
        x: { stacked: false, ticks: { color: "#8b949e" }, grid: { color: "#21262d" } },
        y: { beginAtZero: true, ticks: { color: "#8b949e" }, grid: { color: "#21262d" } },
      },
    },
  });
}

function renderTransactions(txs) {
const tbody = document.querySelector("#transactions-table tbody");
const filterInput = document.getElementById("tx-filter");
const table = document.getElementById("transactions-table");
const config = TABLE_CONFIGS['transactions-table'];

let groupBy = null;
let groupDropdown = insertGroupDropdown(table, config, (val) => {
groupBy = val;
render(filterInput.value.trim().toLowerCase());
});

function render(filter = "") {
tbody.innerHTML = "";
const filtered = filter
? txs.filter(t => t.symbol?.toLowerCase().includes(filter) || t.name?.toLowerCase().includes(filter))
: txs;

if (groupBy) {
const cols = table.querySelectorAll("thead th");
const result = groupData(filtered, groupBy, config.numericFields);

let groupRows = result.rows;

const groupColIndex = Array.from(cols).findIndex(th => th.dataset.sort === groupBy);
const useFirstCol = groupColIndex === -1;

groupRows.forEach(grp => {
const tr = document.createElement("tr");
tr.className = "group-row";
cols.forEach((th, i) => {
const key = th.dataset.sort;
if (!key) return;
const td = document.createElement("td");
if (useFirstCol && i === 0) {
td.textContent = grp._groupKey;
td.style.fontWeight = "600";
} else if (key === groupBy) {
td.textContent = grp._groupKey;
td.style.fontWeight = "600";
} else if (config.numericFields.includes(key)) {
td.textContent = formatVal(key, grp[key]);
td.className = "num";
} else {
td.textContent = '—';
}
tr.appendChild(td);
});
tbody.appendChild(tr);
});

const tr = document.createElement("tr");
tr.className = "total-row";
cols.forEach((th, i) => {
const key = th.dataset.sort;
if (!key) return;
const td = document.createElement("td");
if (useFirstCol && i === 0) {
td.textContent = 'Total';
td.style.fontWeight = "700";
} else if (key === groupBy) {
td.textContent = 'Total';
td.style.fontWeight = "700";
} else if (config.numericFields.includes(key)) {
td.textContent = formatVal(key, result.totals[key]);
td.className = "num";
} else {
td.textContent = '';
}
tr.appendChild(td);
});
tbody.appendChild(tr);
return;
}

filtered.forEach(t => {
const tr = document.createElement("tr");
tr.innerHTML = `
<td>${new Date(t.datetime).toLocaleDateString()}</td>
<td>${t.type}</td>
<td>${t.name || ""}</td>
<td>${t.symbol || ""}</td>
<td class="num">${formatShares(t.shares)}</td>
<td class="num">${t.price != null ? `\u20AC${t.price.toLocaleString(undefined, {minimumFractionDigits: 2})}` : ""}</td>
<td class="num">${t.amount != null ? `\u20AC${t.amount.toLocaleString(undefined, {minimumFractionDigits: 2})}` : ""}</td>
`;
tbody.appendChild(tr);
});
}

render();
filterInput.addEventListener("input", () => render(filterInput.value.trim().toLowerCase()));
}

let monthlyMonths = [];
let monthlyIndex = 0;

function buildMonths(daily) {
  const byDate = new Map();
  (daily || []).forEach(d => byDate.set(d.date, d.realized_pl));
  const dates = [...byDate.keys()].sort();
  if (!dates.length) return [];
  const first = parseDate(dates[0]);
  const lastDate = parseDate(dates[dates.length - 1]);
  const months = [];
  const cursor = new Date(first.getFullYear(), first.getMonth(), 1);
  while (cursor <= lastDate) {
    const days = [];
    let total = 0;
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const stop = monthEnd < lastDate ? monthEnd : lastDate;
    const day = new Date(cursor);
    while (day <= stop) {
      const key = weekKey(day);
      const pl = byDate.has(key) ? byDate.get(key) : null;
      if (pl != null) total += pl;
      days.push({ date: key, pl });
      day.setDate(day.getDate() + 1);
    }
    months.push({ days, total });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

function renderMonthlyPLChart(daily) {
  monthlyMonths = buildMonths(daily);
  monthlyIndex = monthlyMonths.length ? monthlyMonths.length - 1 : 0;
  drawMonthlyPL();
}

function formatMonthLabel(month) {
  const first = parseDate(month.days[0].date);
  const label = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function monthlyHeatLevel(pl, maxAbs) {
  if (pl == null) return "no-data";
  if (pl === 0 || maxAbs === 0) return "neutral";
  const level = Math.min(4, Math.max(1, Math.ceil(Math.abs(pl) / maxAbs * 4)));
  return `${pl > 0 ? "heat-positive" : "heat-negative"}-${level}`;
}

function formatPLValue(value) {
  return `\u20AC${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function periodPLStats(days) {
  const active = days.filter(day => day.pl != null);
  const total = active.reduce((sum, day) => sum + day.pl, 0);
  return {
    total,
    activeDays: active.length,
    averageActiveDay: active.length ? total / active.length : 0,
    positiveRate: active.length ? active.filter(day => day.pl > 0).length / active.length * 100 : 0,
  };
}

function formatPeriodSummary(label, days) {
  const stats = periodPLStats(days);
  const dayLabel = stats.activeDays === 1 ? "active day" : "active days";
  return `${label} P&L: ${formatPLValue(stats.total)} · Avg/active day: ${formatPLValue(stats.averageActiveDay)} · ${stats.activeDays} ${dayLabel} · ${stats.positiveRate.toFixed(0)}% positive`;
}

function formatMonthlyDayLabel(day) {
  const date = parseDate(day.date);
  const dateLabel = date.toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
  return day.pl == null
    ? `${dateLabel}: No activity`
    : `${dateLabel}: Realized P&L ${formatPLValue(day.pl)}`;
}

function clearMonthlyDayTooltip() {
  const grid = document.getElementById("monthly-pl-grid");
  if (!grid) return;
  grid.querySelectorAll(".pl-day.is-selected").forEach(day => {
    day.classList.remove("is-selected");
    day.removeAttribute("aria-describedby");
  });
  grid.querySelectorAll(".pl-day-tooltip").forEach(tooltip => tooltip.remove());
}

function handleMonthlyGridClick(event) {
  const button = event.target.closest(".pl-day");
  if (!button) return;
  const wasSelected = button.classList.contains("is-selected");
  clearMonthlyDayTooltip();
  if (wasSelected) return;

  const tooltip = document.createElement("span");
  tooltip.className = "pl-day-tooltip";
  tooltip.id = `monthly-pl-tooltip-${button.dataset.date}`;
  tooltip.setAttribute("role", "tooltip");
  tooltip.textContent = button.dataset.pl == null
    ? "No activity"
    : formatPLValue(Number(button.dataset.pl));
  button.classList.add("is-selected");
  button.setAttribute("aria-describedby", tooltip.id);
  button.appendChild(tooltip);

  const statusEl = document.getElementById("monthly-pl-status");
  if (statusEl) statusEl.textContent = button.getAttribute("aria-label");
}

function handleMonthlyOutsideClick(event) {
  if (!event.target.closest("#monthly-pl-grid")) clearMonthlyDayTooltip();
}

function moveMonthlyFocus(cellIndex, delta) {
  const grid = document.getElementById("monthly-pl-grid");
  if (!grid) return;
  const target = grid.querySelector(`[data-cell-index="${cellIndex + delta}"]`);
  if (!target) return;
  grid.querySelectorAll(".pl-day").forEach(day => { day.tabIndex = -1; });
  target.tabIndex = 0;
  target.focus();
}

function handleMonthlyGridKeydown(event) {
  const day = event.target.closest(".pl-day");
  if (!day) return;
  if (event.key === "Escape") {
    clearMonthlyDayTooltip();
    return;
  }
  const cellIndex = Number(day.dataset.cellIndex);
  let delta = 0;
  if (event.key === "ArrowLeft") delta = -1;
  if (event.key === "ArrowRight") delta = 1;
  if (event.key === "ArrowUp") delta = -7;
  if (event.key === "ArrowDown") delta = 7;
  if (event.key === "Home") delta = -(cellIndex % 7);
  if (event.key === "End") delta = 6 - (cellIndex % 7);
  if (delta) {
    event.preventDefault();
    moveMonthlyFocus(cellIndex, delta);
  }
}

function drawMonthlyPL() {
  const labelEl = document.getElementById("month-label");
  const totalEl = document.getElementById("month-total");
  const prevBtn = document.getElementById("month-prev");
  const nextBtn = document.getElementById("month-next");
  const grid = document.getElementById("monthly-pl-grid");
  const statusEl = document.getElementById("monthly-pl-status");
  if (grid && !grid.dataset.keyboardReady) {
    grid.addEventListener("keydown", handleMonthlyGridKeydown);
    grid.addEventListener("click", handleMonthlyGridClick);
    document.addEventListener("click", handleMonthlyOutsideClick);
    grid.dataset.keyboardReady = "true";
  }
  if (!monthlyMonths.length) {
    if (labelEl) labelEl.textContent = "No P/L data yet";
    if (totalEl) totalEl.textContent = "";
    if (grid) grid.replaceChildren();
    if (statusEl) statusEl.textContent = "No realized P/L data yet.";
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }
  const month = monthlyMonths[monthlyIndex];
  const maxAbs = Math.max(0, ...month.days.map(day => Math.abs(day.pl ?? 0)));
  if (labelEl) labelEl.textContent = formatMonthLabel(month);
  if (totalEl) {
    totalEl.textContent = formatPeriodSummary("Month", month.days);
    totalEl.className = month.total >= 0 ? "positive" : "negative";
  }
  if (prevBtn) prevBtn.disabled = monthlyIndex === 0;
  if (nextBtn) nextBtn.disabled = monthlyIndex >= monthlyMonths.length - 1;
  if (!grid) return;

  const firstDay = parseDate(month.days[0].date);
  const leadingCells = (firstDay.getDay() + 6) % 7;
  const rowCount = Math.ceil((leadingCells + month.days.length) / 7);
  grid.replaceChildren();
  let dayIndex = 0;
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const row = document.createElement("div");
    row.className = "pl-heatmap-row";
    row.setAttribute("role", "row");
    for (let columnIndex = 0; columnIndex < 7; columnIndex++) {
      const cellIndex = rowIndex * 7 + columnIndex;
      const isDay = cellIndex >= leadingCells && dayIndex < month.days.length;
      if (!isDay) {
        const empty = document.createElement("span");
        empty.className = "pl-day-empty";
        empty.setAttribute("role", "gridcell");
        empty.setAttribute("aria-hidden", "true");
        row.appendChild(empty);
        continue;
      }
      const day = month.days[dayIndex++];
      const button = document.createElement("button");
      button.type = "button";
      button.className = `pl-day ${monthlyHeatLevel(day.pl, maxAbs)}`;
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-label", formatMonthlyDayLabel(day));
      button.title = formatMonthlyDayLabel(day);
      button.dataset.cellIndex = String(cellIndex);
      button.dataset.date = day.date;
      if (day.pl != null) button.dataset.pl = String(day.pl);
      button.tabIndex = dayIndex === 1 ? 0 : -1;
      button.textContent = String(parseDate(day.date).getDate());
      if (columnIndex < 2) button.classList.add("tooltip-align-start");
      if (columnIndex > 4) button.classList.add("tooltip-align-end");
      row.appendChild(button);
    }
    grid.appendChild(row);
  }
  if (statusEl) statusEl.textContent = `${formatMonthLabel(month)} calendar loaded.`;
}

window.monthlyNav = function (delta) {
  if (!monthlyMonths.length) return;
  monthlyIndex = Math.max(0, Math.min(monthlyMonths.length - 1, monthlyIndex + delta));
  drawMonthlyPL();
};

function renderPLEvolutionChart(monthly) {
  if (plEvolutionChart) plEvolutionChart.destroy();
  const ctx = document.getElementById("pl-evolution-chart").getContext("2d");
  const labels = monthly.map(d => d.month);
  const monthlyVals = monthly.map(d => d.realized_pl);
  let acc = 0;
  const cumulative = monthlyVals.map(v => (acc += v));
  plEvolutionChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Monthly P&L",
          data: monthlyVals,
          backgroundColor: monthlyVals.map(v => v >= 0 ? CHART_GREEN : CHART_RED),
          yAxisID: "y",
        },
        {
          type: "line",
          label: "Cumulative P&L",
          data: cumulative,
          borderColor: CHART_BLUE,
          backgroundColor: CHART_BLUE,
          tension: 0.25,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "top", labels: { color: "#8b949e" } },
        tooltip: { backgroundColor: "#21262d", titleColor: "#e6edf3", bodyColor: "#e6edf3" },
      },
      scales: {
        x: { ticks: { color: "#8b949e" }, grid: { color: "#21262d" } },
        y: { beginAtZero: true, ticks: { color: "#8b949e" }, grid: { color: "#21262d" } },
        y1: { position: "right", ticks: { color: "#8b949e" }, grid: { drawOnChartArea: false } },
      },
    },
  });
}

function projectionCard(label, value, className = "") {
  const card = document.createElement("article");
  card.className = "card";
  const labelEl = document.createElement("div");
  labelEl.className = "label";
  labelEl.textContent = label;
  const valueEl = document.createElement("div");
  valueEl.className = `value ${className}`.trim();
  valueEl.textContent = value;
  card.append(labelEl, valueEl);
  return card;
}

function plClass(value) {
  return value >= 0 ? "positive" : "negative";
}

function renderAnnualPLProjection(projection) {
  const cards = document.getElementById("annual-projection-cards");
  const method = document.getElementById("annual-projection-method");
  if (!cards || !method) return;
  cards.replaceChildren();

  if (!projection) {
    method.textContent = "No realized P&L data is available for the current year yet.";
    return;
  }

  const asOf = parseDate(projection.as_of).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
  method.textContent = `Projection for ${projection.year} based on ${projection.active_days} active days so far and an expected pace of ${projection.active_days_per_week} active days/week (${projection.projected_future_active_days} projected active days remaining), as of ${asOf}.`;
  cards.append(
    projectionCard("YTD realized P&L", formatPLValue(projection.ytd_pl), plClass(projection.ytd_pl)),
    projectionCard("Projected Dec 31", formatPLValue(projection.projected_pl), plClass(projection.projected_pl)),
    projectionCard("Remaining projection", formatPLValue(projection.projected_remaining_pl), plClass(projection.projected_remaining_pl)),
    projectionCard("Avg / active day", formatPLValue(projection.average_active_day), plClass(projection.average_active_day)),
    projectionCard("Future active days", projection.projected_future_active_days.toLocaleString(undefined, { maximumFractionDigits: 1 })),
    projectionCard("Positive active days", `${projection.positive_day_rate.toFixed(1)}% (${projection.positive_days}/${projection.active_days})`),
    projectionCard("Best day", `${formatPLValue(projection.best_day.realized_pl)} · ${parseDate(projection.best_day.date).toLocaleDateString()}`, plClass(projection.best_day.realized_pl)),
    projectionCard("Worst day", `${formatPLValue(projection.worst_day.realized_pl)} · ${parseDate(projection.worst_day.date).toLocaleDateString()}`, plClass(projection.worst_day.realized_pl)),
  );
}

function setConfigStatus(message, isError = false) {
  const status = document.getElementById("config-status");
  if (!status) return;
  status.textContent = message;
  status.className = `config-status${isError ? " error" : ""}`;
}

window.openConfigSettings = function () {
  const dialog = document.getElementById("config-dialog");
  const input = document.getElementById("projection-active-days");
  if (!dialog || !input) return;
  input.value = String(currentUserSettings.projection_active_days_per_week ?? 3);
  setConfigStatus("");
  if (!dialog.open) dialog.showModal();
};

window.saveConfigSettings = async function () {
  const input = document.getElementById("projection-active-days");
  const days = Number(input?.value);
  if (!Number.isInteger(days) || days < 1 || days > 7) {
    setConfigStatus("Choose a whole number from 1 to 7.", true);
    return;
  }
  setConfigStatus("Saving...");
  try {
    const response = await fetch(`${BASE}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...currentUserSettings, projection_active_days_per_week: days }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Could not save settings");
    currentUserSettings = result.settings;
    const projection = await loadJSON(`${BASE}/api/annual_pl_projection`);
    renderAnnualPLProjection(projection);
    setConfigStatus("Settings saved on this device.");
  } catch (error) {
    setConfigStatus(`Save failed: ${error.message}`, true);
  }
};

function downloadConfigFile(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

window.exportConfig = async function () {
  setConfigStatus("Preparing configuration...");
  try {
    const config = await loadJSON(`${BASE}/api/config_export`);
    const text = JSON.stringify(config, null, 2);
    const filename = `klarwert-config-${new Date().toISOString().slice(0, 10)}.json`;
    if (window.KlarwertNative?.isNative) {
      await window.KlarwertNative.shareFile(filename, text);
    } else {
      downloadConfigFile(filename, text);
    }
    setConfigStatus("Configuration exported. Keep the file somewhere safe.");
  } catch (error) {
    setConfigStatus(`Export failed: ${error.message}`, true);
  }
};

async function importConfigText(text) {
  setConfigStatus("Importing configuration...");
  const response = await fetch(`${BASE}/api/config_import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: text,
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Could not import configuration");
  currentUserSettings = result.settings;
  const input = document.getElementById("projection-active-days");
  if (input) input.value = String(currentUserSettings.projection_active_days_per_week);
  await loadAllData();
  setConfigStatus(`Configuration imported: ${result.card_rules.length} card category rules restored.`);
}

window.importConfig = async function () {
  if (window.KlarwertNative?.isNative) {
    try {
      const picked = await window.KlarwertNative.pickConfig();
      if (picked) await importConfigText(picked.content);
    } catch (error) {
      setConfigStatus(`Import failed: ${error.message}`, true);
    }
    return;
  }
  document.getElementById("config-input")?.click();
};

window.handleConfigFile = async function (input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    await importConfigText(await file.text());
  } catch (error) {
    setConfigStatus(`Import failed: ${error.message}`, true);
  } finally {
    input.value = "";
  }
};

let weeklyWeeks = [];
let weeklyIndex = 0;

function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function weekKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
  d.setDate(d.getDate() + diff);
  return d;
}

function buildWeeks(daily) {
  const byDate = new Map();
  (daily || []).forEach(d => byDate.set(d.date, d.realized_pl));
  const dates = [...byDate.keys()].sort();
  if (!dates.length) return [];
  const weeks = [];
  const cursor = startOfWeek(parseDate(dates[0]));
  const lastDate = parseDate(dates[dates.length - 1]);
  while (cursor <= lastDate) {
    const days = [];
    let total = 0;
    for (let i = 0; i < 7; i++) {
      const key = weekKey(cursor);
      const pl = byDate.has(key) ? byDate.get(key) : null;
      if (pl != null) total += pl;
      days.push({ date: key, pl });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push({ days, total });
  }
  return weeks;
}

function renderWeeklyPLChart(daily) {
  weeklyWeeks = buildWeeks(daily);
  weeklyIndex = weeklyWeeks.length ? weeklyWeeks.length - 1 : 0;
  drawWeeklyPL();
}

function formatWeekLabel(week) {
  const first = parseDate(week.days[0].date);
  const last = parseDate(week.days[6].date);
  const fmt = d => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fmt(first)} - ${fmt(last)}, ${last.getFullYear()}`;
}

function drawWeeklyPL() {
  const ctx = document.getElementById("weekly-pl-chart").getContext("2d");
  const labelEl = document.getElementById("week-label");
  const totalEl = document.getElementById("week-total");
  const prevBtn = document.getElementById("week-prev");
  const nextBtn = document.getElementById("week-next");
  if (weeklyPLChart) weeklyPLChart.destroy();
  weeklyPLChart = null;
  if (!weeklyWeeks.length) {
    if (labelEl) labelEl.textContent = "No P/L data yet";
    if (totalEl) totalEl.textContent = "";
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }
  const week = weeklyWeeks[weeklyIndex];
  const labels = week.days.map(d => parseDate(d.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric" }));
  const values = week.days.map(d => d.pl);
  if (labelEl) labelEl.textContent = formatWeekLabel(week);
  if (totalEl) {
    totalEl.textContent = formatPeriodSummary("Week", week.days);
    totalEl.className = week.total >= 0 ? "positive" : "negative";
  }
  if (prevBtn) prevBtn.disabled = weeklyIndex === 0;
  if (nextBtn) nextBtn.disabled = weeklyIndex >= weeklyWeeks.length - 1;

  weeklyPLChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Realized P&L",
        data: values,
        backgroundColor: values.map(v => v == null ? "#30363d" : (v >= 0 ? CHART_GREEN : CHART_RED)),
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#21262d", titleColor: "#e6edf3", bodyColor: "#e6edf3",
          callbacks: {
            title: (items) => {
              const i = items[0].dataIndex;
              return week.days[i].date;
            },
            label: (c) => {
              const d = week.days[c.dataIndex];
              return d.pl == null
                ? "No activity"
                : `\u20AC${d.pl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: "#8b949e" }, grid: { color: "#21262d" } },
        y: { beginAtZero: true, ticks: { color: "#8b949e" }, grid: { color: "#21262d" } },
      },
    },
  });
}

window.weeklyNav = function (delta) {
  if (!weeklyWeeks.length) return;
  weeklyIndex = Math.max(0, Math.min(weeklyWeeks.length - 1, weeklyIndex + delta));
  drawWeeklyPL();
};

function renderAllocationChart(openPositions) {
  if (allocationChart) allocationChart.destroy();
  const ctx = document.getElementById("allocation-chart").getContext("2d");
  const open = openPositions.filter(p => p.total_cost > 0);
  allocationChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: open.map(p => p.name),
      datasets: [{
        data: open.map(p => p.total_cost),
        backgroundColor: open.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "right", labels: { color: "#8b949e" } },
        tooltip: { backgroundColor: "#21262d", titleColor: "#e6edf3", bodyColor: "#e6edf3" },
      },
    },
  });
}



function renderDividendChart(products) {
  if (dividendChart) dividendChart.destroy();
  const ctx = document.getElementById("dividend-chart").getContext("2d");
  const withDividends = products.filter(p => p.total_dividends > 0).sort((a, b) => b.total_dividends - a.total_dividends);
  const barColors = withDividends.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);
  dividendChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: withDividends.map(p => p.name),
      datasets: [{
        label: "Dividends",
        data: withDividends.map(p => p.total_dividends),
        backgroundColor: barColors,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: "#21262d", titleColor: "#e6edf3", bodyColor: "#e6edf3" },
      },
      scales: {
        x: { beginAtZero: true, ticks: { color: "#8b949e" }, grid: { color: "#21262d" } },
        y: { ticks: { color: "#8b949e" }, grid: { color: "#21262d" } },
      },
    },
  });
}

function renderIncomeChart(monthly) {
  if (incomeChart) incomeChart.destroy();
  const ctx = document.getElementById("income-chart").getContext("2d");
  incomeChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: monthly.map(d => d.month),
      datasets: [
        { label: "Dividends (net)", data: monthly.map(d => d.dividends), backgroundColor: "#bc8cff" },
        { label: "Interest", data: monthly.map(d => d.interest), backgroundColor: "#7ee787" },
        { label: "Saveback", data: monthly.map(d => d.saveback), backgroundColor: "#58a6ff" },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "top", labels: { color: "#8b949e" } },
        tooltip: { backgroundColor: "#21262d", titleColor: "#e6edf3", bodyColor: "#e6edf3" },
      },
      scales: {
        x: { stacked: true, ticks: { color: "#8b949e" }, grid: { color: "#21262d" } },
        y: { stacked: true, beginAtZero: true, ticks: { color: "#8b949e" }, grid: { color: "#21262d" } },
      },
    },
  });
}

function renderSpendingCharts(spending) {
  if (spendingCatChart) spendingCatChart.destroy();
  const catCtx = document.getElementById("spending-category-chart").getContext("2d");
  const cats = spending.by_category || [];
  spendingCatChart = new Chart(catCtx, {
    type: "doughnut",
    data: {
      labels: cats.map(c => c.category),
      datasets: [{
        data: cats.map(c => c.total),
        backgroundColor: cats.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "right", labels: { color: "#8b949e" } },
        tooltip: { backgroundColor: "#21262d", titleColor: "#e6edf3", bodyColor: "#e6edf3" },
      },
    },
  });
  if (spendingMonthChart) spendingMonthChart.destroy();
  const monCtx = document.getElementById("spending-monthly-chart").getContext("2d");
  const months = spending.monthly || [];
  spendingMonthChart = new Chart(monCtx, {
    type: "bar",
    data: {
      labels: months.map(m => m.month),
      datasets: [{ label: "Card Spending", data: months.map(m => m.total), backgroundColor: CHART_BLUE }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: "#21262d", titleColor: "#e6edf3", bodyColor: "#e6edf3" },
      },
      scales: {
        x: { ticks: { color: "#8b949e" }, grid: { color: "#21262d" } },
        y: { beginAtZero: true, ticks: { color: "#8b949e" }, grid: { color: "#21262d" } },
      },
    },
  });
}

async function saveRule(pattern, category) {
  await fetch(`${BASE}/api/card_rules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pattern, category }),
  });
}

async function deleteRule(pattern) {
  await fetch(`${BASE}/api/card_rules`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pattern }),
  });
}

function renderCardRules(data) {
  const uncatBody = document.querySelector("#uncategorized-vendors-table tbody");
  uncatBody.innerHTML = "";
  const vendors = data.uncategorized_vendors || [];
  if (vendors.length === 0) {
    const tr = document.createElement("tr");
    tr.className = "empty-rules-row";
    tr.innerHTML = '<td colspan="5">No uncategorized merchants \u2014 all spending is categorized.</td>';
    uncatBody.appendChild(tr);
  }
  vendors.forEach(v => {
    const tr = document.createElement("tr");
    const patternInput = document.createElement("input");
    patternInput.type = "text";
    patternInput.value = v.name;
    patternInput.title = "Substring matched against merchant names";
    const categoryInput = document.createElement("input");
    categoryInput.type = "text";
    categoryInput.placeholder = "category";
    const save = document.createElement("button");
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      await saveRule(patternInput.value, categoryInput.value);
      await loadAllData();
    });
    const tdPattern = document.createElement("td");
    tdPattern.appendChild(patternInput);
    const tdTxns = document.createElement("td");
    tdTxns.className = "num";
    tdTxns.textContent = v.count;
    const tdTotal = document.createElement("td");
    tdTotal.className = "num";
    tdTotal.textContent = v.total != null ? v.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
    const tdCat = document.createElement("td");
    tdCat.appendChild(categoryInput);
    const tdBtn = document.createElement("td");
    tdBtn.appendChild(save);
    tr.appendChild(tdPattern);
    tr.appendChild(tdTxns);
    tr.appendChild(tdTotal);
    tr.appendChild(tdCat);
    tr.appendChild(tdBtn);
    uncatBody.appendChild(tr);
  });

  const rulesBody = document.querySelector("#card-rules-table tbody");
  rulesBody.innerHTML = "";
  const rules = data.rules || [];
  if (rules.length === 0) {
    const tr = document.createElement("tr");
    tr.className = "empty-rules-row";
    tr.innerHTML = '<td colspan="3">No rules yet \u2014 add one from the uncategorized vendors above.</td>';
    rulesBody.appendChild(tr);
  }
  rules.forEach(r => {
    const tr = document.createElement("tr");
    const patternInput = document.createElement("input");
    patternInput.type = "text";
    patternInput.value = r.pattern;
    const categoryInput = document.createElement("input");
    categoryInput.type = "text";
    categoryInput.value = r.category;
    const save = document.createElement("button");
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      await saveRule(patternInput.value, categoryInput.value);
      await loadAllData();
    });
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.addEventListener("click", async () => {
      await deleteRule(patternInput.value);
      await loadAllData();
    });
    const tdPattern = document.createElement("td");
    tdPattern.appendChild(patternInput);
    const tdCat = document.createElement("td");
    tdCat.appendChild(categoryInput);
    const tdBtns = document.createElement("td");
    tdBtns.appendChild(save);
    tdBtns.appendChild(del);
    tr.appendChild(tdPattern);
    tr.appendChild(tdCat);
    tr.appendChild(tdBtns);
    rulesBody.appendChild(tr);
  });
}

let lastTaxReport = null;
let taxReportGeneration = 0;

function invalidateTaxReport() {
  lastTaxReport = null;
  taxReportGeneration += 1;
  const button = document.getElementById("tax-csv-btn");
  if (button) button.disabled = true;
  for (const id of ["tax-disposals-table", "tax-income-table"]) {
    const tbody = document.querySelector(`#${id} tbody`);
    if (tbody) tbody.innerHTML = "";
  }
  const status = document.getElementById("tax-status");
  if (status) status.textContent = "Load a report for the current portfolio before exporting.";
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function taxIncomeRows(report) {
  const dividends = report.dividend_totals;
  const interest = report.interest_totals || { gross: report.interest, wht: 0, fees: 0, net: report.interest };
  const saveback = report.saveback_totals || { gross: report.saveback, wht: 0, fees: 0, net: report.saveback };
  return [
    ["Dividends", dividends.gross, dividends.wht, dividends.fees || 0, dividends.net],
    ["Interest", interest.gross, interest.wht, interest.fees, interest.net],
    ["Saveback", saveback.gross, saveback.wht, saveback.fees, saveback.net],
  ];
}

window.loadTaxReport = async function () {
const yearInput = document.getElementById("tax-year");
if (!yearInput.value) yearInput.value = new Date().getFullYear();
invalidateTaxReport();
const generation = taxReportGeneration;
const status = document.getElementById("tax-status");
try {
const report = await loadJSON(`${BASE}/api/tax_report?year=${yearInput.value}`);
if (generation !== taxReportGeneration) return;
lastTaxReport = report;
renderTable("tax-disposals-table", report.disposals, null);
const tbody = document.querySelector("#tax-income-table tbody");
tbody.innerHTML = "";
const eur = v => Number.isFinite(v) ? `\u20AC${v.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : "N/A";
taxIncomeRows(report).forEach(([label, g, w, f, n]) => {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td>${label}</td><td class="num">${eur(g)}</td><td class="num">${eur(w)}</td><td class="num">${eur(f)}</td><td class="num">${eur(n)}</td>`;
  tbody.appendChild(tr);
});
const button = document.getElementById("tax-csv-btn");
if (button) button.disabled = false;
if (status) status.textContent = `Report for ${report.year} loaded.`;
} catch (error) {
  if (generation === taxReportGeneration && status) status.textContent = `Could not load report: ${error.message}`;
}
};

window.downloadTaxCsv = async function () {
if (!lastTaxReport) return;
const lines = ["date;name;isin;shares;proceeds;cost_basis;fees;gain;acquired"];
lastTaxReport.disposals.forEach(d => {
  lines.push([d.date, d.name, d.isin, d.shares, d.proceeds, d.cost_basis, d.fees, d.gain, d.acquired].map(csvCell).join(";"));
});
lines.push("");
lines.push("type;gross;wht;fees;net");
taxIncomeRows(lastTaxReport).forEach(([label, ...values]) => {
  lines.push([label.toLowerCase(), ...values].map(csvCell).join(";"));
});
const text = lines.join("\r\n");
const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
if (window.KlarwertNative && window.KlarwertNative.isNative) {
  await window.KlarwertNative.shareFile(`tax_report_${lastTaxReport.year}.csv`, text);
  return;
}
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = `tax_report_${lastTaxReport.year}.csv`;
a.click();
};

function renderValuedCards(totals, positions) {
const container = document.getElementById("summary-cards");
const eur = v => Number.isFinite(v) ? `\u20AC${v.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : "N/A";
const top5 = (positions || [])
  .map(p => p.weight || 0)
  .sort((a, b) => b - a)
  .slice(0, 5)
  .reduce((a, b) => a + b, 0);
[
  { label: "Est. Market Value", value: eur(totals.market_value) },
  { label: "Unrealized P&L", value: eur(totals.unrealized_pl), cls: totals.unrealized_pl == null ? "" : totals.unrealized_pl >= 0 ? "positive" : "negative" },
  { label: "Quote coverage", value: `${totals.priced_positions ?? positions.filter(p => p.market_price != null).length}/${totals.total_positions ?? positions.length} positions` },
  { label: "Top 5 Concentration", value: `${(top5 * 100).toFixed(1)}%` },
].forEach(c => {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `<div class="label">${c.label}</div><div class="value ${c.cls || ""}">${c.value}</div>`;
  container.appendChild(div);
});
if (totals.market_value == null && (totals.priced_positions || 0) > 0) {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `<div class="label">Quoted positions subtotal</div><div class="value">${eur(totals.quoted_market_value)}</div>`;
  container.appendChild(div);
}
}

function renderPriceInputs(positions) {
const container = document.getElementById("price-inputs");
container.innerHTML = "";
positions.forEach(p => {
  const row = document.createElement("div");
  row.style.marginBottom = "6px";
   const label = document.createElement("span");
   label.style.cssText = "display:inline-block; width:320px;";
   label.textContent = `${p.name} (${p.isin})`;
   if (p.market_price != null) label.title = p.quoted_at ? `Saved quote: ${new Date(p.quoted_at).toLocaleString()}` : "Saved quote date unavailable; update the price for a current estimate.";
   row.appendChild(label);
  const input = document.createElement("input");
  input.type = "number";
  input.step = "0.0001";
  input.min = "0";
  input.placeholder = "price";
  if (p.market_price != null) input.value = p.market_price;
  input.addEventListener("change", async () => {
    const price = input.value === "" ? null : Number(input.value);
    const status = document.getElementById("price-status");
    if (!input.checkValidity() || (price !== null && (!Number.isFinite(price) || price < 0))) {
      if (status) status.textContent = "Price must be a finite, non-negative number.";
      input.reportValidity();
      return;
    }
    try {
    const response = await fetch(`${BASE}/api/prices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isin: p.isin, price }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Could not save price");
    await loadAllData();
    if (status) status.textContent = "Price saved.";
    } catch (error) {
      if (status) status.textContent = error.message;
    }
  });
  row.appendChild(input);
  container.appendChild(row);
});
const btn = document.getElementById("refresh-prices-btn");
if (btn) {
  btn.style.display = positions.length ? "" : "none";
  fetch(`${BASE}/api/refresh_status`).then(r => r.json()).then(s => {
    if (s.enabled === false) {
      btn.disabled = true;
      btn.title = "No Finnhub API key configured (set FINNHUB_API_KEY in .env)";
    }
  }).catch(() => {});
}
}

window.refreshPrices = async function () {
  const btn = document.getElementById("refresh-prices-btn");
  const status = document.getElementById("price-status");
  btn.disabled = true;
  status.textContent = "Fetching...";
  let keepDisabled = false;
  try {
    const r = await fetch(`${BASE}/api/refresh_prices`, { method: "POST" });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      status.textContent = `Failed: ${err.error || ("HTTP " + r.status)}`;
      return;
    }
    const data = await r.json();
    if (data.enabled === false) {
      keepDisabled = true;
      status.textContent = "Live prices disabled: no Finnhub API key configured.";
      return;
    }
    const updated = data.prices || {};
    const updatedCount = Object.keys(updated).length;
    const skipped = data.skipped || [];
    await loadAllData();
    if (updatedCount === 0 && skipped.length === 0) {
      status.textContent = "No open positions to price.";
      return;
    }
    const reasons = {};
    skipped.forEach(s => { reasons[s.reason] = (reasons[s.reason] || 0) + 1; });
    const reasonText = Object.keys(reasons)
      .map(r => `${reasons[r]} ${r.replace(/_/g, " ")}`)
      .join(", ");
    const statusText = `Updated ${updatedCount} price${updatedCount === 1 ? "" : "s"}.` +
      (reasonText ? ` Skipped: ${reasonText}.` : "");
    status.textContent = statusText;
    const detail = skipped.filter(s => s.message && s.reason !== "manual")
      .map(s => `${s.isin}: ${s.message}`).join(" | ");
    if (detail) console.warn("Price refresh details:", detail);
  } catch (e) {
    status.textContent = "Failed to fetch prices.";
  } finally {
    if (!keepDisabled) {
      btn.disabled = false;
    }
  }
};

const GROUP_STATE_KEY = "klarwert-dash-groups";

window.saveFinnhubKey = async function () {
  const input = document.getElementById("finnhub-key");
  const status = document.getElementById("finnhub-status");
  await fetch(`${BASE}/api/finnhub_key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: input.value }),
  });
  status.textContent = "Saved.";
  setTimeout(() => status.textContent = "", 2000);
  updateRefreshStatus();
};

function updateRefreshStatus() {
  const btn = document.getElementById("refresh-prices-btn");
  fetch(`${BASE}/api/refresh_status`).then(r => r.json()).then(s => {
    if (!btn) return;
    if (s.enabled === false) {
      btn.disabled = true;
      btn.title = "No Finnhub API key configured";
    } else {
      btn.disabled = false;
      btn.removeAttribute("title");
    }
  }).catch(() => {});
}

(async () => {
  try {
    const r = await fetch(`${BASE}/api/finnhub_key`);
    const data = await r.json();
    const input = document.getElementById("finnhub-key");
    if (input && data.key) input.value = data.key;
    updateRefreshStatus();
  } catch (e) {}
})();

function resizeAllCharts() {
  resultsState.curve?.resize(); resultsState.bars?.resize();
  [cashFlowChart, weeklyPLChart, plEvolutionChart,
   allocationChart, dividendChart, incomeChart, spendingCatChart, spendingMonthChart]
    .forEach(c => { if (c) c.resize(); });
}

// Chart.js observes normal resizes, but some Capacitor WebViews only emit
// orientationchange while rotating. Resize after the viewport has settled so
// charts in every dashboard group use the new width and height.
let chartResizeFrame = 0;
function scheduleChartResize() {
  if (chartResizeFrame) return;
  chartResizeFrame = window.requestAnimationFrame(() => {
    chartResizeFrame = 0;
    resizeAllCharts();
  });
}
window.addEventListener("resize", scheduleChartResize, { passive: true });
window.addEventListener("orientationchange", scheduleChartResize, { passive: true });
document.getElementById("tax-year")?.addEventListener("input", invalidateTaxReport);

function saveDashGroups() {
  const state = {};
  document.querySelectorAll(".dash-group").forEach(g => { state[g.id] = g.open; });
  try { localStorage.setItem(GROUP_STATE_KEY, JSON.stringify(state)); } catch (e) {}
}

function initDashGroups() {
  const groups = document.querySelectorAll(".dash-group");
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(GROUP_STATE_KEY) || "null"); } catch (e) {}
  groups.forEach(g => {
    if (saved && typeof saved[g.id] === "boolean") g.open = saved[g.id];
    if (g.id === 'group-overview') g.open = false;
    g.addEventListener("toggle", () => { resizeAllCharts(); saveDashGroups(); });
  });
  const expandAll = document.getElementById("expand-all-btn");
  const collapseAll = document.getElementById("collapse-all-btn");
  if (expandAll) expandAll.addEventListener("click", () => {
    groups.forEach(g => { g.open = true; });
    resizeAllCharts();
  });
  if (collapseAll) collapseAll.addEventListener("click", () => {
    groups.forEach(g => { g.open = false; });
  });
}

// A common immutable analysis snapshot drives every results consultation surface.
const resultsState = { analysis: null, generation: 0, historyGeneration: 0, page: 1, day: null, month: null, curve: null, bars: null };
const resultsEl = id => document.getElementById(`results-${id}`);
const resultsMoney = value => value == null ? 'Unavailable' : new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value);
const resultsTone = value => value == null ? 'result-unavailable' : value > 0 ? 'result-positive' : value < 0 ? 'result-negative' : 'result-zero';
const resultsDate = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
function resultsPeriodQuery() {
  const choice = resultsEl('period').value;
  if (choice === 'all') return new URLSearchParams();
  const today = new Date(), start = new Date(today);
  if (choice === 'week') start.setDate(start.getDate() - (start.getDay()+6)%7);
  if (choice === 'month') start.setDate(1);
  if (choice === 'year') start.setMonth(0,1);
  const from = choice === 'custom' ? resultsEl('start').value : resultsDate(start);
  const to = choice === 'custom' ? resultsEl('end').value : resultsDate(today);
  if (!from || !to || from > to) throw new Error('Choose a valid inclusive date range.');
  return new URLSearchParams({start: from, end: to});
}
function resultsSnapshotQuery(analysis = resultsState.analysis) {
  return new URLSearchParams({...analysis.period, revision: analysis.revision});
}
function invalidateResults() {
  resultsState.generation++; resultsState.historyGeneration++; resultsState.analysis = null;
  resultsEl('csv').disabled = true;
  setPdfExportAvailability(false);
  resultsEl('cards').replaceChildren(); resultsEl('history').replaceChildren();
  resultsEl('calendar').replaceChildren(); resultsEl('projection').replaceChildren();
  resultsState.curve?.destroy(); resultsState.bars?.destroy(); resultsState.curve = resultsState.bars = null;
  if (resultsEl('detail').open) resultsEl('detail').close();
}
async function loadResults() {
  let query;
  try { query = resultsPeriodQuery(); } catch(e) { resultsEl('status').textContent = e.message; return; }
  invalidateResults();
  const generation = resultsState.generation;
  resultsEl('status').textContent = 'Loading results…';
  try {
    const analysis = await loadJSON(`${BASE}/api/results?${query}`);
    if (generation !== resultsState.generation) return;
    resultsState.analysis = analysis; resultsState.page = 1; resultsState.day = null;
    resultsState.month = analysis.period.end.slice(0,7);
    resultsEl('start').value = analysis.period.start; resultsEl('end').value = analysis.period.end;
    resultsEl('status').textContent = `${analysis.period.start} – ${analysis.period.end} · revision ${analysis.revision}`;
    resultsEl('coverage').textContent = `First movement: ${analysis.coverage.first_movement || 'unavailable'} · Last imported movement: ${analysis.coverage.last_movement || 'unavailable'}. ${analysis.coverage.warning || 'Movement dates do not prove complete statement coverage.'}`;
    const m = analysis.metrics;
    resultsEl('cards').replaceChildren();
    for (const [label,value] of [['Known net realized P&L',resultsMoney(m.net_result)],['Operations with result',`${m.operations} (${m.valid_operations} valid)`],['Win rate',m.win_rate == null ? 'Unavailable' : `${(m.win_rate*100).toFixed(1)}%`],['Average net result',resultsMoney(m.average_result)],['Cost quality',`${m.incomplete_operations} incomplete`],['Dividends',resultsMoney(analysis.income.dividends)],['Interest',resultsMoney(analysis.income.interest)]]) {
      const card = document.createElement('div'); card.className = 'card' + (label === 'Known net realized P&L' ? ' results-net' : '');
      const title = document.createElement('div'); title.className = 'label'; title.textContent = label;
      const val = document.createElement('div'); val.className = 'value ' + (label === 'Known net realized P&L' ? resultsTone(m.net_result) : label === 'Average net result' ? resultsTone(m.average_result) : label === 'Cost quality' && m.incomplete_operations ? 'result-warning' : ''); val.textContent = value; card.append(title,val); resultsEl('cards').append(card);
    }
    const prev = analysis.previous;
    resultsEl('comparison').textContent = prev ? `Previous period ${prev.period.start} – ${prev.period.end}: ${resultsMoney(prev.net_result)}. ${prev.comparable ? `Change ${resultsMoney(m.net_result-prev.net_result)}.` : 'Coverage does not support a complete comparison.'}` : 'No comparable previous period.';
    renderResultsCharts(); renderResultsCalendar(); await loadResultsHistory();
    if (generation !== resultsState.generation) return;
    resultsEl('csv').disabled = false; setPdfExportAvailability(true);
    const projection = await loadJSON(`${BASE}/api/automatic_projection?revision=${encodeURIComponent(analysis.revision)}`);
    if (generation === resultsState.generation) renderResultsProjection(projection);
  } catch(e) { if (generation === resultsState.generation) resultsEl('status').textContent = `Results unavailable: ${e.message}`; }
}
function renderResultsCharts() {
  const a = resultsState.analysis; if (!a || typeof Chart === 'undefined') return;
  resultsState.curve?.destroy(); resultsState.bars?.destroy();
  resultsState.curve = new Chart(resultsEl('curve'), {type:'line',data:{labels:[a.period.start,...a.daily.map(d=>d.date)],datasets:[{label:'Cumulative known net realized EUR',data:[0,...a.daily.map(d=>d.cumulative)],borderColor:CHART_BLUE,pointRadius:0}]},options:{responsive:true,maintainAspectRatio:false}});
  const grouped = new Map();
  for (const d of a.daily) {
    let key = d.date;
    if (resultsEl('aggregation').value === 'month') key = key.slice(0,7);
    if (resultsEl('aggregation').value === 'week') { const date = new Date(`${key}T12:00:00`); date.setDate(date.getDate()-(date.getDay()+6)%7); key=resultsDate(date); }
    grouped.set(key,(grouped.get(key)||0)+d.net_result);
  }
  resultsState.bars = new Chart(resultsEl('bars'),{type:'bar',data:{labels:[...grouped.keys()],datasets:[{label:'Known net realized EUR',data:[...grouped.values()],backgroundColor:[...grouped.values()].map(v=>v<0?CHART_RED:CHART_GREEN)}]},options:{responsive:true,maintainAspectRatio:false}});
}
function renderResultsCalendar() {
  const a=resultsState.analysis; if(!a)return;
  const [year,month]=resultsState.month.split('-').map(Number), days=new Date(year,month,0).getDate();
  resultsEl('month').textContent=resultsState.month; const grid=resultsEl('calendar'); grid.replaceChildren();
  const offset=(new Date(year,month-1,1).getDay()+6)%7;
  for(let i=0;i<offset;i++)grid.append(document.createElement('span'));
  const daily=new Map(a.daily.map(d=>[d.date,d]));
  const peak=Math.max(0,...a.daily.filter(d=>d.date.startsWith(resultsState.month)).map(d=>Math.abs(d.net_result || 0))) || 1;
  for(let i=1;i<=days;i++) {
    const date=`${resultsState.month}-${String(i).padStart(2,'0')}`, day=daily.get(date), button=document.createElement('button');
    button.type='button'; button.disabled=date<a.period.start||date>a.period.end;
    const value=day?.net_result || 0;
    button.className='results-day ' + (!day?.operations ? 'no-data' : value === 0 ? 'realized-zero' : value > 0 ? 'heat-positive' : 'heat-negative') + (day?.incomplete ? ' cost-incomplete' : '') + (resultsState.day === date ? ' is-selected' : '');
    button.style.setProperty('--heat', String(12 + 65 * Math.abs(value) / peak));
    button.setAttribute('aria-pressed',String(resultsState.day === date));
    const number=document.createElement('span');number.className='results-day-number';number.textContent=String(i);
    const amount=document.createElement('span');amount.className='results-day-value';amount.textContent=day?.operations ? resultsMoney(day.net_result).replace('€','') : '—';
    amount.style.setProperty('--digits',String(amount.textContent.length));
    const count=document.createElement('span');count.className='results-day-count';count.textContent=`${day?.operations||0} ops${day?.incomplete?' ?':''}`;
    button.append(number,amount,count);
    button.setAttribute('aria-label',`${date}, ${day?.operations||0} realizations, ${day?.operations?resultsMoney(day.net_result):'no realizations'}, ${day?.incomplete||0} incomplete`);
    button.addEventListener('click',()=>{resultsState.day=date;resultsState.page=1;resultsEl('history-kind').value='realizations';renderResultsCalendar();loadResultsHistory();resultsEl('history').tabIndex=-1;resultsEl('history').focus();}); grid.append(button);
  }
}
async function loadResultsHistory() {
  const a=resultsState.analysis; if(!a)return;
  const generation=++resultsState.historyGeneration, query=resultsSnapshotQuery(a), kind=resultsEl('history-kind').value;
  if(resultsState.day){query.set('start',resultsState.day);query.set('end',resultsState.day);}
  query.set('search',resultsEl('search').value);query.set('page',String(resultsState.page));query.set('page_size','20');
  resultsEl('history-count').textContent='Loading history…';
  try {
    const page=await loadJSON(`${BASE}/api/${kind}?${query}`);
    if(generation!==resultsState.historyGeneration||a!==resultsState.analysis||page.revision!==a.revision)return;
    resultsState.page=page.page;resultsEl('page').textContent=`${page.page} / ${Math.max(page.pages,1)}`;
    resultsEl('page-prev').disabled=page.page<=1;resultsEl('page-next').disabled=page.page>=page.pages;
    resultsEl('history-count').textContent=`${page.total} ${kind}${resultsState.day?` on ${resultsState.day}`:''}`;
    const list=resultsEl('history');list.replaceChildren();
    if(!page.items.length)list.textContent='No matching movements or realizations.';
    for(const item of page.items) {
      const entry=document.createElement('div');entry.className='results-entry';
      const title=document.createElement(kind==='realizations'?'button':'span');title.textContent=`${item.date} · ${item.name||item.description||item.type} · ${item.isin||item.symbol||''}`;
      if(kind==='realizations')title.addEventListener('click',()=>openResultsDetail(item,title));
      const value=document.createElement('span');value.className='results-entry-value ' + resultsTone(kind==='realizations'?item.net_result:item.amount);value.textContent=kind==='realizations'?`${resultsMoney(item.net_result)}${item.cost_quality==='unknown'?' · incomplete':''}`:resultsMoney(item.amount);
      entry.append(title,value);list.append(entry);
    }
  }catch(e){if(generation===resultsState.historyGeneration)resultsEl('history-count').textContent=`History unavailable: ${e.message}`;}
}
function openResultsDetail(item, trigger) {
  const body=resultsEl('detail-body');body.replaceChildren();const dl=document.createElement('dl');
  for(const [label,value] of [['Product',item.name],['ISIN',item.isin],['Net result',resultsMoney(item.net_result)],['Known matched subtotal',resultsMoney(item.known_net_result)],['Cost quality',item.cost_quality],['Unmatched shares',item.unmatched_shares],['Shares',item.shares],['Gross proceeds',resultsMoney(item.gross_proceeds)],['Gross acquisition cost',resultsMoney(item.gross_cost)],['Acquisition charges',resultsMoney(item.acquisition_charges)],['Exit charges',resultsMoney(item.exit_charges)],['Gross result',resultsMoney(item.gross_result)],['Statement date',item.date]]) {
    const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value??'—');
    if(['Gross result','Net result','Known matched subtotal'].includes(label))dd.className=resultsTone(label==='Net result'?item.net_result:label==='Gross result'?item.gross_result:item.known_net_result);
    if(label==='Net result'){dt.className='results-detail-net';dd.className+=' results-detail-net';}
    if(label==='Cost quality' && item.cost_quality==='unknown')dd.className='result-warning';dl.append(dt,dd);
  }body.append(dl);
  const heading=document.createElement('h4');heading.textContent='FIFO acquisition lots';body.append(heading);
  for(const lot of item.lots){const p=document.createElement('p');p.className='results-lot';p.textContent=`${lot.lot_datetime} · ${lot.shares} shares · cost ${resultsMoney(lot.cost_basis)} · proceeds ${resultsMoney(lot.proceeds)}`;body.append(p);}
  const audit=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Statement identities & timestamp';audit.append(summary);
  for(const [label,value] of [['Timestamp',item.datetime],['Movement identity',item.movement_id],['Broker transaction',item.transaction_id],['Event',item.kind]]){const p=document.createElement('p');p.textContent=`${label}: ${value??'—'}`;audit.append(p);}body.append(audit);
  resultsEl('detail').showModal();resultsEl('detail').addEventListener('close',()=>trigger.focus(),{once:true});
}
function renderResultsProjection(data) {
  const root=resultsEl('projection');root.replaceChildren();
  let target=root;
  const paragraph = text => { const p=document.createElement('p');p.textContent=text;target.append(p); };
  if (!data?.historical) { paragraph('No imported observation window is available.');return; }
  paragraph(`Reference: last imported movement ${data.as_of}. ${data.coverage_assumption}`);
  for (const [label,scenario] of [['Available year history',data.historical],['Recent window (up to 60 days)',data.recent]]) {
    const card=document.createElement('article');card.className='results-projection-card';root.append(card);target=card;
    const heading=document.createElement('h4');heading.textContent=label;card.append(heading);
    const labelEl=document.createElement('div');labelEl.className='label';labelEl.textContent=scenario.status==='closed_year'?'Annual observed result':'Annual observed + extrapolated';card.append(labelEl);
    const value=document.createElement('div');value.className='value '+resultsTone(scenario.projected_pl);value.textContent=scenario.status==='available'?resultsMoney(scenario.projected_pl):scenario.status==='closed_year'?resultsMoney(scenario.ytd_pl):'Unavailable';card.append(value);
    const assumptions=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Observation & assumptions';assumptions.append(summary);card.append(assumptions);target=assumptions;
    paragraph(`${scenario.observed_start} – ${scenario.observed_end}: ${scenario.observation_days} observed calendar days, ${scenario.active_days} days with realizations. Observed window result ${resultsMoney(scenario.observed_pl)}; annual observed result ${resultsMoney(scenario.ytd_pl)}.`);
    const reason={insufficient_sample:'Insufficient sample: at least 30 observed days and 10 days with realizations are required.',unknown_cost:'Unavailable: the observed year contains unknown acquisition costs.',closed_year:'Year closed: observed results only; no future extrapolation.'}[scenario.status];
    target=card;
    if(reason)paragraph(reason);
    else paragraph(`Observed ${resultsMoney(scenario.ytd_pl)} · Remaining ${resultsMoney(scenario.projected_remaining_pl)}`);
    target=assumptions;
    paragraph(`Assumes the observed cadence and average result continue for ${scenario.remaining_days} calendar days.`);
    paragraph(`Formula: ${scenario.formula}. Average per realization day ${resultsMoney(scenario.average_active_day)}; observed cadence ${(scenario.cadence*100).toFixed(1)}% of calendar days.`);
  }
}
async function downloadResultsFile(url,filename) {
  const response=await fetch(url);if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||`HTTP ${response.status}`);}
  if(window.KlarwertNative?.isNative && window.KlarwertNative.shareFile) { await window.KlarwertNative.shareFile(filename,await response.text());return; }
  const blob=await response.blob(),link=document.createElement('a'),objectUrl=URL.createObjectURL(blob);link.href=objectUrl;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
}
if(resultsEl('period')) {
  resultsEl('apply').addEventListener('click',loadResults);
  resultsEl('aggregation').addEventListener('change',renderResultsCharts);
  for(const [id,step] of [['month-prev',-1],['month-next',1]])resultsEl(id).addEventListener('click',()=>{const date=new Date(`${resultsState.month}-01T12:00:00`);date.setMonth(date.getMonth()+step);resultsState.month=resultsDate(date).slice(0,7);renderResultsCalendar();});
  for(const id of ['search-apply','history-kind','clear-day'])resultsEl(id).addEventListener(id==='history-kind'?'change':'click',()=>{resultsState.page=1;if(id==='clear-day'){resultsState.day=null;renderResultsCalendar();}loadResultsHistory();});
  resultsEl('search').addEventListener('keydown',e=>{if(e.key==='Enter'){resultsState.page=1;loadResultsHistory();}});
  for(const [id,step]of [['page-prev',-1],['page-next',1]])resultsEl(id).addEventListener('click',()=>{resultsState.page+=step;loadResultsHistory();});
  resultsEl('detail-close').addEventListener('click',()=>resultsEl('detail').close());
  resultsEl('csv').addEventListener('click',async()=>{const a=resultsState.analysis;if(!a)return;try{await downloadResultsFile(`${BASE}/api/analysis_csv?${resultsSnapshotQuery(a)}`,`klarwert-analysis-${a.period.start}-${a.period.end}.csv`);}catch(e){resultsEl('status').textContent=e.message;}});
  resultsEl('backup').addEventListener('click',async()=>{try{await downloadResultsFile(`${BASE}/api/backup`,'klarwert-backup.json');}catch(e){resultsEl('status').textContent=e.message;}});
  resultsEl('restore').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;await restoreResultsBackup(await file.text());e.target.value='';});
  async function restoreResultsBackup(text) {if(!confirm('Restore this backup as the complete portfolio? The previous revision remains recoverable.'))return;try{const response=await fetch(`${BASE}/api/backup_restore`,{method:'POST',headers:{'Content-Type':'application/json'},body:text});const data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.error||'Restore failed');await loadResults();await loadAllData();resultsEl('status').textContent=`Backup restored · revision ${data.revision}`;}catch(error){resultsEl('status').textContent=error.message;}finally{resultsEl('restore').value='';}}
  if(window.KlarwertNative?.isNative && window.KlarwertNative.pickConfig) { const button=document.createElement('button');button.textContent='Restore backup file';resultsEl('restore').hidden=true;resultsEl('restore').parentElement.append(button);button.addEventListener('click',async()=>{try{const picked=await window.KlarwertNative.pickConfig();if(picked)await restoreResultsBackup(picked.content);}catch(e){resultsEl('status').textContent=e.message;}}); }
  resultsEl('recover').addEventListener('click',async()=>{if(!confirm('Recover the previous complete portfolio revision?'))return;try{const response=await fetch(`${BASE}/api/recover_previous`,{method:'POST'});const data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.error||'Recovery failed');await loadResults();await loadAllData();}catch(e){resultsEl('status').textContent=e.message;}});
  loadResults();
}

function renderDerivativeUnderlyings(products, settings) {
  const derivatives = products.filter(p => p.asset_class === 'DERIVATIVE');
  const associations = settings.derivative_underlyings || {};
  const groups = new Map();
  for (const p of derivatives) {
    const asset = associations[p.isin] || 'Unassigned';
    const key = asset.toLocaleLowerCase();
    const g = groups.get(key) || { underlying: asset, products: 0, total_invested: 0, total_realized_pl: 0 };
    g.products++; g.total_invested += p.total_invested; g.total_realized_pl += p.total_realized_pl;
    groups.set(key, g);
  }
  renderTable('derivative-underlyings-table', [...groups.values()].sort((a,b) => b.total_realized_pl-a.total_realized_pl), null);
  const container = document.getElementById('derivative-underlying-mapping');
  container.replaceChildren();
  for (const p of derivatives) {
    const label = document.createElement('label');
    label.style.display = 'block';
    label.textContent = `${p.name} (${p.isin}) `;
    const input = document.createElement('input'); input.type = 'text'; input.maxLength = 100;
    input.value = associations[p.isin] || ''; input.placeholder = 'Underlying asset, e.g. NVIDIA';
    input.dataset.isin = p.isin; label.append(input); container.append(label);
  }
}
window.saveDerivativeUnderlyings = async function () {
  const status = document.getElementById('derivative-underlying-status');
  const button = document.getElementById('save-derivative-underlyings'); button.disabled = true;
  try {
    const mapping = { ...(currentUserSettings.derivative_underlyings || {}) };
    for (const input of document.querySelectorAll('#derivative-underlying-mapping input')) {
      const asset = input.value.trim();
      if (asset) mapping[input.dataset.isin] = asset; else delete mapping[input.dataset.isin];
    }
    const response = await fetch('/api/settings', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({...currentUserSettings, derivative_underlyings: mapping}) });
    if (!response.ok) throw new Error('Could not save associations');
    await loadAllData(); status.textContent = 'Associations saved.';
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
};
