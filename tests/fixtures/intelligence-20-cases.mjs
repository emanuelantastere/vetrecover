
export const referenceTime = new Date("2026-10-19T12:00:00.000Z");
const quote = (id, status, daysAgo, amount = 500, options = {}) => ({
  id, status, amount, issued_at: daysAgo === null ? null : new Date(referenceTime.getTime() - daysAgo * 86_400_000).toISOString(),
  expires_at: options.expired ? new Date(referenceTime.getTime() - 86_400_000).toISOString() : null,
});
const appointment = (id, status, daysAgo) => ({ id, status, starts_at: daysAgo === null ? null : new Date(referenceTime.getTime() - daysAgo * 86_400_000).toISOString() });

// Each expected result follows the business rules documented in docs/intelligence-rules.md.
export const syntheticTwenty = [
  { id: "01-pending-1d", input: quote("q01", "pending", 1), expected: { type: "pending_quote", priority: "low" } },
  { id: "02-pending-2d", input: quote("q02", "pending", 2), expected: { type: "pending_quote", priority: "medium" } },
  { id: "03-pending-7d", input: quote("q03", "pending", 7), expected: { type: "pending_quote", priority: "high" } },
  { id: "04-overdue-expiration", input: quote("q04", "pending", 1, 50, { expired: true }), expected: { type: "pending_quote", priority: "high" } },
  { id: "05-accepted-not-pending", input: quote("q05", "accepted", 10), expected: { excluded: true } },
  { id: "06-declined-not-pending", input: quote("q06", "declined", 10), expected: { excluded: true } },
  { id: "07-expired-status-not-pending", input: quote("q07", "expired", 10), expected: { excluded: true } },
  { id: "08-cancelled-not-pending", input: quote("q08", "cancelled", 10), expected: { excluded: true } },
  { id: "09-pending-without-date", input: quote("q09", "pending", null), expected: { review: true } },
  { id: "10-pending-without-amount", input: quote("q10", "pending", 9, null), expected: { type: "pending_quote", priority: "medium", review: true } },
  { id: "11-ambiguous-old-quote", input: quote("q11", "pending", 9), ambiguous: true, expected: { type: "pending_quote", priority: "medium", review: true } },
  { id: "12-two-quotes-same-client", input: [quote("q12a", "pending", 2), quote("q12b", "pending", 8)], expected: { types: ["pending_quote", "pending_quote"], ids: ["q12a", "q12b"] } },
  { id: "13-repeat-import-same-quote", input: [quote("q13", "pending", 4), quote("q13", "pending", 4)], expected: { uniqueCandidates: 1 } },
  { id: "14-same-event-different-clinic", input: ["clinic-a", "clinic-b"].map((clinic_id) => ({ clinic_id, opportunity_type: "pending_quote", source_record_type: "quote", source_record_id: "q14" })), expected: { uniqueCandidates: 2 } },
  { id: "15-scheduled-appointment", input: appointment("a15", "scheduled", 10), expected: { excluded: true } },
  { id: "16-completed-1d", input: appointment("a16", "completed", 1), expected: { excluded: true } },
  { id: "17-completed-2d", input: appointment("a17", "completed", 2), expected: { type: "overdue_follow_up", priority: "medium" } },
  { id: "18-completed-7d", input: appointment("a18", "completed", 7), expected: { type: "overdue_follow_up", priority: "high" } },
  { id: "19-completed-without-date", input: appointment("a19", "completed", null), expected: { review: true } },
  { id: "20-inactive-at-180d", input: appointment("a20", "completed", 180), expected: { type: "inactive_client", followUpExcluded: true } },
];
