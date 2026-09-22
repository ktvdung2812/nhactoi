// Route recognition is shared by the server App Router boundary and the
// browser-only legacy application. Keep this module free of browser globals
// so Next can use it while rendering a direct request.

export const navRouteIds = [
  "dashboard",
  "tasks",
  "calendar",
  "customers",
  "finance",
  "teams",
  "team",
  "tickets",
  "services",
  "automations",
  "events",
  "transfer",
  "account",
  "templates",
  "trash",
];

export const adminRouteIds = [
  "overview",
  "workspaces",
  "users",
  "subscriptions",
  "orders",
  "tickets",
  "audit",
  "settings",
].map((id) => `admin/${id}`);

const staticRouteIds = new Set([
  ...navRouteIds,
  "billing",
  "errors",
  ...adminRouteIds,
]);

function routePath(pathname) {
  return String(pathname || "").replace(/^\/+|\/+$/g, "");
}

/**
 * Return the same logical page id used by the legacy client application.
 * `pathname` and `search` are optional to keep browser call sites concise.
 */
export function readRoute(
  pathname = typeof window === "undefined" ? "" : window.location.pathname,
  search = typeof window === "undefined" ? "" : window.location.search,
) {
  const current = routePath(pathname);
  if (!current || current === "index.html") return "dashboard";
  if (current === "admin") return "admin/overview";

  const query = String(search || "").replace(/^\?/, "");
  if (
    current === "admin/tickets" &&
    /^(workspaceId|userId)=[A-Za-z0-9_-]+$/.test(query)
  )
    return `${current}?${query}`;

  if (
    staticRouteIds.has(current) ||
    /^errors\/[45]\d{2}$/.test(current) ||
    /^admin\/(users|workspaces|tickets)\/[A-Za-z0-9_-]+$/.test(current) ||
    /^tickets\/[A-Za-z0-9_-]+$/.test(current) ||
    /^tasks\/[A-Za-z0-9_-]+$/.test(current) ||
    /^teams\/[A-Za-z0-9_-]+$/.test(current)
  )
    return current;

  return "not-found";
}

export function isValidRoute(pathname) {
  return readRoute(pathname) !== "not-found";
}
