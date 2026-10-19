/**
 * Random 48-bit identifier rendered as 12 hex characters. Each tab gets a fresh one per page
 * load, which is all the uniqueness the clock's tie-breaker needs.
 * `crypto.getRandomValues` is used rather than `randomUUID` because it also works outside
 * secure contexts (for example when the app is opened over plain HTTP on a LAN address).
 */
export function createNodeId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** First characters of a node id, for display. */
export function shortId(id: string): string {
  return id.slice(0, 4);
}
