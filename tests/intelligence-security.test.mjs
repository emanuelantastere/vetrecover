import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/202610190003_commercial_intelligence.sql", import.meta.url), "utf8");
const reconciliation = await readFile(new URL("../supabase/migrations/202610190004_intelligence_reconciliation.sql", import.meta.url), "utf8");
const actionRoute = await readFile(new URL("../src/app/api/opportunities/[id]/action/route.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");

test("the engine and action RPCs authorize the authenticated clinic and do not use a service role", () => {
  assert.match(migration, /function public\.refresh_clinic_opportunities[\s\S]+security invoker[\s\S]+v_user_id uuid := auth\.uid\(\)[\s\S]+v_user_id is null[\s\S]+public\.is_clinic_member\(target_clinic_id\)/i);
  assert.match(migration, /function public\.record_clinic_opportunity_action[\s\S]+security definer[\s\S]+auth\.uid\(\)[\s\S]+public\.is_clinic_member\(v_clinic_id\)/i);
  assert.match(actionRoute, /getImportContext\(\)/);
  assert.doesNotMatch(actionRoute, /SERVICE_ROLE|SECRET_KEY/i);
  assert.match(page, /\.eq\("clinic_id", membership\.clinic_id\)/);
});

test("opportunity event uniqueness and terminal transitions are enforced in SQL", () => {
  assert.match(migration, /create unique index opportunities_one_per_event_idx/i);
  assert.match(migration, /status in \('open', 'in_contact'\)/i);
  assert.match(migration, /p_target_status in \('dismissed', 'invalid'\) and v_reason is null/i);
  assert.match(migration, /opportunity_already_closed/i);
});

test("confirmed sales require amount and evidence, and attribution is not fabricated", () => {
  assert.match(migration, /sale_amount_and_evidence_required/i);
  assert.match(migration, /action_history_sale_evidence_idx/i);
  assert.match(migration, /attributed_revenue, attribution_method, evidence_reference[\s\S]+null,[\s\S]+null,[\s\S]+case when p_target_status = 'won'/i);
  assert.doesNotMatch(migration, /set attributed_revenue\s*=/i);
});

test("engine uses only observed quote, appointment and import row fields", () => {
  assert.match(migration, /q\.status = 'pending'[\s\S]+q\.issued_at/);
  assert.match(migration, /a\.status = 'completed'[\s\S]+a\.starts_at/);
  assert.match(migration, /last_visit\.starts_at <= as_of - interval '180 days'/);
  assert.match(migration, /ir\.possible_duplicate/);
  assert.match(migration, /do update set[\s\S]+where public\.opportunities\.status in \('open', 'in_contact'\)/i);
});

test("reconciliation closes stale source opportunities without converting accepted quotes into sales", () => {
  assert.match(reconciliation, /function public\.reconcile_clinic_opportunities[\s\S]+security definer[\s\S]+set search_path = ''[\s\S]+auth\.uid\(\)[\s\S]+public\.is_clinic_member\(target_clinic_id\)/i);
  assert.match(reconciliation, /q\.status is distinct from 'pending'/i);
  assert.match(reconciliation, /accepted[^\n]+não comprova uma venda|não comprova uma venda/i);
  assert.match(reconciliation, /a\.starts_at <= as_of - interval '180 days'/i);
  assert.match(reconciliation, /action_type, notes\)[\s\S]+status_changed/i);
  assert.match(page, /rpc\("reconcile_clinic_opportunities"/);
  assert.match(page, /\.in\("opportunity_id", opportunityIds\)/);
  assert.doesNotMatch(page, /clinic_financial_totals/);
});
