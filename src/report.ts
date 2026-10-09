import { jsPDF } from "jspdf";
import type { ResultsAnalysis } from "./types.ts";
import { createResultsReport } from "./results_report.ts";

/**
 * A deliberately small allowlist for the dashboard PDF.  The report is
 * assembled from these elements rather than cloning a dashboard group, so
 * transaction, tax, audit, and reconciliation tables can never leak into it.
 */
const CARD_SECTIONS = [
  { selector: "#summary-cards", title: "Portfolio summary" },
  { selector: "#summary-by-asset-class", title: "Asset-class summary" },
  { selector: "#annual-projection-cards", title: "Annual P&L projection" },
];

const MONTHLY_HEATMAP_SELECTOR = "#monthly-pl-heatmap";

const CHART_SECTIONS = [
  { selector: "#weekly-pl-chart", title: "Weekly realized P&L" },
  { selector: "#pl-evolution-chart", title: "Realized P&L over time" },
  { selector: "#allocation-chart", title: "Allocation by product" },
  { selector: "#dividend-chart", title: "Dividends by product" },
  { selector: "#income-chart", title: "Income" },
  { selector: "#cash-flow-chart", title: "Cash flow" },
  { selector: "#spending-category-chart", title: "Card spending by category" },
  { selector: "#spending-monthly-chart", title: "Monthly card spending" },
];

const PAGE = { width: 210, height: 297, margin: 14, footer: 11 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const CONTENT_BOTTOM = PAGE.height - PAGE.footer - 5;

const COLORS = {
  ink: "#172033",
  muted: "#5f6b7a",
  border: "#d7dee8",
  surface: "#f8fafc",
  positive: "#16803c",
  negative: "#c73535",
  neutral: "#dfe6ee",
  noData: "#edf1f5",
  heatPositive1: "#bde5c8",
  heatPositive2: "#8ed3a3",
  heatPositive3: "#52b978",
  heatPositive4: "#218a4b",
  heatNegative1: "#f2c0c0",
  heatNegative2: "#e98b8b",
  heatNegative3: "#dc5757",
  heatNegative4: "#bd2929",
} as const;

export type PdfShareCallback = (filename: string, base64: string) => Promise<void>;

export interface DashboardPdfOptions {
  /** Frozen analytical snapshot; independent of mutable dashboard DOM. */
  analysis?: ResultsAnalysis;
  /** Add a paginated appendix containing every realization in the selected period. */
  includeRealizations?: boolean;
  title?: string;
  filename?: string;
  /**
   * Android supplies its native file writer here.  Keeping it as a callback
   * means this browser bundle does not depend on Capacitor at runtime.
   */
  shareBase64?: PdfShareCallback;
  /** Injectable for deterministic callers and tests. */
  now?: Date;
}

export interface DashboardPdfResult {
  filename: string;
  pages: number;
  shared: boolean;
}

type Card = { label: string; values: Array<{ text: string; positive: boolean; negative: boolean }> };

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function dateStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let start = 0; start < bytes.length; start += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize));
  }
  return btoa(binary);
}

function nextFrame(): Promise<void> {
  return new Promise(resolve => window.requestAnimationFrame(() => resolve()));
}

function openDashboardGroups(): () => void {
  const groups = Array.from(document.querySelectorAll<HTMLDetailsElement>(".dash-group"));
  const previousState = groups.map(group => group.open);
  groups.forEach(group => { group.open = true; });
  window.dispatchEvent(new Event("resize"));
  return () => {
    groups.forEach((group, index) => { group.open = previousState[index]; });
    window.dispatchEvent(new Event("resize"));
  };
}

