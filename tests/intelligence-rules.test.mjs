import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateFinancialTotals,
  deduplicateCandidates,
  evaluateCompletedAppointment,
  evaluateInactiveClient,
  evaluatePendingQuote,
  validateOpportunityAction,
} from "../src/lib/intelligence/rules.mjs";

const asOf = new Date("2026-10-19T12:00:00.000Z");

test("pending quote detection uses status and required issue date", () => {
  assert.equal(evaluatePendingQuote({ id: "q1", status: "accepted", issued_at: "2026-10-01" }, { asOf }).candidate, null);
  assert.equal(evaluatePendingQuote({ id: "q2", status: "pending", issued_at: null }, { asOf }).candidate, null);
  assert.match(evaluatePendingQuote({ id: "q2", status: "pending", issued_at: null }, { asOf }).review.reason, /sem data/);
  assert.equal(evaluatePendingQuote({ id: "q3", status: "pending", issued_at: "2026-10-17", amount: 50 }, { asOf }).candidate.opportunity_type, "pending_quote");
});

test("priority is deterministic from age, expiration, value and ambiguity", () => {
  const quote = (issued, amount = 10, expires = null, ambiguous = false) => evaluatePendingQuote({ id: "q", status: "pending", issued_at: issued, expires_at: expires, amount }, { asOf, ambiguous }).candidate;
  assert.equal(quote("2026-10-18").priority, "low");
  assert.equal(quote("2026-10-17").priority, "medium");
  assert.equal(quote("2026-10-11").priority, "high");
  assert.equal(quote("2026-10-18", 1500).priority, "medium");
  assert.equal(quote("2026-10-11", 10, null, true).priority, "medium");
  assert.match(quote("2026-10-18", 10, "2026-10-18T00:00:00Z").priority_reason, /vencido/);
});

test("completed appointment follow-up and client inactivity require sufficient, current events", () => {
  assert.equal(evaluateCompletedAppointment({ id: "a", status: "scheduled", starts_at: "2026-10-01" }, { asOf }).candidate, null);
  assert.equal(evaluateCompletedAppointment({ id: "a", status: "completed", starts_at: "2026-10-18" }, { asOf }).candidate, null);
  assert.equal(evaluateCompletedAppointment({ id: "a", status: "completed", starts_at: "2026-10-16" }, { asOf }).candidate.opportunity_type, "overdue_follow_up");
  const events = [{ id: "a1", event_type: "completed_appointment", occurred_at: "2026-04-20" }];
  assert.equal(evaluateInactiveClient({ id: "c1" }, events, { asOf }).candidate.opportunity_type, "inactive_client");
  assert.equal(evaluateInactiveClient({ id: "c1" }, [...events, { id: "q1", event_type: "quote", occurred_at: "2026-10-01" }], { asOf }).candidate, null);
  assert.equal(evaluateInactiveClient({ id: "c1" }, [], { asOf }).candidate, null);
});

test("candidate deduplication is scoped to clinic, category and source event", () => {
  const candidate = { clinic_id: "clinic-a", opportunity_type: "pending_quote", source_record_type: "quote", source_record_id: "q1" };
  assert.equal(deduplicateCandidates([candidate, candidate, { ...candidate, clinic_id: "clinic-b" }]).length, 2);
  assert.equal(deduplicateCandidates([candidate, { ...candidate, opportunity_type: "overdue_follow_up" }]).length, 2);
});

test("actions enforce explicit terminal states, reasons and sale evidence", () => {
  assert.equal(validateOpportunityAction("open", "in_contact").valid, true);
  assert.equal(validateOpportunityAction("open", "dismissed").valid, false);
  assert.equal(validateOpportunityAction("open", "dismissed", { reason: "Tutor sem interesse" }).valid, true);
  assert.equal(validateOpportunityAction("in_contact", "invalid", { reason: "Registro duplicado" }).valid, true);
  assert.equal(validateOpportunityAction("open", "won", { confirmedRevenue: 120 }).valid, false);
  assert.equal(validateOpportunityAction("open", "won", { confirmedRevenue: 120, evidenceReference: "NF-123" }).valid, true);
  assert.equal(validateOpportunityAction("won", "in_contact").valid, false);
});

test("financial totals deduplicate quotes and require evidence for confirmed sales", () => {
  const totals = calculateFinancialTotals([
    { opportunity_type: "pending_quote", status: "open", quote_id: "q1", potential_value: 700 },
    { opportunity_type: "pending_quote", status: "open", quote_id: "q1", potential_value: 800 },
    { opportunity_type: "overdue_follow_up", status: "open", quote_id: null, potential_value: 900 },
  ], [
    { action_type: "sale_confirmed", confirmed_revenue: 400, evidence_reference: "NF-1" },
    { action_type: "sale_confirmed", confirmed_revenue: 400, evidence_reference: "NF-1" },
    { action_type: "sale_confirmed", confirmed_revenue: 200, evidence_reference: null },
  ]);
  assert.deepEqual(totals, { pendingPotential: 800, confirmedRevenue: 400, attributedRevenue: 0 });
});

test("financial totals are isolated by clinic even when identifiers/evidence repeat", () => {
  const totals = calculateFinancialTotals([
    { clinic_id: "a", opportunity_type: "pending_quote", status: "open", quote_id: "same", potential_value: 500 },
    { clinic_id: "b", opportunity_type: "pending_quote", status: "open", quote_id: "same", potential_value: 900 },
  ], [
    { clinic_id: "a", action_type: "sale_confirmed", evidence_reference: "receipt-1", confirmed_revenue: 200 },
    { clinic_id: "b", action_type: "sale_confirmed", evidence_reference: "receipt-1", confirmed_revenue: 600 },
  ], "a");
  assert.deepEqual(totals, { pendingPotential: 500, confirmedRevenue: 200, attributedRevenue: 0 });
});

test("future dates require review instead of producing stale recommendations", () => {
  assert.equal(evaluatePendingQuote({ id: "future-q", status: "pending", issued_at: "2026-10-20" }, { asOf }).candidate, null);
  assert.match(evaluatePendingQuote({ id: "future-q", status: "pending", issued_at: "2026-10-20" }, { asOf }).review.reason, /futuro/);
  assert.equal(evaluateCompletedAppointment({ id: "future-a", status: "completed", starts_at: "2026-10-20" }, { asOf }).candidate, null);
});
