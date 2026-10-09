# Realized results PDF

The selected-period PDF uses a frozen `ResultsAnalysis` snapshot. The first
page highlights the known net realized result, valid operation count, win rate,
average net result, accumulated realized result and signed daily/monthly bars.
Observations describe the known subtotal; dividends and interest stay separate.

The composition page ranks the three largest absolute instrument contributions
and reconciles all remaining instruments in an Other row. It includes net gains,
net losses, profit factor, average gain/loss and signed acquisition/exit charges.
Charges are already included in net results and are not deducted again.

Detail uses daily rows for up to 62 calendar days and 12 active days, otherwise
monthly rows. Charts include inactive calendar buckets. Long tables continue on
additional pages with repeated column headers and report period. Unusually long
descriptions wrap across pages rather than being truncated.

Select **PDF operation appendix** beside Export PDF to include every realization
in the selected period, with proceeds, FIFO cost, charges and net result. Unknown
costs display N/A and remain excluded from summary statistics and attribution.
The analytical CSV remains available for the full component-level detail.

Coverage warnings, rounding differences, source dates and data revision are
preserved. The accumulated curve is not a portfolio valuation or rate of return.
No forecast or unverified comparison is added. Output follows the application's
English labels and uses explicit signed EUR amounts, including in monochrome.

Regression coverage includes snapshot isolation, the August fixture total and
two-page layout, empty periods, unknown costs, signed refunds, monthly grouping,
multi-page appendices and descriptions longer than one page.
