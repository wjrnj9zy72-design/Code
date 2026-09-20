/**
 * Where the shared games live, for a copy of the app that has one.
 *
 * Fill these in to turn on sharing (see docs/DEPLOIEMENT.md). Left empty, the
 * app works exactly as before: games stay in the browser, and nothing is sent
 * anywhere. The key below is a *public* key — it is meant to be readable by
 * everyone who opens the page, and the database is protected by exposing a few
 * functions rather than the table itself — and, for the links that carry
 * several games at once, by a sharing key this file never holds (see
 * docs/DEPLOIEMENT.md, étape 2 bis).
 */
export const REMOTE = {
  url: 'https://ikndckzjhhdlnwtvfkvx.supabase.co/rest/v1/',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlrbmRja3pqaGhkbG53dHZma3Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4NDMzMDEsImV4cCI6MjEwNTQxOTMwMX0.k1LVHl9LrJAVkN99YnIVDQ4493ol0fSZr12qrFglEiM',
};

/**
 * A copy of the app served from somewhere else — a file on a phone, say — can
 * be pointed at the same database without being rebuilt.
 */
export function remoteConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem('marque-points:remote:v1') || 'null');
    if (stored && stored.url && stored.key) return stored;
  } catch {
    // No storage, or nothing stored: fall through to the built-in values.
  }
  return REMOTE.url && REMOTE.key ? REMOTE : null;
}
