/**
 * Which store is this? Production: first hostname label of
 * {slug}.loqta.shop. Dev (localhost/preview hosts): ?store= fallback,
 * remembered in sessionStorage so in-app navigation keeps working.
 */
export function resolveStoreSlug(): string | null {
  const host = window.location.hostname;
  const parts = host.split(".");
  const isIp = /^[\d.]+$/.test(host);
  if (!isIp && parts.length >= 3 && parts[0] !== "app" && parts[0] !== "www") {
    return parts[0]!;
  }
  const fromQuery = new URLSearchParams(window.location.search).get("store");
  if (fromQuery) {
    sessionStorage.setItem("loqta_store", fromQuery);
    return fromQuery;
  }
  return sessionStorage.getItem("loqta_store");
}
