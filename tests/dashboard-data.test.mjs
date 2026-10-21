import test from "node:test";
import assert from "node:assert/strict";
import { initials, sumMoney, summarizeOpportunityLifecycle, summarizeFilteredOpportunityMetrics } from "../src/lib/dashboard-data.mjs";

test("sumMoney adds finite non-negative imported values without estimating", () => {
  assert.equal(sumMoney([{ amount: "120.50" }, { amount: 79.5 }, { amount: null }, { amount: "invalid" }, { amount: -4 }], "amount"), 200);
});

test("sumMoney returns zero for an empty dataset", () => {
  assert.equal(sumMoney([], "amount"), 0);
});

test("initials are deterministic and safe for empty names", () => {
  assert.equal(initials("Clínica Patinhas"), "CP");
  assert.equal(initials("  "), "");
  assert.equal(initials(undefined), "");
});

test("lifecycle indicators count worked opportunities once and group losses by persisted reason", () => {
  const result = summarizeOpportunityLifecycle(
    [{ id: "a", status: "dismissed" }, { id: "b", status: "dismissed" }, { id: "c", status: "open" }],
    [
      { opportunity_id: "a", action_type: "contacted", notes: "Ligação" },
      { opportunity_id: "a", action_type: "note_added", notes: "Nova tentativa" },
      { opportunity_id: "a", action_type: "status_changed", notes: "Sem interesse", created_at: "2026-01-02" },
      { opportunity_id: "b", action_type: "status_changed", notes: "Sem interesse", created_at: "2026-01-03" },
      { opportunity_id: "c", action_type: "contact_attempted", notes: "Tentativa" },
    ],
  );
  assert.equal(result.workedOpportunityCount, 2);
  assert.deepEqual(result.lostByReason, [{ reason: "Sem interesse", count: 2 }]);
});

test("filtered financial metrics honor visible rows and deduplicate quotes and evidenced sales", () => {
  const totals = summarizeFilteredOpportunityMetrics([
    { id: "a", quoteId: "q1", value: 500, rawStatus: "open", history: [{ action_type: "contacted", confirmed_revenue: null, evidence_reference: null }] },
    { id: "b", quoteId: "q1", value: 500, rawStatus: "waiting_reply", history: [] },
    { id: "c", quoteId: null, value: null, rawStatus: "won", history: [{ action_type: "sale_confirmed", confirmed_revenue: 700, evidence_reference: "receipt-1" }] },
    { id: "d", quoteId: null, value: null, rawStatus: "won", history: [{ action_type: "sale_confirmed", confirmed_revenue: 700, evidence_reference: "receipt-1" }] },
    { id: "e", quoteId: "q2", value: 900, rawStatus: "dismissed", history: [] },
  ]);
  assert.deepEqual(totals, { openOpportunityCount: 1, workedOpportunityCount: 3, potentialValue: 500, negotiationValue: 500, confirmedRevenue: 700 });
});
