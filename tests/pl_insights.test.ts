import test from "node:test";
import assert from "node:assert/strict";
import { computeAnnualPLProjection } from "../src/pl_insights.ts";

test("annual P/L projection uses elapsed calendar days and active-day statistics", () => {
  const projection = computeAnnualPLProjection([
    { date: "2024-01-01", realized_pl: 100 },
    { date: "2024-01-10", realized_pl: -40 },
    { date: "2023-12-31", realized_pl: 999 },
    { date: "2024-07-02", realized_pl: 500 },
  ], new Date(2024, 0, 10, 12));

  assert.ok(projection);
  assert.equal(projection.year, 2024);
  assert.equal(projection.elapsed_days, 10);
  assert.equal(projection.days_in_year, 366);
  assert.equal(projection.ytd_pl, 60);
  assert.equal(projection.average_calendar_day, 6);
  assert.equal(projection.average_active_day, 30);
  assert.equal(projection.projected_pl, 2196);
  assert.equal(projection.positive_day_rate, 50);
  assert.deepEqual(projection.best_day, { date: "2024-01-01", realized_pl: 100 });
  assert.deepEqual(projection.worst_day, { date: "2024-01-10", realized_pl: -40 });
});

test("annual P/L projection is absent without current-year realized activity", () => {
  assert.equal(computeAnnualPLProjection([
    { date: "2023-12-31", realized_pl: 100 },
  ], new Date(2024, 5, 1, 12)), null);
});
