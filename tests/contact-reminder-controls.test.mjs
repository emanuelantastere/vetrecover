import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/202610190007_contact_reminder_controls.sql", import.meta.url), "utf8");
const lifecycleMigration = await readFile(new URL("../supabase/migrations/202610190005_opportunity_lifecycle.sql", import.meta.url), "utf8");
const route = await readFile(new URL("../src/app/api/opportunities/[id]/action/route.ts", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../src/components/dashboard.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");

test("contact events keep reminders by default and permit explicit clear or reschedule", () => {
  assert.match(migration, /p_reminder_action = 'clear' then null/);
  assert.match(migration, /p_reminder_action = 'schedule' then p_next_action_at/);
  assert.match(migration, /else next_action_at/);
  assert.match(migration, /p_reminder_action not in \('keep', 'clear', 'schedule'\)/);
  assert.match(migration, /future_follow_up_required/);
  assert.match(migration, /insert into public\.action_history/);
});

test("reminder RPC validates authentication, clinic membership, active state, and replay id", () => {
  assert.match(migration, /security definer[\s\S]+set search_path = ''/i);
  assert.match(migration, /if v_user is null/);
  assert.match(migration, /public\.is_clinic_member\(v_clinic\)/);
  assert.match(migration, /v_status not in \('open', 'in_contact', 'waiting_reply'\)/);
  assert.match(migration, /request_id_conflict/);
  assert.match(lifecycleMigration, /action_history_request_id_idx/);
});

test("action API preserves the existing RPC for unchanged reminders", () => {
  assert.match(route, /const withReminder = reminderAction !== "keep"/);
  assert.match(route, /record_clinic_opportunity_event_with_reminder/);
  assert.match(route, /record_clinic_opportunity_event"/);
  assert.match(route, /reminderAction !== "keep"/);
});

test("opportunity detail exposes owner contact, reminder choices, safe actor names, and action disclosure", () => {
  assert.match(dashboard, /selected\.ownerPhone/);
  assert.match(dashboard, /selected\.ownerEmail/);
  assert.match(dashboard, /value="keep"/);
  assert.match(dashboard, /value="clear"/);
  assert.match(dashboard, /value="schedule"/);
  assert.match(dashboard, /action\.actor_name/);
  assert.doesNotMatch(dashboard, /actor_user_id\.slice/);
  assert.match(dashboard, /n&atilde;o inicia liga&ccedil;&atilde;o/);
});

test("authenticated page selects contact details and never displays raw actor identifiers", () => {
  assert.match(page, /name, phone, email/);
  assert.match(page, /actor_name: action\.actor_user_id === user\.id \? userName : "Membro da clínica"/);
  assert.match(page, /ownerEmail:/);
});

test("README and opportunity lifecycle migration remain valid UTF-8 without replacement characters", async () => {
  for (const path of ["../README.md", "../supabase/migrations/202610190005_opportunity_lifecycle.sql", "../supabase/migrations/202610190007_contact_reminder_controls.sql"]) {
    const bytes = await readFile(new URL(path, import.meta.url));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    assert.doesNotMatch(text, /\uFFFD/);
    assert.doesNotMatch(text, /Ã[¡©­³º¼½¿]/);
  }
});
