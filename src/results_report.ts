import { jsPDF } from "jspdf";
import type { ResultsAnalysis } from "./types.ts";
import { roundTo } from "./util.ts";

const INK = "#172033", MUTED = "#596579", BORDER = "#d7dee8";
const GREEN = "#16703c", RED = "#b32d35", BLUE = "#245b91";
const LEFT = 14, RIGHT = 196, WIDTH = RIGHT - LEFT, BOTTOM = 276;
const money = (v: number, signed = true) => `${signed && v > 0 ? "+" : ""}${roundTo(v, 2).toFixed(2)} EUR`;
const date = (v: string) => `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
const color = (v: number) => v > 0 ? GREEN : v < 0 ? RED : INK;

/** All figures come from the selected snapshot, never from mutable dashboard charts. */
export function createResultsReport(a: ResultsAnalysis, now: Date, includeRealizations = false, title = "Klarwert realized results"): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title, subject: `Realized results ${a.period.start} to ${a.period.end}`, author: "Klarwert" });
  let y = 36;
  const text = (value: string, x: number, top: number, size = 10, ink = INK, bold = false, align: "left" | "right" = "left") => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(ink);
    doc.text(value, x, top, { align });
  };
  const header = () => {
    text(title, LEFT, 17, 18, INK, true);
    text(`${date(a.period.start)} - ${date(a.period.end)}  |  EUR`, LEFT, 25, 10, MUTED);
    doc.setDrawColor(BORDER); doc.line(LEFT, 29, RIGHT, 29);
    y = 38;
  };
  const page = () => { doc.addPage(); header(); };
  const ensure = (height: number) => { if (y + height > BOTTOM) page(); };
  const paragraph = (value: string, size = 9, ink = MUTED) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(size);
    const lines = doc.splitTextToSize(value, WIDTH - 2) as string[];
    ensure(lines.length * 4 + 3);
    lines.forEach(line => { text(line, LEFT, y, size, ink); y += 4; }); y += 3;
  };
  const heading = (value: string) => { ensure(17); text(value, LEFT, y, 12, INK, true); y += 8; };
  const table = (labels: string[], widths: number[], rows: string[][], resultColumns: number[] = []) => {
    const xs = widths.map((_, i) => LEFT + widths.slice(0, i).reduce((s, w) => s + w, 0));
    const tableHeader = () => {
      doc.setFillColor("#eef2f6"); doc.rect(LEFT, y - 4, WIDTH, 8, "F");
      labels.forEach((label, i) => text(label, i ? xs[i] + widths[i] - 2 : xs[i] + 2, y + 1, 8, MUTED, true, i ? "right" : "left"));
      y += 9;
    };
    ensure(20); tableHeader();
    rows.forEach(row => {
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      const cells = row.map((cell, i) => doc.splitTextToSize(cell, widths[i] - 4) as string[]);
      const count = Math.max(...cells.map(c => c.length));
      const height = count * 4.2 + 2;
      if (y + height > BOTTOM && height <= BOTTOM - 47) { page(); tableHeader(); }
      // An unusually long description may itself span pages; preserve every line.
      let offset = 0;
      while (offset < count) {
        const take = Math.min(count - offset, Math.floor((BOTTOM - y - 2) / 4.2));
        if (take < 1) { page(); tableHeader(); continue; }
        cells.forEach((lines, i) => lines.slice(offset, offset + take).forEach((line, j) => text(line, i ? xs[i] + widths[i] - 2 : xs[i] + 2, y + 2.8 + j * 4.2, 9,
          resultColumns.includes(i) ? color(Number(row[i].replace(" EUR", ""))) : INK, false, i ? "right" : "left")));
        y += take * 4.2 + 2; offset += take;
        doc.setDrawColor(BORDER); doc.setLineWidth(0.1); doc.line(LEFT, y - 0.2, RIGHT, y - 0.2);
        if (offset < count) { page(); tableHeader(); }
      }
    }); y += 5;
  };
  const valid = a.realizations.filter(e => e.cost_quality === "known" && e.net_result !== null);
  const active = a.daily.filter(d => d.operations);
  const monthly = a.daily.length > 62 || active.length > 12;
  const grouped = new Map<string, { date: string; net_result: number; cumulative: number; operations: number; incomplete: number }>();
  for (const d of a.daily) {
    const key = monthly ? d.date.slice(0, 7) : d.date;
    const old = grouped.get(key);
    grouped.set(key, { date: key, net_result: roundTo((old?.net_result ?? 0) + d.net_result, 2), cumulative: d.cumulative,
      operations: (old?.operations ?? 0) + d.operations, incomplete: (old?.incomplete ?? 0) + d.incomplete });
  }
  const buckets = [...grouped.values()];
  header();
  text("KNOWN NET REALIZED RESULT", LEFT, y, 9, MUTED, true); y += 12;
  text(money(a.metrics.net_result), LEFT, y, 28, color(a.metrics.net_result), true); y += 8;
  paragraph(!a.metrics.operations ? "No realized operations in the selected period. Statement coverage is not independently verified." : a.metrics.incomplete_operations ? `${a.metrics.incomplete_operations} of ${a.metrics.operations} operations have incomplete costs and are excluded from this subtotal and statistics.` :
    `All ${a.metrics.operations} operations in this snapshot have known costs. Statement coverage is not independently verified.`, 9);
  const stats = [
    ["Operations / valid", `${a.metrics.operations} / ${a.metrics.valid_operations}`],
    ["Win rate", a.metrics.win_rate === null ? "N/A" : `${(a.metrics.win_rate * 100).toFixed(1)}%`],
    ["Average net result", a.metrics.average_result === null ? "N/A" : money(a.metrics.average_result)],
  ];
  stats.forEach(([label, value], i) => { const x = LEFT + i * 62; text(label, x, y, 9, MUTED); text(value, x, y + 8, 13, INK, true); }); y += 22;
  heading("Realized result accumulated in the period");
  const chart = (values: number[], labels: string[], bars: boolean) => {
    const top = y + 2, height = bars ? 27 : 42, x0 = LEFT + 26, width = WIDTH - 28;
    const min = Math.min(0, ...values), max = Math.max(0, ...values), span = max - min || 1;
    const cy = (v: number) => top + height - (v - min) / span * height;
    [max, ...(min < 0 && max > 0 ? [0] : []), min].filter((v, i, all) => all.indexOf(v) === i).forEach(v => {
      text(v.toFixed(2), x0 - 3, cy(v) + 1, 8, MUTED, false, "right");
      doc.setDrawColor(v === 0 ? MUTED : BORDER); doc.setLineWidth(0.15); doc.line(x0, cy(v), RIGHT, cy(v));
    });
    if (bars) values.forEach((v, i) => {
      const step = width / Math.max(values.length, 1), h = Math.abs(cy(v) - cy(0));
      doc.setFillColor(color(v)); if (h) doc.rect(x0 + i * step + step * 0.15, Math.min(cy(v), cy(0)), step * 0.7, h, "F");
    });
    else { doc.setDrawColor(BLUE); doc.setLineWidth(0.65);
      // Include an explicit zero baseline at the start; each day occupies equal calendar time.
      values.forEach((v, i) => { if (i) doc.line(x0 + (i - 1) / Math.max(values.length - 1, 1) * width, cy(values[i - 1]), x0 + i / Math.max(values.length - 1, 1) * width, cy(v)); });
    }
    text(labels[0] || date(a.period.start), x0, top + height + 5, 8, MUTED);
    text(labels.at(-1) || date(a.period.end), RIGHT, top + height + 5, 8, MUTED, false, "right");
    y = top + height + 12;
  };
  chart([0, ...a.daily.map(d => d.cumulative)], [date(a.period.start), date(a.period.end)], false);
  text(`${monthly ? "Monthly" : "Daily"} net result | positive / negative`, LEFT, y, 9, MUTED); y += 4;
  chart(buckets.map(d => d.net_result), buckets.map(d => monthly ? d.date : date(d.date)), true);
  heading("Period observations");
  if (active.length && a.metrics.valid_operations) {
    const lowest = a.daily.reduce((min, d) => d.cumulative < min.cumulative ? d : min, a.daily[0]);
    const best = active.reduce((max, d) => d.net_result > max.net_result ? d : max);
    paragraph(`Lowest accumulated result: ${money(Math.min(0, lowest.cumulative))}${lowest.cumulative < 0 ? ` on ${date(lowest.date)}` : " (opening baseline)"}. Best active day: ${date(best.date)}, ${money(best.net_result)}.`);
    const last = active.slice(-2);
    paragraph(`The last ${last.length} active ${last.length === 1 ? "day contributed" : "days contributed"} ${money(last.reduce((s, d) => s + d.net_result, 0))}. ${a.metrics.wins} winning, ${a.metrics.losses} losing and ${a.metrics.zeros} flat valid operations.`);
  } else paragraph("No operations with known costs in this period. A zero known subtotal does not establish a complete portfolio result.");
  text("Separate income", LEFT, y, 10, INK, true); y += 6;
  paragraph(`Net dividends: ${money(a.income.dividends, false)}   |   Net interest: ${money(a.income.interest, false)}. Excluded from operation statistics.`);

  page(); heading("Composition of realized results");
  const instruments = new Map<string, { name: string; isin: string; net: number; operations: number }>();
  for (const e of valid) {
    const key = e.isin || e.name || e.id;
    const item = instruments.get(key) || { name: e.name || "Unnamed instrument", isin: e.isin, net: 0, operations: 0 };
    item.net = roundTo(item.net + roundTo(e.net_result!, 2), 2); item.operations++; instruments.set(key, item);
  }
  const ranked = [...instruments.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.isin.localeCompare(b.isin));
  const shown = ranked.slice(0, 3), others = ranked.slice(3);
  const rows = shown.map(e => [`${e.name}${e.isin ? `\n${e.isin}` : ""}`, String(e.operations), money(e.net)]);
  if (others.length) rows.push([`Other instruments (${others.length})`, String(others.reduce((s, e) => s + e.operations, 0)), money(others.reduce((s, e) => s + e.net, 0))]);
  rows.push(["TOTAL - known costs only", String(a.metrics.valid_operations), money(a.metrics.net_result)]);
  table(["Instrument / largest absolute contributions", "Operations", "Net result"], [116, 26, 40], rows, [2]);
  heading("Gains, losses and recorded charges");
  const gains = valid.reduce((s, e) => s + Math.max(0, roundTo(e.net_result!, 2)), 0);
  const losses = valid.reduce((s, e) => s + Math.min(0, roundTo(e.net_result!, 2)), 0);
  const acquisition = valid.reduce((s, e) => s + e.acquisition_charges, 0), exit = valid.reduce((s, e) => s + e.exit_charges, 0);
  paragraph(`Net gains: ${money(gains)} | Net losses: ${money(losses)} | Profit factor: ${a.metrics.profit_factor === null ? "N/A" : a.metrics.profit_factor.toFixed(2)}.`);
  paragraph(`Average gain: ${a.metrics.average_win === null ? "N/A" : money(a.metrics.average_win)} | Average loss: ${a.metrics.average_loss === null ? "N/A" : money(a.metrics.average_loss)}.`);
  paragraph(`Attributable acquisition charges: ${money(acquisition, false)}; exit charges: ${money(exit, false)}. Included in net results, not an additional deduction. Signed refunds are preserved. Known-cost operations only.`);
  heading(`${monthly ? "Monthly" : "Daily"} detail - known net results`);
  table([monthly ? "Month" : "Date", "Net EUR", "Cumulative EUR", "Ops / incomplete"], [40, 42, 52, 48], buckets.filter(d => d.operations).map(d =>
    [monthly ? d.date : date(d.date), money(d.net_result).replace(" EUR", ""), money(d.cumulative).replace(" EUR", ""), `${d.operations} / ${d.incomplete}`]), [1, 2]);
  ensure(35); heading("Data quality and methodology");
  paragraph(`Source: imported Trade Republic statement. First movement: ${a.coverage.first_movement ? date(a.coverage.first_movement) : "unavailable"}; last: ${a.coverage.last_movement ? date(a.coverage.last_movement) : "unavailable"}. ${a.coverage.warning || "Movement dates do not establish complete statement coverage."}`, 8);
  paragraph("Net result = gross proceeds minus FIFO acquisition cost and attributable recorded acquisition/exit charges. Unknown-cost operations are excluded from this subtotal and statistics. Dates are statement movement dates. The accumulated curve shows realized results, not historical portfolio value or percentage return. Profit factor is N/A when no losing operations exist.", 8);
  paragraph(`Data revision: ${a.revision}. Generated: ${now.toLocaleString("en-GB")}. Analytical CSV contains full operation cost detail.`, 8);
  if (includeRealizations) {
    page(); heading("Appendix - all period realizations");
    paragraph("Incomplete operations show N/A for net result. Acquisition and exit charges include their recorded signs; amounts are in EUR.");
    table(["Date / instrument / ISIN", "Gross proceeds", "FIFO cost", "Charges", "Net EUR"], [78, 27, 27, 25, 25], a.realizations.map(e =>
      [`${date(e.date)} | ${e.kind}\n${e.name || "Unnamed instrument"}\n${e.isin || e.id}`, e.gross_proceeds.toFixed(2), e.cost_quality === "known" ? e.gross_cost.toFixed(2) : "N/A",
        (e.acquisition_charges + e.exit_charges).toFixed(2), e.cost_quality === "known" && e.net_result !== null ? money(e.net_result).replace(" EUR", "") : "N/A"]), [4]);
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setDrawColor(BORDER); doc.line(LEFT, 283, RIGHT, 283);
    text("Klarwert | Realized results", LEFT, 289, 8, MUTED);
    text(`Page ${p} of ${pages}`, RIGHT, 289, 8, MUTED, false, "right");
  }
  return doc;
}
