import { migrate as characterV1 } from "./character/v1";

type Doc = Record<string, unknown>;
export type Migration = (doc: Doc) => Doc;

/**
 * migrations[type][n] upgrades a document from version n to n + 1.
 * A schema change is not done until its migration and its fixture test exist.
 */
export const migrations: Record<string, Migration[]> = {
  character: [characterV1],
};

export interface MigrationResult {
  doc: Doc;
  from: number;
  to: number;
  applied: number;
}

export function migrateDoc(
  type: string,
  doc: Doc,
  current: number,
  minimum: number,
): MigrationResult {
  const from = typeof doc.schemaVersion === "number" ? doc.schemaVersion : 0;
  if (from < minimum)
    throw new Error(
      `${type} schemaVersion ${from} is below the minimum supported version ${minimum}`,
    );
  if (from > current)
    throw new Error(`${type} schemaVersion ${from} is newer than this build supports (${current})`);
  let out = doc;
  const steps = migrations[type] ?? [];
  for (let v = from; v < current; v++) {
    const step = steps[v];
    if (!step) throw new Error(`no migration for ${type} v${v} -> v${v + 1}`);
    out = step(out);
  }
  return { doc: out, from, to: current, applied: current - from };
}
