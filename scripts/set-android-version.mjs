import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function androidVersionCode(version) {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`Invalid stable semantic version: ${version}`);
  const [, majorText, minorText, patchText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  if (minor > 999 || patch > 999) {
    throw new Error("Android version mapping requires minor and patch values below 1000");
  }
  const code = major * 1_000_000 + minor * 1_000 + patch;
  if (!Number.isSafeInteger(code) || code > 2_100_000_000) {
    throw new Error("Version is too large for an Android versionCode");
  }
  return Math.max(1, code);
}

export function updateAndroidBuildGradle(source, version) {
  const code = androidVersionCode(version);
  if (!/versionCode\s+\d+/.test(source) || !/versionName\s+"[^"]+"/.test(source)) {
    throw new Error("Could not find versionCode/versionName in android/app/build.gradle");
  }
  return source
    .replace(/versionCode\s+\d+/, `versionCode ${code}`)
    .replace(/versionName\s+"[^"]+"/, `versionName "${version}"`);
}

async function main() {
  const version = process.argv[2];
  if (!version) throw new Error("Usage: node scripts/set-android-version.mjs <major.minor.patch>");
  const buildFile = resolve("android", "app", "build.gradle");
  const source = await readFile(buildFile, "utf8");
  await writeFile(buildFile, updateAndroidBuildGradle(source, version));
  console.log(`Configured Android ${version} (versionCode ${androidVersionCode(version)})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
