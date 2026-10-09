# Klarwert 1.7.0

The PDF export now presents selected-period realized results as a structured,
printable report, with a two-page summary for typical periods.

- Highlights the known net realized result, valid operations, win rate and
  average result, followed by vector charts of accumulated and daily/monthly
  results and factual observations about the period.
- Explains instrument contributions, gains, losses and attributable recorded
  charges. Dividends and interest remain separate from operation statistics.
- Replaces daily prose with aligned tables, aggregates long periods monthly,
  and repeats report periods and column headers across continuation pages.
- Adds an optional **PDF operation appendix** beside Export PDF, listing every
  selected-period realization with proceeds, FIFO cost, charges and net result.
- Preserves frozen snapshots, existing calculations, signed refunds, rounding
  warnings and exclusion of unknown-cost operations from valid statistics.
- Updates the underlying-asset description to explain automatic grouping and
  the priority of manual associations.

Validation: 259 tests passed, TypeScript and JavaScript syntax checks passed,
and the web bundles built successfully. Generated PDFs were rendered and
visually inspected, including empty/incomplete periods, long appendices and
descriptions spanning pages. Text bounds were checked against print margins.

The release workflow builds and verifies the signed Android APK and publishes
it with its SHA-256 checksum. Installation and sharing on a physical Android
device have not been verified in this release preparation.