function findCards(selector: string): Card[] {
  const root = document.querySelector<HTMLElement>(selector);
  if (!root) return [];
  return Array.from(root.children)
    .filter((element): element is HTMLElement => element instanceof HTMLElement && element.classList.contains("card"))
    .map((element) => ({
      label: cleanText(element.querySelector(".label")?.textContent),
      values: Array.from(element.querySelectorAll<HTMLElement>(".value"))
        .map(value => ({
          text: cleanText(value.textContent),
          positive: value.classList.contains("positive"),
          negative: value.classList.contains("negative"),
        }))
        .filter(value => value.text !== ""),
    }))
    .filter(card => card.label !== "" || card.values.length > 0);
}

function heatColor(element: Element): string {
  const classes = element.classList;
  if (classes.contains("heat-positive-4")) return COLORS.heatPositive4;
  if (classes.contains("heat-positive-3")) return COLORS.heatPositive3;
  if (classes.contains("heat-positive-2")) return COLORS.heatPositive2;
  if (classes.contains("heat-positive-1")) return COLORS.heatPositive1;
  if (classes.contains("heat-negative-4")) return COLORS.heatNegative4;
  if (classes.contains("heat-negative-3")) return COLORS.heatNegative3;
  if (classes.contains("heat-negative-2")) return COLORS.heatNegative2;
  if (classes.contains("heat-negative-1")) return COLORS.heatNegative1;
  if (classes.contains("no-data")) return COLORS.noData;
  return COLORS.neutral;
}

function readableTextColor(background: string): string {
  return background === COLORS.heatPositive4 || background === COLORS.heatNegative4
    ? "#ffffff"
    : COLORS.ink;
}

function setText(doc: jsPDF, color: string, size: number, style: "normal" | "bold" = "normal"): void {
  doc.setTextColor(color);
  doc.setFont("helvetica", style);
  doc.setFontSize(size);
}

function split(doc: jsPDF, text: string, width: number): string[] {
  return doc.splitTextToSize(text, width) as string[];
}

function cardHeight(doc: jsPDF, card: Card, width: number): number {
  const labelLines = split(doc, card.label, width - 10).length;
  const valueLines = card.values.reduce((count, value) => count + split(doc, value.text, width - 10).length, 0);
  return Math.max(23, 8 + labelLines * 3.3 + valueLines * 4.5);
}

function paintCard(doc: jsPDF, card: Card, x: number, y: number, width: number, height: number): void {
  doc.setFillColor(COLORS.surface);
  doc.setDrawColor(COLORS.border);
  doc.roundedRect(x, y, width, height, 2, 2, "FD");

  let cursor = y + 6;
  setText(doc, COLORS.muted, 7, "bold");
  const labelLines = split(doc, card.label, width - 10);
  doc.text(labelLines, x + 5, cursor);
  cursor += labelLines.length * 3.3 + 4;

  card.values.forEach((value) => {
    const color = value.positive ? COLORS.positive : value.negative ? COLORS.negative : COLORS.ink;
    setText(doc, color, 9, "bold");
    const lines = split(doc, value.text, width - 10);
    doc.text(lines, x + 5, cursor);
    cursor += lines.length * 4.5;
  });
}

class PdfLayout {
  y = PAGE.margin + 16;

  readonly doc: jsPDF;
  constructor(doc: jsPDF) { this.doc = doc; }

  newPage(): void {
    this.doc.addPage("a4", "portrait");
    this.y = PAGE.margin;
  }

  ensure(height: number): void {
    if (this.y + height > CONTENT_BOTTOM) this.newPage();
  }

  heading(title: string): void {
    this.ensure(10);
    setText(this.doc, COLORS.ink, 13, "bold");
    this.doc.text(title, PAGE.margin, this.y);
    this.y += 7;
    this.doc.setDrawColor(COLORS.border);
    this.doc.line(PAGE.margin, this.y, PAGE.width - PAGE.margin, this.y);
    this.y += 6;
  }
}

