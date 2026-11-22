/** The one guard for every e2e-only tool: the URL must name a database exactly `axion_e2e` or `axion_e2e<digits>`. */
export function isE2eDatabaseUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url) return false;
  let path: string;
  try { path = decodeURIComponent(new URL(url).pathname); } catch { return false; } // query and hash are ignored; a malformed URL or escape fails closed
  return /^\/axion_e2e\d*$/.test(path);
}
