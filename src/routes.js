// Route recognition is shared by the server App Router boundary and the
// browser-only legacy application. Keep this module free of browser globals
// so Next can use it while rendering a direct request.

export const navRouteIds = [
  "inbox",
  "today",
  "upcoming",
  "week",
  "dashboard",
  "tasks",
  "calendar",
  "customers",
  "finance",
  "teams",
  "projects",
  "google-calendar",
  "zalo-oa",
  "public-integrations",
  "tickets",
  "services",
  "automations",
  "events",
  "transfer",
  "account",
  "appearance",
  "templates",
  "trash",
];

export const adminRouteIds = [
  "overview",
  "workspaces",
  "users",
  "subscriptions",
  "plans",
  "orders",
  "tickets",
  "audit",
  "settings",
].map((id) => `admin/${id}`);

export const authRouteIds = [
  "login",
  "register",
  "forgot-password",
  "reset-password",
];

const staticRouteIds = new Set([
  ...navRouteIds,
  ...authRouteIds,
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

  // Old Lịch nhắc and Lịch hẹn bookmarks open the single work board.
  if (current === "calendar" || current === "events") return "tasks";
  // The member directory now lives on the Teams page.
  if (current === "team") return "teams";

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
    /^teams\/[A-Za-z0-9_-]+$/.test(current) ||
    /^customers\/[A-Za-z0-9_-]+$/.test(current)
  )
    return current;

  return "not-found";
}

export function isValidRoute(pathname) {
  return readRoute(pathname) !== "not-found";
}

/**
 * Convert an old `#/page` bookmark into an app path. Only known routes are
 * restored: `#//evil.example` would otherwise become a protocol-relative URL.
 */
export function legacyHashTarget(hash, search = "") {
  const legacy = String(hash || "").match(/^#\/(.+)$/)?.[1];
  if (!legacy || !/^[A-Za-z0-9]/.test(legacy)) return null;
  const queryAt = legacy.indexOf("?");
  const path = queryAt < 0 ? legacy : legacy.slice(0, queryAt);
  const query = queryAt < 0 ? "" : legacy.slice(queryAt + 1);
  if (readRoute(`/${path}`, query) === "not-found") return null;
  return `/${legacy}${queryAt < 0 ? search : ""}`;
}