function renderCards(layout: PdfLayout, title: string, cards: Card[]): void {
  if (!cards.length) return;
  const gap = 5;
  const width = (CONTENT_WIDTH - gap) / 2;
  const firstRowHeight = Math.max(...cards.slice(0, 2).map(card => cardHeight(layout.doc, card, width)));
  layout.ensure(firstRowHeight + 13);
  layout.heading(title);
  for (let index = 0; index < cards.length; index += 2) {
    const pair = cards.slice(index, index + 2);
    const height = Math.max(...pair.map(card => cardHeight(layout.doc, card, width)));
    layout.ensure(height + 3);
    pair.forEach((card, offset) => paintCard(layout.doc, card, PAGE.margin + offset * (width + gap), layout.y, width, height));
    layout.y += height + gap;
  }
}

function renderMonthlyHeatmap(layout: PdfLayout): boolean {
  const heatmap = document.querySelector<HTMLElement>(MONTHLY_HEATMAP_SELECTOR);
  const grid = document.querySelector<HTMLElement>("#monthly-pl-grid");
  if (!heatmap || !grid || !grid.children.length) return false;

  const monthLabel = cleanText(document.getElementById("month-label")?.textContent) || "Monthly realized P&L";
  const total = cleanText(document.getElementById("month-total")?.textContent);
  const weekdayLabels = Array.from(heatmap.querySelectorAll(".pl-heatmap-weekdays span"))
    .map(day => cleanText(day.textContent));
  const rows = Array.from(grid.children).filter((row): row is HTMLElement => row instanceof HTMLElement);
  const height = 29 + rows.length * 14;

  layout.ensure(height + 10);
  layout.heading("Monthly realized P&L");
  setText(layout.doc, COLORS.ink, 10, "bold");
  layout.doc.text(monthLabel, PAGE.margin, layout.y);
  layout.y += 5;
  if (total) {
    setText(layout.doc, COLORS.muted, 7);
    layout.doc.text(split(layout.doc, total, CONTENT_WIDTH), PAGE.margin, layout.y);
    layout.y += 7;
  }

  const cellGap = 1.5;
  const cellWidth = (CONTENT_WIDTH - cellGap * 6) / 7;
  setText(layout.doc, COLORS.muted, 7, "bold");
  weekdayLabels.forEach((day, index) => {
    layout.doc.text(day, PAGE.margin + index * (cellWidth + cellGap) + cellWidth / 2, layout.y, { align: "center" });
  });
  layout.y += 4;

  rows.forEach((row) => {
    Array.from(row.children).forEach((cell, index) => {
      const x = PAGE.margin + index * (cellWidth + cellGap);
      const color = heatColor(cell);
      layout.doc.setFillColor(color);
      layout.doc.setDrawColor(COLORS.border);
      layout.doc.roundedRect(x, layout.y, cellWidth, 11, 1, 1, "FD");
      const day = cleanText(cell.textContent);
      if (day) {
        setText(layout.doc, readableTextColor(color), 7, "bold");
        layout.doc.text(day, x + cellWidth / 2, layout.y + 7, { align: "center" });
      }
    });
    layout.y += 14;
  });
  layout.y += 3;
  return true;
}

function renderCanvas(layout: PdfLayout, title: string, selector: string): boolean {
  const canvas = document.querySelector<HTMLCanvasElement>(selector);
  if (!canvas || canvas.width === 0 || canvas.height === 0) return false;

  const image = canvas.toDataURL("image/jpeg", 0.92);
  const aspect = canvas.height / canvas.width;
  const maximumHeight = CONTENT_BOTTOM - PAGE.margin - 9;
  let width = CONTENT_WIDTH;
  let height = width * aspect;
  if (height > maximumHeight) {
    height = maximumHeight;
    width = height / aspect;
  }

  layout.ensure(height + 13);
  layout.heading(title);
  const x = PAGE.margin + (CONTENT_WIDTH - width) / 2;
  layout.doc.addImage(image, "JPEG", x, layout.y, width, height, undefined, "FAST");
  layout.y += height + 6;
  return true;
}

