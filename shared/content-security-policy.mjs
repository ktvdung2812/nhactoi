// Every response (API, static files, pages) carries these directives.
export const BASE_CSP = "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

// Page HTML also restricts scripts to the per-request nonce set by proxy.js.
// 'strict-dynamic' lets those scripts load Next's chunks; worker-src keeps the
// service worker allowed. Development needs 'unsafe-eval' for React's
// server error stacks.
export function pageCsp(nonce, development = false) {
  return `${BASE_CSP}; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}; worker-src 'self'`;
}
