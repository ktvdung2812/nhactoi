// Stable product codes. Marketing names, prices and sale status never grant rights.
export const BASE_ENTITLEMENTS = Object.freeze([
  'tasks', 'reminders', 'teams', 'crm', 'finance', 'services',
  'automation.basic', 'task_templates', 'projects', 'planner', 'offline',
  'imports', 'google_calendar', 'reports.operations',
]);
const TEAM_ENTITLEMENTS = [...BASE_ENTITLEMENTS,
  'projects.private', 'custom_fields', 'dependencies', 'timeline',
  'project_templates', 'time_tracking', 'work_calendar', 'delegation', 'automation.advanced',
];
const BUSINESS_ENTITLEMENTS = [...TEAM_ENTITLEMENTS,
  'guests', 'zalo_oa', 'public_api', 'webhooks', 'reports.sla', 'portfolio', 'capacity',
];
export const ENTITLEMENT_CODES = Object.freeze(BUSINESS_ENTITLEMENTS);
const defaultPlans = ['starter', 'team', 'business'].map(id => ({ id }));

export function planEntitlements(plan) {
  const codes = plan?.entitlements ?? ({
    starter: BASE_ENTITLEMENTS, team: TEAM_ENTITLEMENTS, business: BUSINESS_ENTITLEMENTS,
  }[plan?.id] || BASE_ENTITLEMENTS);
  return [...new Set([...BASE_ENTITLEMENTS, ...codes])].sort();
}

export function subscriptionCapabilities(subscription, plans, clock) {
  if (!subscription || !['active', 'trialing'].includes(subscription.status)
    || Date.parse(subscription.current_period_end) <= new Date(clock()).getTime()
    || !Number.isFinite(Date.parse(subscription.current_period_end))) return [];
  const plan = plans.find(item => item.id === subscription.plan);
  return plan ? planEntitlements(plan) : [];
}

// Read the catalog at the point of authorization: another API process may have
// changed it since startup. The caller still checks role and resource ACL.
export function currentPlans(db, fallback) {
  const row = db.prepare("SELECT value FROM app_settings WHERE key='plans'").get();
  return row ? JSON.parse(row.value) : fallback;
}

export function hasWorkspaceEntitlement(db, config, workspaceId, code, clock) {
  if (!ENTITLEMENT_CODES.includes(code)) return false;
  const workspace = db.prepare('SELECT suspended_at FROM workspaces WHERE id=?').get(workspaceId);
  if (!workspace || workspace.suspended_at) return false;
  const subscription = db.prepare('SELECT * FROM subscriptions WHERE workspace_id=?').get(workspaceId);
  // Standalone workers open their own connection without createApp metadata.
  // Persisted catalog overrides still take precedence over the built-in tiers.
  return subscriptionCapabilities(subscription, currentPlans(db, config?.plans ?? defaultPlans), clock).includes(code);
}
