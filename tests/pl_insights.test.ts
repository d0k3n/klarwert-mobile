import test from "node:test";
import assert from "node:assert/strict";
import { computeAnnualPLProjection } from "../src/pl_insights.ts";

test("annual P/L projection uses active-day average and expected weekly pace", () => {
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
  assert.equal(projection.active_days_per_week, 3);
  assert.equal(projection.remaining_days, 356);
  assert.equal(projection.projected_future_active_days, 152.6);
  assert.equal(projection.projected_remaining_pl, 4577.14);
  assert.equal(projection.projected_pl, 4637.14);
  assert.equal(projection.positive_day_rate, 50);
  assert.deepEqual(projection.best_day, { date: "2024-01-01", realized_pl: 100 });
  assert.deepEqual(projection.worst_day, { date: "2024-01-10", realized_pl: -40 });
});

test("projection does not dilute a mid-year start with inactive earlier months", () => {
  const projection = computeAnnualPLProjection([
    { date: "2024-06-01", realized_pl: 100 },
    { date: "2024-06-15", realized_pl: 50 },
  ], new Date(2024, 6, 1, 12), 4);

  assert.ok(projection);
  assert.equal(projection.average_active_day, 75);
  assert.equal(projection.active_days_per_week, 4);
  assert.equal(projection.projected_future_active_days, 104.6);
  assert.equal(projection.projected_pl, 7992.86);
});

test("projection rejects an invalid active-day pace", () => {
  assert.throws(() => computeAnnualPLProjection([
    { date: "2024-01-01", realized_pl: 100 },
  ], new Date(2024, 0, 2, 12), 0));
});

test("annual P/L projection is absent without current-year realized activity", () => {
  assert.equal(computeAnnualPLProjection([
    { date: "2023-12-31", realized_pl: 100 },
  ], new Date(2024, 5, 1, 12)), null);
});
