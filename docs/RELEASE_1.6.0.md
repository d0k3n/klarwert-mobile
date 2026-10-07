# Klarwert 1.6.0

## Plan and implementation

Replace the need to inspect bar-chart tooltips with one realized P&L explorer:

1. Days: monthly calendar with visible daily amounts and a monthly total.
2. Weeks: year selector, weekly heatmap totals grouped by month, and a daily
   calendar when selecting a week. A back button returns to weekly comparison.
3. Months: twelve monthly heatmap totals and one annual total, with a click
   opening the monthly calendar. Remember the last view locally.
4. Keep evolution charts available in a collapsed optional section.

All views aggregate the same immutable analysis snapshot as the existing
results cards, history, CSV and PDF. The explorer follows the selected period;
choose All imported history to compare all available years. Partial periods
show their covered dates, and incomplete costs remain marked. Weeks run Monday
to Sunday and are clipped at calendar-year boundaries so the sum of weekly
totals equals the annual total without double counting. Days without
realizations remain distinct from realized zero. The default calendar opens
the current month when covered, otherwise the last imported month.

## Validation

- 255 tests pass, including monthly/weekly reconciliation across year
  boundaries, leap years, partial coverage, incomplete costs and daily detail
  across a month boundary.
- TypeScript checking, JavaScript syntax, web build and diff whitespace checks.
- Browser verification with the repository fixture: monthly and weekly
  comparisons, visible totals and week-to-daily drill-down.

Tag v1.6.0 triggers the existing Android Release workflow to build, sign and
publish the APK and SHA-256 checksum.
