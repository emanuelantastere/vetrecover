/** @param {Array<Record<string, unknown>>} rows @param {string} field */
export function sumMoney(rows, field) {
  return rows.reduce((sum, row) => {
    const amount = Number(row[field]);
    return sum + (Number.isFinite(amount) && amount >= 0 ? amount : 0);
  }, 0);
}

/** @param {string | null | undefined} value */
export function initials(value) {
  return (value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toLocaleUpperCase("pt-BR") ?? "")
    .join("");
}

/**
 * @param {Array<{ id: string, status: string }>} opportunities
 * @param {Array<{ opportunity_id: string, action_type: string, notes?: string | null, created_at?: string }>} actions
 */
export function summarizeOpportunityLifecycle(opportunities, actions) {
  const workedTypes = new Set(["contact_attempted", "contacted", "no_response", "follow_up_scheduled", "note_added", "sale_confirmed"]);
  const workedIds = new Set(actions.filter((action) => workedTypes.has(action.action_type)).map((action) => action.opportunity_id));
  const lostByReason = new Map();
  for (const opportunity of opportunities.filter((item) => item.status === "dismissed")) {
    const latestReason = actions
      .filter((action) => action.opportunity_id === opportunity.id && action.action_type === "status_changed")
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0]?.notes?.trim();
    const reason = latestReason || "Motivo não informado";
    lostByReason.set(reason, (lostByReason.get(reason) ?? 0) + 1);
  }
  return {
    workedOpportunityCount: workedIds.size,
    lostByReason: [...lostByReason].map(([reason, count]) => ({ reason, count })),
  };
}

/**
 * Recomputes dashboard financial totals from the already tenant-scoped rows
 * currently visible after search/status/priority filters.
 * @param {Array<{ id: string, quoteId?: string | null, value: number | null, rawStatus: string, history: Array<{ action_type: string, confirmed_revenue: number | null, evidence_reference: string | null }> }>} opportunities
 */
export function summarizeFilteredOpportunityMetrics(opportunities) {
  const active = opportunities.filter((item) => ["open", "in_contact", "waiting_reply"].includes(item.rawStatus));
  const values = new Map();
  for (const item of active) {
    if (item.value === null || !Number.isFinite(item.value) || item.value < 0) continue;
    const key = item.quoteId ? `quote:${item.quoteId}` : `opportunity:${item.id}`;
    const current = values.get(key) ?? { amount: 0, negotiation: false };
    current.amount = Math.max(current.amount, item.value);
    current.negotiation ||= item.rawStatus === "in_contact" || item.rawStatus === "waiting_reply";
    values.set(key, current);
  }
  const sales = new Map();
  const worked = new Set();
  const workedTypes = new Set(["contact_attempted", "contacted", "no_response", "follow_up_scheduled", "note_added", "sale_confirmed"]);
  for (const item of opportunities) {
    for (const action of item.history) {
      if (workedTypes.has(action.action_type)) worked.add(item.id);
      if (action.action_type === "sale_confirmed" && action.evidence_reference && action.confirmed_revenue !== null && Number.isFinite(action.confirmed_revenue) && action.confirmed_revenue >= 0) {
        sales.set(action.evidence_reference, Math.max(sales.get(action.evidence_reference) ?? 0, action.confirmed_revenue));
      }
    }
  }
  return {
    openOpportunityCount: opportunities.filter((item) => item.rawStatus === "open").length,
    workedOpportunityCount: worked.size,
    potentialValue: [...values.values()].reduce((sum, value) => sum + value.amount, 0),
    negotiationValue: [...values.values()].filter((value) => value.negotiation).reduce((sum, value) => sum + value.amount, 0),
    confirmedRevenue: [...sales.values()].reduce((sum, value) => sum + value, 0),
  };
}
