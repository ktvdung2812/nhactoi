import { subscriptionCapabilities } from './entitlements.mjs';

// Session and billing responses use the catalog even when a plan stops selling.
// A display name never determines permissions or subscription status.
export function subscriptionJson(row, clock, plans) {
  if (!row) return null;
  const expired = row.status !== 'canceled'
    && new Date(row.current_period_end).getTime() <= new Date(clock()).getTime();
  return {
    plan: row.plan,
    planName: plans.find(plan => plan.id === row.plan)?.name || row.plan,
    capabilities: subscriptionCapabilities(row, plans, clock),
    cycle: row.cycle,
    status: expired ? 'expired' : row.status,
    currentPeriodEnd: row.current_period_end,
  };
}
