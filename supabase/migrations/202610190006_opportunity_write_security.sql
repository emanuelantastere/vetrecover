-- Keep tenant reads scoped and route protected opportunity/history writes through validated RPCs.
alter table public.opportunities enable row level security;
alter table public.action_history enable row level security;

drop policy if exists opportunities_member_select_v2 on public.opportunities;
create policy opportunities_member_select_v2 on public.opportunities
  for select to authenticated using (public.is_clinic_member(clinic_id));
drop policy if exists opportunities_member_guard_v2 on public.opportunities;
create policy opportunities_member_guard_v2 on public.opportunities
  as restrictive for all to authenticated
  using (public.is_clinic_member(clinic_id))
  with check (public.is_clinic_member(clinic_id));

drop policy if exists action_history_member_select_v2 on public.action_history;
create policy action_history_member_select_v2 on public.action_history
  for select to authenticated using (public.is_clinic_member(clinic_id));
drop policy if exists action_history_member_guard_v2 on public.action_history;
create policy action_history_member_guard_v2 on public.action_history
  as restrictive for all to authenticated
  using (public.is_clinic_member(clinic_id))
  with check (public.is_clinic_member(clinic_id));

-- Opportunity state and financial fields are only changed by the event/reconciliation RPCs.
revoke insert, update, delete, truncate, references, trigger on table public.opportunities from public, anon, authenticated;
grant select on table public.opportunities to authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.action_history from public, anon, authenticated;
grant select on table public.action_history to authenticated;

-- The source detector is called by the definer reconciliation RPC; clients cannot run it directly.
revoke all on function public.refresh_clinic_opportunities(uuid,timestamptz) from public, anon, authenticated;


