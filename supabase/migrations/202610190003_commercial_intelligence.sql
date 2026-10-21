-- Deterministic, tenant-scoped commercial intelligence and action history.
alter table public.opportunities
  add column if not exists priority text not null default 'low',
  add column if not exists priority_reason text,
  add column if not exists value_source text,
  add column if not exists data_quality text not null default 'complete',
  add column if not exists source_occurred_at timestamptz;

alter table public.opportunities
  drop constraint if exists opportunities_status_check;
alter table public.opportunities
  add constraint opportunities_status_check
  check (status = any (array['open', 'in_contact', 'won', 'dismissed', 'invalid']::text[]));
alter table public.opportunities
  add constraint opportunities_priority_check check (priority in ('low', 'medium', 'high')),
  add constraint opportunities_data_quality_check check (data_quality in ('complete', 'review'));

alter table public.action_history
  add column if not exists evidence_reference text;

-- Do not silently erase existing opportunities to make the new event key unique.
do $$
begin
  if exists (
    select 1
    from public.opportunities
    where source_record_type in ('quote', 'appointment')
    group by clinic_id, opportunity_type, source_record_type, source_record_id
    having count(*) > 1
  ) then
    raise exception 'Existing duplicate opportunities must be reviewed before applying commercial intelligence migration.';
  end if;
end;
$$;

create unique index opportunities_one_per_event_idx
  on public.opportunities (clinic_id, opportunity_type, source_record_type, source_record_id)
  where source_record_type in ('quote', 'appointment');

create unique index action_history_sale_evidence_idx
  on public.action_history (clinic_id, evidence_reference)
  where action_type = 'sale_confirmed' and evidence_reference is not null;

