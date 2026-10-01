/** Native Filesystem offers individual writes, not a multi-file atomic transaction.
 * Data generations are immutable; alternating manifests retain the previous validated
 * generation. Recovery ignores truncated/invalid manifests or generations. Adapter
 * read must report I/O errors rather than confusing them with a missing file.
 */
export interface StorageAdapter { read(name: string): Promise<string | null>; write(name: string, text: string): Promise<void>; }
interface Manifest { format: "klarwert-manifest"; version: 1; sequence: number; generation: string; checksum: string; previous: { generation: string; checksum: string } | null; }
export interface RevisionStore<T> {
  load(): Promise<T | null>;
  mutate(update: (current: T | null) => T | Promise<T>): Promise<T>;
  publish(value: T): Promise<T>;
  recoverPrevious(): Promise<T>;
}
const queues = new WeakMap<StorageAdapter, Promise<unknown>>();
function serial<T>(adapter: StorageAdapter, fn: () => Promise<T>): Promise<T> {
  const result = (queues.get(adapter) ?? Promise.resolve()).then(fn, fn);
  queues.set(adapter, result.catch(() => undefined));
  return result;
}
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function checksum(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
function parseManifest(text: string | null): Manifest | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Manifest;
    const reference = (r: any) => r && typeof r.generation === "string" && /^portfolio-generation-[a-zA-Z0-9-]+\.json$/.test(r.generation) && typeof r.checksum === "string" && /^[a-f0-9]+$/.test(r.checksum);
    if (v.format !== "klarwert-manifest" || v.version !== 1 || !Number.isSafeInteger(v.sequence) || v.sequence < 1 || !reference(v) || (v.previous !== null && !reference(v.previous))) return null;
    return v;
  } catch { return null; }
}
export function createRevisionStore<T>(adapter: StorageAdapter, validate: (value: unknown) => T): RevisionStore<T> {
  async function readGeneration(ref: { generation: string; checksum: string }): Promise<T | null> {
    const raw = await adapter.read(ref.generation);
    if (!raw || checksum(raw) !== ref.checksum) return null;
    try { return validate(JSON.parse(raw)); } catch { return null; }
  }
  async function inspect(): Promise<{ value: T; manifest: Manifest } | null> {
    const rawManifests = await Promise.all([adapter.read("portfolio-manifest-0.json"), adapter.read("portfolio-manifest-1.json")]);
    const manifests = rawManifests.map(parseManifest).filter((m): m is Manifest => !!m).sort((a, b) => b.sequence - a.sequence);
    for (const manifest of manifests) {
      const value = await readGeneration(manifest);
      if (value !== null) return { value, manifest };
      if (manifest.previous) {
        const previous = await readGeneration(manifest.previous);
        if (previous !== null) return { value: previous, manifest: { ...manifest, ...manifest.previous, previous: null } };
      }
    }
    if (rawManifests.some(raw => raw !== null && raw !== "")) throw new Error("Stored portfolio has no valid recoverable generation");
    return null;
  }
  async function commit(value: T, current: Awaited<ReturnType<typeof inspect>>): Promise<T> {
    const validated = validate(copy(value));
    const raw = JSON.stringify(validated);
    const generation = `portfolio-generation-${Date.now()}-${globalThis.crypto.randomUUID()}.json`;
    await adapter.write(generation, raw);
    if (await adapter.read(generation) !== raw) throw new Error("Portfolio generation readback failed; previous revision preserved");
    const sequence = (current?.manifest.sequence ?? 0) + 1;
    if (!Number.isSafeInteger(sequence)) throw new Error("Storage revision exceeds safe limits");
    const manifest: Manifest = { format: "klarwert-manifest", version: 1, sequence, generation, checksum: checksum(raw), previous: current ? { generation: current.manifest.generation, checksum: current.manifest.checksum } : null };
    const name = `portfolio-manifest-${sequence % 2}.json`, manifestText = JSON.stringify(manifest);
    const previousSlot = await adapter.read(name);
    try {
      await adapter.write(name, manifestText);
      if (await adapter.read(name) !== manifestText) throw new Error("Portfolio manifest readback failed");
    } catch (error) {
      // Preserve the other manifest throughout; undo a failed verified publication
      // when the adapter still accepts writes. A torn manifest is ignored on load.
      try { await adapter.write(name, previousSlot ?? ""); } catch { /* other slot remains recoverable */ }
      throw error;
    }
    return copy(validated);
  }
  return {
    load: () => serial(adapter, async () => { const found = await inspect(); return found ? copy(found.value) : null; }),
    mutate: update => serial(adapter, async () => { const current = await inspect(); return commit(await update(current ? copy(current.value) : null), current); }),
    publish: value => serial(adapter, async () => commit(value, await inspect())),
    recoverPrevious: () => serial(adapter, async () => {
      const current = await inspect();
      if (!current?.manifest.previous) throw new Error("No previous portfolio revision is available");
      const previous = await readGeneration(current.manifest.previous);
      if (previous === null) throw new Error("Previous portfolio revision is invalid");
      const restored = copy(previous);
      // Portfolio ledgers expose the visible revision independently from generation sequence.
      const p = restored as any, c = current.value as any;
      if (p?.ledger && c?.ledger) p.ledger.revision = String(Number(c.ledger.revision) + 1);
      return commit(restored, current);
    }),
  };
}
