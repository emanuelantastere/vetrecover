import test from "node:test";
import assert from "node:assert/strict";
import { deduplicateCandidates, evaluateCompletedAppointment, evaluateInactiveClient, evaluatePendingQuote } from "../src/lib/intelligence/rules.mjs";
import { referenceTime, syntheticTwenty } from "./fixtures/intelligence-20-cases.mjs";

test("20 synthetic spreadsheet cases follow documented outcomes", () => {
  assert.equal(syntheticTwenty.length, 20);
  for (const scenario of syntheticTwenty) {
    const expected = scenario.expected;
    if (scenario.id === "12-two-quotes-same-client") {
      const candidates = scenario.input.map((item) => evaluatePendingQuote(item, { asOf: referenceTime }).candidate);
      assert.deepEqual(candidates.map((item) => item.opportunity_type), expected.types, scenario.id);
      assert.deepEqual(candidates.map((item) => item.source_record_id), expected.ids, scenario.id);
      continue;
    }
    if (scenario.id === "13-repeat-import-same-quote") {
      const candidates = scenario.input.map((item) => evaluatePendingQuote(item, { asOf: referenceTime }).candidate);
      assert.equal(deduplicateCandidates(candidates).length, expected.uniqueCandidates, scenario.id);
      continue;
    }
    if (scenario.id === "14-same-event-different-clinic") {
      assert.equal(deduplicateCandidates(scenario.input).length, expected.uniqueCandidates, scenario.id);
      continue;
    }
    if (scenario.id === "20-inactive-at-180d") {
      assert.equal(evaluateCompletedAppointment(scenario.input, { asOf: referenceTime }).candidate, null, scenario.id);
      const inactive = evaluateInactiveClient({ id: "client-20" }, [{ id: "a20", event_type: "completed_appointment", occurred_at: scenario.input.starts_at }], { asOf: referenceTime });
      assert.equal(inactive.candidate.opportunity_type, expected.type, scenario.id);
      continue;
    }
    const result = scenario.input.status === "completed" || scenario.input.status === "scheduled"
      ? evaluateCompletedAppointment(scenario.input, { asOf: referenceTime })
      : evaluatePendingQuote(scenario.input, { asOf: referenceTime, ambiguous: scenario.ambiguous });
    if (expected.review) {
      assert.ok(result.review || result.candidate?.data_quality === "review", scenario.id);
      if (expected.type) assert.equal(result.candidate?.opportunity_type, expected.type, scenario.id);
      if (expected.priority) assert.equal(result.candidate?.priority, expected.priority, scenario.id);
    } else if (expected.excluded) {
      assert.equal(result.candidate, null, scenario.id);
    } else {
      assert.equal(result.candidate?.opportunity_type, expected.type, scenario.id);
      assert.equal(result.candidate?.priority, expected.priority, scenario.id);
    }
  }
});

test("later quote blocks inactivity and changing a quote to accepted removes pending eligibility", () => {
  const oldVisit = { id: "visit", event_type: "completed_appointment", occurred_at: "2026-01-01T00:00:00Z" };
  const newQuote = { id: "q-new", event_type: "quote", occurred_at: "2026-10-01T00:00:00Z" };
  assert.equal(evaluateInactiveClient({ id: "client" }, [oldVisit, newQuote], { asOf: referenceTime }).candidate, null);
  assert.equal(evaluatePendingQuote({ id: "q", status: "accepted", issued_at: "2026-10-01" }, { asOf: referenceTime }).candidate, null);
});
