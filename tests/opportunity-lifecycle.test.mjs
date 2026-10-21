import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/202610190005_opportunity_lifecycle.sql", import.meta.url), "utf8");
const securityMigration = await readFile(new URL("../supabase/migrations/202610190006_opportunity_write_security.sql", import.meta.url), "utf8");
const route = await readFile(new URL("../src/app/api/opportunities/[id]/action/route.ts", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../src/components/dashboard.tsx", import.meta.url), "utf8");

test("lifecycle adds waiting reply and event history without changing terminal meanings", () => {
  assert.match(migration, /waiting_reply/);
  assert.match(migration, /contact_attempted/);
  assert.match(migration, /follow_up_scheduled/);
  assert.match(migration, /next_action_at/);
  assert.match(migration, /request_id_required/);
  assert.match(migration, /action_history_request_id_idx/);
});

test("event RPC derives tenant from persisted opportunity and authenticates membership", () => {
  assert.match(migration, /security definer set search_path = ''/i);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /public\.is_clinic_member\(v_clinic\)/);
  assert.match(migration, /p_opportunity_id uuid/);
  assert.doesNotMatch(route, /clinic_id\s*:/i);
  assert.match(route, /getImportContext\(\)/);
});

test("conversion requires amount and evidence; scheduled return requires a future date", () => {
  assert.match(migration, /sale_amount_and_evidence_required/);
  assert.match(migration, /future_follow_up_required/);
  assert.match(migration, /p_event_type <> 'won'[\s\S]+sale_evidence_only_for_won/);
});

test("potential and negotiation totals include waiting replies but sales remain evidence based", () => {
  assert.match(migration, /status in \('open','in_contact','waiting_reply'\)/);
  assert.match(migration, /action_type='sale_confirmed' and evidence_reference is not null/);
  assert.match(migration, /'attributed_revenue',0/);
  assert.match(migration, /reconcile_clinic_opportunities[\s\S]+waiting_reply/);
});

test("dashboard offers status, priority, sorting, and event actions", () => {
  assert.match(dashboard, /Filtrar prioridade/);
  assert.match(dashboard, /Ordenar oportunidades/);
  assert.match(dashboard, /Agendar retorno/);
  assert.match(dashboard, /Sem resposta/);
});

test("direct opportunity and history writes are revoked while import RPC keeps tenant checks", () => {
  assert.match(securityMigration, /alter table public\.opportunities enable row level security/i);
  assert.match(securityMigration, /public\.is_clinic_member\(clinic_id\)/i);
  assert.match(securityMigration, /revoke insert, update, delete[\s\S]+public\.opportunities from public, anon, authenticated/i);
  assert.match(securityMigration, /revoke insert, update, delete[\s\S]+public\.action_history from public, anon, authenticated/i);
  assert.match(securityMigration, /function public\.commit_clinic_import[\s\S]+security definer[\s\S]+auth\.uid\(\)[\s\S]+public\.is_clinic_member\(v_clinic_id\)/i);
});