create or replace function public.refresh_clinic_opportunities(target_clinic_id uuid, as_of timestamptz default now())
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_quote record;
  v_appointment record;
  v_client record;
  v_age integer;
  v_priority text;
  v_quality text;
  v_reason text;
  v_review_count integer := 0;
  v_upsert_count integer := 0;
  v_reviews jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if not public.is_clinic_member(target_clinic_id) then
    raise exception using errcode = '42501', message = 'clinic_membership_required';
  end if;
  if as_of is null then
    raise exception using errcode = '22023', message = 'invalid_reference_time';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_clinic_id::text, 0));

  for v_quote in
    select q.id, q.clinic_id, q.client_id, q.pet_id, q.amount, q.status, q.issued_at, q.expires_at,
           c.name as client_name, p.name as pet_name,
           exists (
             select 1 from public.import_rows ir
             where ir.clinic_id = q.clinic_id and ir.quote_id = q.id and ir.possible_duplicate
           ) as ambiguous
    from public.quotes q
    join public.clients c on c.clinic_id = q.clinic_id and c.id = q.client_id
    left join public.pets p on p.clinic_id = q.clinic_id and p.id = q.pet_id
    where q.clinic_id = target_clinic_id and q.import_id is not null and q.status = 'pending'
  loop
    if v_quote.issued_at is null then
      v_review_count := v_review_count + 1;
      v_reviews := v_reviews || jsonb_build_array(jsonb_build_object(
        'source_record_type', 'quote', 'source_record_id', v_quote.id,
        'reason', 'Orçamento pendente sem data de emissão; não foi criada oportunidade.'
      ));
      continue;
    end if;
    v_age := greatest(0, floor(extract(epoch from (as_of - v_quote.issued_at)) / 86400)::integer);
    v_quality := case when v_quote.ambiguous then 'review' else 'complete' end;
    v_priority := case
      when v_quote.expires_at is not null and v_quote.expires_at < as_of then 'high'
      when v_age >= 7 then 'high'
      when v_age >= 2 or v_quote.amount >= 1000 then 'medium'
      else 'low'
    end;
    if v_quality = 'review' then
      v_priority := case v_priority when 'high' then 'medium' when 'medium' then 'low' else 'low' end;
    end if;
    v_reason := case
      when v_quote.expires_at is not null and v_quote.expires_at < as_of then 'Orçamento pendente com prazo vencido.'
      else 'Orçamento pendente há ' || v_age::text || ' dia(s).'
    end;
    insert into public.opportunities (
      clinic_id, client_id, pet_id, quote_id, opportunity_type, status, potential_value,
      source_record_type, source_record_id, recommendation_reason, recommended_action,
      priority, priority_reason, value_source, data_quality, source_occurred_at
    ) values (
      target_clinic_id, v_quote.client_id, v_quote.pet_id, v_quote.id, 'pending_quote', 'open', v_quote.amount,
      'quote', v_quote.id, v_reason,
      'Confirmar com a equipe se o tutor recebeu o orçamento e registrar o retorno.',
      v_priority,
      v_priority || ': vencido ou 7+ dias = alta; 2–6 dias ou valor ≥ R$ 1.000 = média; demais = baixa.' ||
        case when v_quality = 'review' then ' Prioridade reduzida por possível duplicidade; revisar antes de agir.' else '' end,
      'Orçamento importado', v_quality, v_quote.issued_at
    )
    on conflict (clinic_id, opportunity_type, source_record_type, source_record_id)
      where source_record_type in ('quote', 'appointment')
    do update set
      client_id = excluded.client_id,
      pet_id = excluded.pet_id,
      quote_id = excluded.quote_id,
      potential_value = excluded.potential_value,
      recommendation_reason = excluded.recommendation_reason,
      recommended_action = excluded.recommended_action,
      priority = excluded.priority,
      priority_reason = excluded.priority_reason,
      value_source = excluded.value_source,
      data_quality = excluded.data_quality,
      source_occurred_at = excluded.source_occurred_at,
      updated_at = as_of
    where public.opportunities.status in ('open', 'in_contact');
    if found then v_upsert_count := v_upsert_count + 1; end if;
  end loop;

  for v_appointment in
    select a.id, a.clinic_id, a.client_id, a.pet_id, a.starts_at, a.status,
           c.name as client_name, p.name as pet_name,
           exists (
             select 1 from public.import_rows ir
             where ir.clinic_id = a.clinic_id and ir.appointment_id = a.id and ir.possible_duplicate
           ) as ambiguous
    from public.appointments a
    join public.clients c on c.clinic_id = a.clinic_id and c.id = a.client_id
    left join public.pets p on p.clinic_id = a.clinic_id and p.id = a.pet_id
    where a.clinic_id = target_clinic_id and a.import_id is not null and a.status = 'completed'
  loop
    if v_appointment.starts_at is null then
      v_review_count := v_review_count + 1;
      v_reviews := v_reviews || jsonb_build_array(jsonb_build_object(
        'source_record_type', 'appointment', 'source_record_id', v_appointment.id,
        'reason', 'Atendimento concluído sem data válida; não foi criada oportunidade.'
      ));
      continue;
    end if;
    v_age := greatest(0, floor(extract(epoch from (as_of - v_appointment.starts_at)) / 86400)::integer);
    if v_age < 2 then continue; end if;

    v_quality := case when v_appointment.ambiguous then 'review' else 'complete' end;
    v_priority := case when v_age >= 7 then 'high' else 'medium' end;
    if v_quality = 'review' then v_priority := case v_priority when 'high' then 'medium' else 'low' end; end if;
    insert into public.opportunities (
      clinic_id, client_id, pet_id, appointment_id, opportunity_type, status, potential_value,
      source_record_type, source_record_id, recommendation_reason, recommended_action,
      priority, priority_reason, value_source, data_quality, source_occurred_at
    ) values (
      target_clinic_id, v_appointment.client_id, v_appointment.pet_id, v_appointment.id,
      'overdue_follow_up', 'open', null, 'appointment', v_appointment.id,
      'Atendimento concluído há ' || v_age::text || ' dia(s), sem oportunidade de acompanhamento para este evento.',
      'Verificar como o paciente evoluiu e registrar o contato realizado.',
      v_priority,
      v_priority || ': atendimento concluído há 7+ dias = alta; 2–6 dias = média.' ||
        case when v_quality = 'review' then ' Prioridade reduzida por possível duplicidade; revisar antes de agir.' else '' end,
      null, v_quality, v_appointment.starts_at
    )
    on conflict (clinic_id, opportunity_type, source_record_type, source_record_id)
      where source_record_type in ('quote', 'appointment')
    do update set
      client_id = excluded.client_id,
      pet_id = excluded.pet_id,
      appointment_id = excluded.appointment_id,
      recommendation_reason = excluded.recommendation_reason,
      recommended_action = excluded.recommended_action,
      priority = excluded.priority,
      priority_reason = excluded.priority_reason,
      data_quality = excluded.data_quality,
      source_occurred_at = excluded.source_occurred_at,
      updated_at = as_of
    where public.opportunities.status in ('open', 'in_contact');
    if found then v_upsert_count := v_upsert_count + 1; end if;
  end loop;

  for v_client in
    select c.id as client_id, c.clinic_id, last_visit.id as appointment_id,
           last_visit.pet_id, last_visit.starts_at,
           exists (
             select 1 from public.import_rows ir
             where ir.clinic_id = c.clinic_id and ir.appointment_id = last_visit.id and ir.possible_duplicate
           ) as ambiguous
    from public.clients c
    join lateral (
      select a.id, a.pet_id, a.starts_at
      from public.appointments a
      where a.clinic_id = c.clinic_id and a.client_id = c.id
        and a.status = 'completed' and a.import_id is not null and a.starts_at is not null
      order by a.starts_at desc, a.id
      limit 1
    ) last_visit on true
    where c.clinic_id = target_clinic_id
      and last_visit.starts_at <= as_of - interval '180 days'
      and not exists (
        select 1 from public.appointments later_a
        where later_a.clinic_id = c.clinic_id and later_a.client_id = c.id
          and later_a.import_id is not null and later_a.starts_at > last_visit.starts_at
      )
      and not exists (
        select 1 from public.appointments unknown_a
        where unknown_a.clinic_id = c.clinic_id and unknown_a.client_id = c.id
          and unknown_a.import_id is not null and unknown_a.starts_at is null
      )
      and not exists (
        select 1 from public.quotes later_q
        where later_q.clinic_id = c.clinic_id and later_q.client_id = c.id
          and later_q.import_id is not null and later_q.issued_at > last_visit.starts_at
      )
      and not exists (
        select 1 from public.quotes unknown_q
        where unknown_q.clinic_id = c.clinic_id and unknown_q.client_id = c.id
          and unknown_q.import_id is not null and unknown_q.issued_at is null
      )
  loop
    v_age := greatest(0, floor(extract(epoch from (as_of - v_client.starts_at)) / 86400)::integer);
    v_quality := case when v_client.ambiguous then 'review' else 'complete' end;
    v_priority := case when v_age >= 365 then 'high' else 'medium' end;
    if v_quality = 'review' then v_priority := case v_priority when 'high' then 'medium' else 'low' end; end if;
    insert into public.opportunities (
      clinic_id, client_id, pet_id, appointment_id, opportunity_type, status, potential_value,
      source_record_type, source_record_id, recommendation_reason, recommended_action,
      priority, priority_reason, value_source, data_quality, source_occurred_at
    ) values (
      target_clinic_id, v_client.client_id, v_client.pet_id, v_client.appointment_id,
      'inactive_client', 'open', null, 'appointment', v_client.appointment_id,
      'Cliente sem orçamento ou atendimento posterior ao atendimento concluído há ' || v_age::text || ' dia(s).',
      'Revisar o histórico antes de oferecer retorno ou novo agendamento.',
      v_priority,
      v_priority || ': última atividade concluída há 365+ dias = alta; 180–364 dias = média.' ||
        case when v_quality = 'review' then ' Prioridade reduzida por possível duplicidade; revisar antes de agir.' else '' end,
      null, v_quality, v_client.starts_at
    )
    on conflict (clinic_id, opportunity_type, source_record_type, source_record_id)
      where source_record_type in ('quote', 'appointment')
    do update set
      client_id = excluded.client_id,
      pet_id = excluded.pet_id,
      appointment_id = excluded.appointment_id,
      recommendation_reason = excluded.recommendation_reason,
      recommended_action = excluded.recommended_action,
      priority = excluded.priority,
      priority_reason = excluded.priority_reason,
      data_quality = excluded.data_quality,
      source_occurred_at = excluded.source_occurred_at,
      updated_at = as_of
    where public.opportunities.status in ('open', 'in_contact');
    if found then v_upsert_count := v_upsert_count + 1; end if;
  end loop;

  return jsonb_build_object('upserted', v_upsert_count, 'needs_review', v_review_count, 'reviews', v_reviews);
