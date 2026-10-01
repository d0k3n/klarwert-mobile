import { test } from "node:test";
import assert from "node:assert/strict";
import { deepCompare, expectDeepEqual } from "./helpers.ts";

test("parity comparator rejects material financial errors", () => {
  for (const [expected,actual] of [[1000,0],[-260,-500],[0,.02],[1e9,1e9+2]]) {
    assert.equal(deepCompare(expected,actual).length,1);
    assert.throws(()=>expectDeepEqual({cash:expected},{cash:actual}));
  }
});
test("parity comparator permits only absolute or applicable relative tolerance", () => {
  for (const [expected,actual] of [[1000,1000],[1000,1000.01],[-260,-260.01],[1e9,1e9+.5]]) {
    assert.equal(deepCompare(expected,actual).length,0);
  }
  assert.equal(deepCompare(1000,1000.02).length,1);
});
