# Klarwert 1.4.1

Restores the results calendar heatmap and integrates the results consultation surfaces into the existing dark dashboard theme.

- Green/red intensity follows the absolute known daily result on a shared monthly scale. Full amounts (EUR in the legend), operation counts, accessible labels and selection remain visible.
- No realizations, realized zero and incomplete cost have distinct neutral/dashed states, with an explicit incomplete marker.
- Net results stand out in the overview and FIFO detail. History and detail retain complete currency values and signed semantic colors.
- Filters, search, buttons, pagination and modal use dark surfaces, subtle borders and keyboard focus states.
- Both automatic projection scenarios have compact cards with observation windows and assumptions available in disclosures. Coverage and audit identities remain consultable.

The accounting engine, API contracts, CSV import, backup, CSV/PDF exports and projection calculations are unchanged. No financial inputs were added.

## Validation

- 247 tests pass, including calendar states, signs, proportional heat intensity and accessible selection.
- TypeScript (`npx tsc --noEmit`), web build, JavaScript syntax checks and `git diff --check` pass.
- Browser QA uses the existing 903-movement CSV fixture, plus a temporary CSV exercising the zero and unknown-cost cases from the accounting tests.
- Seven calendar columns and no horizontal overflow at 360 × 800, 390 × 844 and landscape 844 × 390.
- Calendar → history → FIFO detail checked for positive, negative, zero and incomplete cases. Search Enter, pagination, Tab focus, modal Escape and return focus verified.
- Projection cards, keyboard disclosures and original-fixture projections checked in the browser.

Release publication uses the existing Android Release tag workflow, which signs and verifies the APK and publishes its SHA-256 checksum.