-- Preserve the import transaction while allowing it to create generated opportunities.
create or replace function public.commit_clinic_import(p_import_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic_id uuid;
  v_row jsonb;
  v_client jsonb;
  v_pet jsonb;
  v_quote jsonb;
  v_appointment jsonb;
  v_client_id uuid;
  v_pet_id uuid;
  v_quote_id uuid;
  v_appointment_id uuid;
  v_duplicate boolean;
  v_row_number integer;
  v_rows_seen integer;
  v_rows_imported integer := 0;
  v_rows_rejected integer := 0;
  v_rows_duplicates integer := 0;
  v_existing_client_id uuid;
  v_existing_pet_client_id uuid;
  v_existing_record_client_id uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 5000 then
    raise exception using errcode = '22023', message = 'invalid_import_rows';
  end if;

  select i.clinic_id into v_clinic_id
  from public.imports i
  where i.id = p_import_id
    and i.created_by_user_id = auth.uid()
    and i.status = 'validated'
  for update;
  if v_clinic_id is null or not public.is_clinic_member(v_clinic_id) then
    raise exception using errcode = '42501', message = 'clinic_membership_required';
  end if;

  v_rows_seen := jsonb_array_length(p_rows);
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_row_number := (v_row->>'row_number')::integer;
    if coalesce((v_row->>'valid')::boolean, false) is not true then
      insert into public.import_rows (clinic_id, import_id, row_number, status, warnings, error_codes)
      values (
        v_clinic_id,
        p_import_id,
        v_row_number,
        'rejected',
        coalesce(v_row->'warnings', '[]'::jsonb),
        coalesce(v_row->'errors', '[]'::jsonb)
      );
      v_rows_rejected := v_rows_rejected + 1;
      continue;
    end if;

    v_client := v_row->'client';
    if jsonb_typeof(v_client) <> 'object' or nullif(btrim(v_client->>'name'), '') is null then
      raise exception using errcode = '22023', message = 'invalid_client_row';
    end if;
    v_duplicate := coalesce((v_row->>'possible_duplicate')::boolean, false);
    v_client_id := null;
    insert into public.clients (clinic_id, external_id, name, email, phone)
    values (
      v_clinic_id,
      nullif(btrim(v_client->>'external_id'), ''),
      btrim(v_client->>'name'),
      nullif(btrim(v_client->>'email'), ''),
      nullif(btrim(v_client->>'phone'), '')
    )
    on conflict (clinic_id, external_id) do nothing
    returning id into v_client_id;
    if v_client_id is null then
      select c.id into v_client_id from public.clients c
      where c.clinic_id = v_clinic_id and c.external_id = nullif(btrim(v_client->>'external_id'), '');
      if v_client_id is null then raise exception using errcode = '23505', message = 'client_external_id_conflict'; end if;
      v_duplicate := true;
    end if;

    v_pet := v_row->'pet';
    v_pet_id := null;
    if jsonb_typeof(v_pet) = 'object' then
      insert into public.pets (clinic_id, client_id, external_id, name, species)
      values (
        v_clinic_id,
        v_client_id,
        nullif(btrim(v_pet->>'external_id'), ''),
        btrim(v_pet->>'name'),
        nullif(btrim(v_pet->>'species'), '')
      )
      on conflict (clinic_id, external_id) do nothing
      returning id into v_pet_id;
      if v_pet_id is null then
        select p.id, p.client_id into v_pet_id, v_existing_pet_client_id from public.pets p
        where p.clinic_id = v_clinic_id and p.external_id = nullif(btrim(v_pet->>'external_id'), '');
        if v_pet_id is null or v_existing_pet_client_id <> v_client_id then
          raise exception using errcode = '23505', message = 'pet_external_id_conflict';
        end if;
        v_duplicate := true;
      end if;
    end if;

    v_quote := v_row->'quote';
    v_quote_id := null;
    if jsonb_typeof(v_quote) = 'object' then
      insert into public.quotes (clinic_id, client_id, pet_id, import_id, external_id, amount, status, issued_at, expires_at, description)
      values (
        v_clinic_id,
        v_client_id,
        v_pet_id,
        p_import_id,
        nullif(btrim(v_quote->>'external_id'), ''),
        (v_quote->>'amount')::numeric,
        v_quote->>'status',
        (v_quote->>'issued_at')::timestamptz,
        nullif(v_quote->>'expires_at', '')::timestamptz,
        nullif(btrim(v_quote->>'description'), '')
      )
      on conflict (clinic_id, external_id) do nothing
      returning id into v_quote_id;
      if v_quote_id is null then
        select q.id, q.client_id into v_quote_id, v_existing_record_client_id from public.quotes q
        where q.clinic_id = v_clinic_id and q.external_id = nullif(btrim(v_quote->>'external_id'), '');
        if v_quote_id is null or v_existing_record_client_id <> v_client_id then
          raise exception using errcode = '23505', message = 'quote_external_id_conflict';
        end if;
        v_duplicate := true;
      end if;
      if v_quote_id is not null and (v_quote->>'status') = 'pending' and not exists (
        select 1 from public.opportunities o
        where o.clinic_id = v_clinic_id and o.source_record_type = 'quote' and o.source_record_id = v_quote_id
      ) then
        insert into public.opportunities (
          clinic_id, client_id, pet_id, quote_id, opportunity_type, status, potential_value,
          source_record_type, source_record_id, recommendation_reason, recommended_action
        ) values (
          v_clinic_id, v_client_id, v_pet_id, v_quote_id, 'pending_quote', 'open',
          (v_quote->>'amount')::numeric, 'quote', v_quote_id,
          'Orçamento importado com status pendente; confirme a situação antes de qualquer contato.',
          'Revisar o orçamento e confirmar com o tutor se ainda há interesse.'
        );
      end if;
    end if;

    v_appointment := v_row->'appointment';
    v_appointment_id := null;
    if jsonb_typeof(v_appointment) = 'object' then
      insert into public.appointments (clinic_id, client_id, pet_id, import_id, external_id, starts_at, status, service_name, amount)
      values (
        v_clinic_id,
        v_client_id,
        v_pet_id,
        p_import_id,
        nullif(btrim(v_appointment->>'external_id'), ''),
        (v_appointment->>'starts_at')::timestamptz,
        v_appointment->>'status',
        nullif(btrim(v_appointment->>'service_name'), ''),
        nullif(v_appointment->>'amount', '')::numeric
      )
      on conflict (clinic_id, external_id) do nothing
      returning id into v_appointment_id;
      if v_appointment_id is null then
        select a.id, a.client_id into v_appointment_id, v_existing_record_client_id from public.appointments a
        where a.clinic_id = v_clinic_id and a.external_id = nullif(btrim(v_appointment->>'external_id'), '');
        if v_appointment_id is null or v_existing_record_client_id <> v_client_id then
          raise exception using errcode = '23505', message = 'appointment_external_id_conflict';
        end if;
        v_duplicate := true;
      end if;
    end if;

    insert into public.import_rows (
      clinic_id, import_id, row_number, status, client_id, pet_id, quote_id, appointment_id,
      possible_duplicate, duplicate_reason, warnings
    ) values (
      v_clinic_id, p_import_id, v_row_number, 'imported', v_client_id, v_pet_id, v_quote_id, v_appointment_id,
      v_duplicate,
      case when v_duplicate then coalesce(nullif(v_row->>'duplicate_reason', ''), 'Registro com identificador existente; entidade reutilizada sem sobrescrever os dados.') else null end,
      coalesce(v_row->'warnings', '[]'::jsonb)
    );
    v_rows_imported := v_rows_imported + 1;
    if v_duplicate then v_rows_duplicates := v_rows_duplicates + 1; end if;
  end loop;

  v_status := case when v_rows_rejected > 0 then 'partial' else 'completed' end;
  update public.imports
  set status = v_status,
      rows_seen = v_rows_seen,
      rows_imported = v_rows_imported,
      rows_rejected = v_rows_rejected,
      rows_duplicates = v_rows_duplicates,
      error_summary = case when v_rows_rejected > 0 then v_rows_rejected::text || ' linha(s) rejeitada(s); consulte os detalhes por linha.' else null end,
      completed_at = now()
  where id = p_import_id and clinic_id = v_clinic_id and created_by_user_id = auth.uid();

  return jsonb_build_object(
    'status', v_status,
    'rows_seen', v_rows_seen,
    'rows_imported', v_rows_imported,
    'rows_rejected', v_rows_rejected,
    'rows_duplicates', v_rows_duplicates
  );
end;
$$;


revoke all on function public.commit_clinic_import(uuid,jsonb) from public,anon;
grant execute on function public.commit_clinic_import(uuid,jsonb) to authenticated;
