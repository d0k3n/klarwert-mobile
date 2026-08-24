import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_USER_SETTINGS,
  makeUserConfig,
  parseUserConfig,
  validateUserSettings,
} from "../src/user_config.ts";

test("configuration round-trips projection settings and card rules", () => {
  const config = makeUserConfig(
    { projection_active_days_per_week: 4 },
    [{ pattern: "Coffee Shop", category: "Eating Out" }],
  );

  assert.deepEqual(parseUserConfig(JSON.parse(JSON.stringify(config))), config);
  assert.equal(config.format, "klarwert-config");
  assert.equal(config.version, 1);
  assert.deepEqual(DEFAULT_USER_SETTINGS, { projection_active_days_per_week: 3 });
  assert.deepEqual(Object.keys(config).sort(), ["card_rules", "format", "settings", "version"]);
});

test("configuration rejects invalid versions and projection settings", () => {
  assert.throws(() => validateUserSettings({ projection_active_days_per_week: 0 }));
  assert.throws(() => validateUserSettings({ projection_active_days_per_week: 2.5 }));
  assert.throws(() => parseUserConfig({
    format: "klarwert-config",
    version: 99,
    settings: { projection_active_days_per_week: 3 },
    card_rules: [],
  }));
});

test("duplicate imported card patterns use the last category", () => {
  const config = parseUserConfig({
    format: "klarwert-config",
    version: 1,
    settings: { projection_active_days_per_week: 3 },
    card_rules: [
      { pattern: "My Cafe", category: "Other" },
      { pattern: "my-cafe", category: "Eating Out" },
    ],
  });
  assert.deepEqual(config.card_rules, [{ pattern: "my-cafe", category: "Eating Out" }]);
});