end;
$$;

create or replace function public.record_clinic_opportunity_action(
  p_opportunity_id uuid,
  p_target_status text,
  p_reason text default null,
  p_confirmed_revenue numeric default null,
  p_evidence_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_clinic_id uuid;
  v_current_status text;
  v_action_type text;
  v_reason text := nullif(btrim(p_reason), '');
  v_evidence text := nullif(btrim(p_evidence_reference), '');
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  select o.clinic_id, o.status into v_clinic_id, v_current_status
  from public.opportunities o where o.id = p_opportunity_id for update;
  if v_clinic_id is null or not public.is_clinic_member(v_clinic_id) then
    raise exception using errcode = '42501', message = 'clinic_membership_required';
  end if;
  if v_current_status not in ('open', 'in_contact') then
    raise exception using errcode = '22023', message = 'opportunity_already_closed';
  end if;
  if p_target_status is null or p_target_status not in ('in_contact', 'won', 'dismissed', 'invalid') then
    raise exception using errcode = '22023', message = 'invalid_opportunity_status';
  end if;
  if length(coalesce(v_reason, '')) > 1000 or length(coalesce(v_evidence, '')) > 200 then
    raise exception using errcode = '22023', message = 'action_text_too_long';
  end if;
  if p_target_status in ('dismissed', 'invalid') and v_reason is null then
    raise exception using errcode = '22023', message = 'reason_required';
  end if;
  if p_target_status = 'won' then
    if p_confirmed_revenue is null or p_confirmed_revenue < 0 or p_confirmed_revenue > 999999999999 or v_evidence is null then
      raise exception using errcode = '22023', message = 'sale_amount_and_evidence_required';
    end if;
  elsif p_confirmed_revenue is not null or v_evidence is not null then
    raise exception using errcode = '22023', message = 'sale_evidence_only_for_won';
  end if;

  update public.opportunities
  set status = p_target_status, updated_at = now()
  where id = p_opportunity_id and clinic_id = v_clinic_id;

  v_action_type := case when p_target_status = 'won' then 'sale_confirmed' when p_target_status = 'in_contact' then 'contacted' else 'status_changed' end;
  insert into public.action_history (
    clinic_id, opportunity_id, actor_user_id, action_type, notes,
    confirmed_revenue, attributed_revenue, attribution_method, evidence_reference
  ) values (
    v_clinic_id, p_opportunity_id, v_user_id, v_action_type,
    coalesce(v_reason, case p_target_status when 'in_contact' then 'Contato registrado pela equipe.' when 'won' then 'Venda concluída; evidência registrada.' else null end),
    case when p_target_status = 'won' then p_confirmed_revenue else null end,
    null,
    null,
    case when p_target_status = 'won' then v_evidence else null end
  );
  return jsonb_build_object('opportunity_id', p_opportunity_id, 'status', p_target_status);
end;
$$;

create or replace function public.clinic_intelligence_totals(target_clinic_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if not public.is_clinic_member(target_clinic_id) then
    raise exception using errcode = '42501', message = 'clinic_membership_required';
  end if;

  with active_opportunities as (
    select o.id, o.opportunity_type, o.status, o.quote_id, o.potential_value,
           case when o.quote_id is not null then 'quote:' || o.quote_id::text else 'opportunity:' || o.id::text end as financial_key
    from public.opportunities o
    where o.clinic_id = target_clinic_id and o.status in ('open', 'in_contact')
  ), deduplicated_potential as (
    select financial_key, max(potential_value) as amount,
           bool_or(status = 'in_contact') as in_negotiation
    from active_opportunities
    where potential_value is not null
    group by financial_key
  ), evidenced_sales as (
    select evidence_reference, max(confirmed_revenue) as amount
    from public.action_history
    where clinic_id = target_clinic_id
      and action_type = 'sale_confirmed'
      and evidence_reference is not null
      and confirmed_revenue is not null
    group by evidence_reference
  )
  select jsonb_build_object(
    'pending_opportunity_count', (select count(*) from active_opportunities where status = 'open'),
    'pending_potential_value', coalesce((select sum(amount) from deduplicated_potential), 0),
    'potential_value', coalesce((select sum(amount) from deduplicated_potential), 0),
    'negotiation_value', coalesce((select sum(amount) from deduplicated_potential where in_negotiation), 0),
    'confirmed_revenue', coalesce((select sum(amount) from evidenced_sales), 0),
    'attributed_revenue', 0
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.refresh_clinic_opportunities(uuid, timestamptz) from public, anon;
grant execute on function public.refresh_clinic_opportunities(uuid, timestamptz) to authenticated;
revoke all on function public.record_clinic_opportunity_action(uuid, text, text, numeric, text) from public, anon;
grant execute on function public.record_clinic_opportunity_action(uuid, text, text, numeric, text) to authenticated;
revoke all on function public.clinic_intelligence_totals(uuid) from public, anon;
grant execute on function public.clinic_intelligence_totals(uuid) to authenticated;
