import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/202610190002_import_pipeline.sql", import.meta.url), "utf8");
const confirmRoute = await readFile(new URL("../src/app/api/imports/confirm/route.ts", import.meta.url), "utf8");
const importServer = await readFile(new URL("../src/lib/importer/server.ts", import.meta.url), "utf8");

test("the import transaction runs as the caller and verifies auth plus clinic membership", () => {
  assert.match(migration, /function public\.commit_clinic_import[\s\S]+security invoker/i);
  assert.match(migration, /auth\.uid\(\) is null[\s\S]+authentication_required/i);
  assert.match(migration, /created_by_user_id = auth\.uid\(\)[\s\S]+public\.is_clinic_member\(v_clinic_id\)/i);
  assert.match(confirmRoute, /getImportContext\(\)/);
  assert.match(importServer, /auth\.getUser\(\)/);
  assert.match(importServer, /from\("clinic_memberships"\)[\s\S]+\.eq\("user_id", user\.id\)/);
});

test("import rows have tenant RLS and cannot be accessed by anonymous clients", () => {
  assert.match(migration, /alter table public\.import_rows enable row level security/i);
  assert.match(migration, /create policy import_rows_select_member[\s\S]+public\.is_clinic_member\(clinic_id\)/i);
  assert.match(migration, /create policy import_rows_insert_creator[\s\S]+public\.is_clinic_member\(clinic_id\)[\s\S]+i\.created_by_user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /revoke all on table public\.import_rows from anon, authenticated/i);
  assert.match(migration, /grant select, insert on table public\.import_rows to authenticated/i);
  assert.match(migration, /revoke all on function public\.commit_clinic_import\(uuid, jsonb\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.commit_clinic_import\(uuid, jsonb\) to authenticated/i);
});

test("a failed entity insert aborts the same RPC transaction; only its final status update marks success", () => {
  assert.match(migration, /insert into public\.clients[\s\S]+insert into public\.pets[\s\S]+insert into public\.quotes[\s\S]+insert into public\.appointments[\s\S]+insert into public\.import_rows[\s\S]+update public\.imports/i);
  assert.match(migration, /v_status := case when v_rows_rejected > 0 then 'partial' else 'completed' end/i);
  assert.match(migration, /error_summary = case when v_rows_rejected > 0/i);
  assert.doesNotMatch(migration, /exception when others then/i);
  assert.match(confirmRoute, /status: "failed"[\s\S]+A gravação transacional falhou/);
});

test("the server derives clinic id from the authenticated membership, never from a posted clinic id", () => {
  assert.match(confirmRoute, /clinic_id: context\.clinicId/);
  assert.doesNotMatch(confirmRoute, /form\.get\("clinic_id"\)|body\.clinic_id/);
  assert.match(importServer, /const \{ data: \{ user \}, error: authError \} = await supabase\.auth\.getUser\(\)/);
  assert.match(importServer, /\.select\("clinic_id"\)[\s\S]+\.eq\("user_id", user\.id\)/);
});

test("quotes never write confirmed revenue, and only pending quotes create open opportunities", () => {
  assert.match(migration, /if v_quote_id is not null and \(v_quote->>'status'\) = 'pending'[\s\S]+insert into public\.opportunities/i);
  assert.match(migration, /'pending_quote', 'open'[\s\S]+'quote', v_quote_id/i);
  assert.doesNotMatch(migration, /insert into public\.action_history/i);
});

test("the browser Supabase client uses only public configuration", async () => {
  const browserClient = await readFile(new URL("../src/lib/supabase/client.ts", import.meta.url), "utf8");
  assert.match(browserClient, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|config\.publishableKey/);
  assert.doesNotMatch(browserClient, /SERVICE_ROLE|SECRET_KEY/i);
  assert.doesNotMatch(confirmRoute + importServer, /SERVICE_ROLE|SECRET_KEY|SUPABASE_SERVICE_ROLE/i);
});

test("the dashboard contains no canned clinic names or financial sample values", async () => {
  const dashboard = await readFile(new URL("../src/components/dashboard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(dashboard, /Patinhas & Cia|R\$ 18\.450|R\$ 6\.840|Luna/);
  assert.match(dashboard, /Sem dados reais ainda/);
  assert.match(dashboard, /brl\(filteredMetrics\.potentialValue\)/);
});
