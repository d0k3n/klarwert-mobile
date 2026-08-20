import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { androidVersionCode, updateAndroidBuildGradle } from "../scripts/set-android-version.mjs";

const repoRoot = resolve(process.cwd());

test("Android semantic versions map to increasing version codes", () => {
  assert.equal(androidVersionCode("1.0.0"), 1_000_000);
  assert.equal(androidVersionCode("1.2.3"), 1_002_003);
  assert.equal(androidVersionCode("0.0.0"), 1);
  assert.ok(androidVersionCode("2.0.0") > androidVersionCode("1.999.999"));
  assert.throws(() => androidVersionCode("1.0.0-beta.1"));
  assert.throws(() => androidVersionCode("1.1000.0"));
});

test("Android Gradle release version is replaced safely", () => {
  const source = 'defaultConfig {\n  versionCode 1\n  versionName "1.0"\n}\n';
  const updated = updateAndroidBuildGradle(source, "1.4.2");
  assert.match(updated, /versionCode 1004002/);
  assert.match(updated, /versionName "1\.4\.2"/);
  assert.throws(() => updateAndroidBuildGradle("defaultConfig {}", "1.0.0"));
});

test("CI and release workflows cover tests, signing and GitHub Releases", () => {
  const ci = readFileSync(resolve(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
  const release = readFileSync(resolve(repoRoot, ".github", "workflows", "android-release.yml"), "utf8");
  assert.match(ci, /npm ci/);
  assert.match(ci, /npm test/);
  assert.match(ci, /npm run build:web/);
  assert.match(release, /assembleRelease/);
  assert.match(release, /apksigner" sign/);
  assert.match(release, /gh release create/);
  assert.match(release, /ANDROID_KEYSTORE_BASE64/);
});
