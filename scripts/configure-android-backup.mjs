import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const LEGACY_BACKUP_RULES = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
    <include domain="file" path="user_config.json" />
</full-backup-content>
`;

export const MODERN_BACKUP_RULES = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
        <include domain="file" path="user_config.json" />
    </cloud-backup>
    <device-transfer>
        <include domain="file" path="user_config.json" />
    </device-transfer>
</data-extraction-rules>
`;

export function updateAndroidManifestForBackup(source) {
  if (!source.includes("android:allowBackup=\"true\"")) {
    throw new Error("Could not find android:allowBackup=\"true\" in AndroidManifest.xml");
  }
  if (source.includes("android:dataExtractionRules=")) return source;
  return source.replace(
    'android:allowBackup="true"',
    'android:allowBackup="true"\n        android:fullBackupContent="@xml/backup_rules"\n        android:dataExtractionRules="@xml/data_extraction_rules"',
  );
}

export async function configureAndroidBackup(root = repoRoot) {
  const manifestPath = resolve(root, "android", "app", "src", "main", "AndroidManifest.xml");
  const xmlDir = resolve(root, "android", "app", "src", "main", "res", "xml");
  const manifest = await readFile(manifestPath, "utf8");
  await writeFile(manifestPath, updateAndroidManifestForBackup(manifest));
  await mkdir(xmlDir, { recursive: true });
  await writeFile(resolve(xmlDir, "backup_rules.xml"), LEGACY_BACKUP_RULES);
  await writeFile(resolve(xmlDir, "data_extraction_rules.xml"), MODERN_BACKUP_RULES);
  console.log("Configured Android backup for portable Klarwert settings only");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await configureAndroidBackup();
}