function addHeader(doc: jsPDF, title: string, createdAt: Date): void {
  setText(doc, COLORS.ink, 18, "bold");
  doc.text(title, PAGE.margin, PAGE.margin);
  setText(doc, COLORS.muted, 8);
  doc.text(`Generated ${createdAt.toLocaleString()}`, PAGE.margin, PAGE.margin + 6);
  doc.setDrawColor(COLORS.border);
  doc.line(PAGE.margin, PAGE.margin + 10, PAGE.width - PAGE.margin, PAGE.margin + 10);
}

function addFooters(doc: jsPDF): number {
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(COLORS.border);
    doc.line(PAGE.margin, PAGE.height - PAGE.footer, PAGE.width - PAGE.margin, PAGE.height - PAGE.footer);
    setText(doc, COLORS.muted, 7);
    doc.text("Klarwert dashboard report", PAGE.margin, PAGE.height - 6);
    doc.text(`Page ${page} of ${pages}`, PAGE.width - PAGE.margin, PAGE.height - 6, { align: "right" });
  }
  return pages;
}

function downloadPdf(filename: string, doc: jsPDF): void {
  const blob = doc.output("blob");
  const anchor = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

/**
 * Produces a concise, table-free A4 report from the currently rendered
 * dashboard.  Chart data is captured from Chart.js canvases, while summary
 * cards and the monthly heatmap are drawn as native PDF primitives.
 */
export async function exportDashboardPdf(options: DashboardPdfOptions = {}): Promise<DashboardPdfResult> {
  if (options.analysis) return exportResultsPdf(options);
  const now = options.now ?? new Date();
  const title = options.title ?? "Klarwert portfolio report";
  const filename = options.filename ?? `klarwert-dashboard-${dateStamp(now)}.pdf`;
  const restoreGroups = openDashboardGroups();

  try {
    // A hidden <details> element has a zero-sized Chart.js canvas.  Let the
    // browser lay out the expanded groups before serialising their images.
    await nextFrame();
    await nextFrame();

    // Summary cards only exist after a portfolio has been loaded; canvases
    // have browser default dimensions even when they contain no chart data.
    const hasSummaryCards = CARD_SECTIONS.some(section => findCards(section.selector).length > 0);
    if (!hasSummaryCards) throw new Error("No dashboard data is available to export.");

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    doc.setProperties({ title, subject: "Dashboard summary" });
    addHeader(doc, title, now);
    const layout = new PdfLayout(doc);

    CARD_SECTIONS.forEach(section => renderCards(layout, section.title, findCards(section.selector)));
    renderMonthlyHeatmap(layout);
    CHART_SECTIONS.forEach(section => renderCanvas(layout, section.title, section.selector));

    const pages = addFooters(doc);
    if (options.shareBase64) {
      const base64 = toBase64(doc.output("arraybuffer"));
      await options.shareBase64(filename, base64);
      return { filename, pages, shared: true };
    }
    downloadPdf(filename, doc);
    return { filename, pages, shared: false };
  } finally {
    restoreGroups();
  }
}

async function exportResultsPdf(options: DashboardPdfOptions): Promise<DashboardPdfResult> {
  const analysis = structuredClone(options.analysis!);
  const doc = createResultsReport(analysis, options.now ?? new Date(), options.includeRealizations, options.title);
  const filename = options.filename ?? `klarwert-results-${analysis.period.start}-${analysis.period.end}.pdf`;
  const pages = doc.getNumberOfPages();
  if (options.shareBase64) {
    await options.shareBase64(filename, toBase64(doc.output("arraybuffer")));
    return { filename, pages, shared: true };
  }
  downloadPdf(filename, doc);
  return { filename, pages, shared: false };
}

declare global {
  interface Window {
    KlarwertReport?: {
      exportDashboardPdf: (options?: DashboardPdfOptions) => Promise<DashboardPdfResult>;
    };
  }
}

window.KlarwertReport = { exportDashboardPdf };
