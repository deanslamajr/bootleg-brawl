// v0 -> v1. v0 was the pre-release draft format written by early concept passes:
// `name` instead of `displayName`, `hp` and `continueLine` at the top level.

type Doc = Record<string, unknown>;

export function migrate(doc: Doc): Doc {
  const { name, hp, continueLine, ...rest } = doc;
  const stats = { ...((rest.stats as Doc | undefined) ?? {}) };
  if (hp !== undefined && stats.hp === undefined) stats.hp = hp;
  const voice = { ...((rest.voice as Doc | undefined) ?? {}) };
  if (continueLine !== undefined && voice.continueLine === undefined)
    voice.continueLine = continueLine;
  return {
    ...rest,
    displayName: rest.displayName ?? name,
    stats,
    voice,
    schemaVersion: 1,
  };
}
