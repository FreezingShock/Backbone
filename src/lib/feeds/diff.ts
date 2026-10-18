// Client-side diff for polled features. Keeps one entry per id, so a map layer can update a fire in place
// and remove a fire only after a poll stops listing it. Client-safe: no Node imports.

export interface Keyed {
  id: string;
}

export interface FeatureDiff<T extends Keyed> {
  added: T[];
  updated: T[];
  removed: string[];
  current: Map<string, T>;
}

export function diffById<T extends Keyed>(previous: Map<string, T>, next: T[]): FeatureDiff<T> {
  const added: T[] = [];
  const updated: T[] = [];
  const current = new Map<string, T>();
  for (const item of next) {
    current.set(item.id, item);
    const before = previous.get(item.id);
    if (!before) added.push(item);
    else if (JSON.stringify(before) !== JSON.stringify(item)) updated.push(item);
  }
  const removed = [...previous.keys()].filter((id) => !current.has(id));
  return { added, updated, removed, current };
}
