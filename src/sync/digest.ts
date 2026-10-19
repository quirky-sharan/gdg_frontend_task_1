import type { Entry } from './lww';

/**
 * Short fingerprint of a replicated state (values and timestamps). Two tabs with equal digests
 * hold identical state, so comparing digests is a cheap convergence check.
 */
export function digestEntries(entries: Readonly<Record<string, Entry>>): string {
  const canonical = Object.entries(entries)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(
      ([key, { value, ts }]) =>
        `${key}=${JSON.stringify(value)}@${ts.wall}.${ts.counter}.${ts.node}`,
    )
    .join('|');
  return fnv1a32(canonical);
}

/** 32-bit FNV-1a hash as 8 hex characters. Not cryptographic; collisions are merely unlikely. */
export function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
