-- Reconcile persisted opportunities with current imported source statuses.
alter table public.opportunities
  add column if not exists data_quality_notes text;

create or replace function public.reconcile_clinic_opportunities(
  target_clinic_id uuid,
  as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
  v_reviews jsonb;
  v_closed bigint := 0;
  v_changed bigint := 0;
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

  v_result := public.refresh_clinic_opportunities(target_clinic_id, as_of);
  v_reviews := coalesce(v_result->'reviews', '[]'::jsonb);

  -- Future-dated source events are visible for review but never remain actionable.
  select v_reviews || coalesce(jsonb_agg(jsonb_build_object(
    'source_record_type', 'quote', 'source_record_id', q.id,
    'reason', 'Orçamento pendente com data de emissão no futuro; revise a data antes de agir.'
  )), '[]'::jsonb) into v_reviews
  from public.quotes q
  where q.clinic_id = target_clinic_id and q.import_id is not null
    and q.status = 'pending' and q.issued_at > as_of;
  select v_reviews || coalesce(jsonb_agg(jsonb_build_object(
    'source_record_type', 'appointment', 'source_record_id', a.id,
    'reason', 'Atendimento concluído com data no futuro; revise a data antes de agir.'
  )), '[]'::jsonb) into v_reviews
  from public.appointments a
  where a.clinic_id = target_clinic_id and a.import_id is not null
    and a.status = 'completed' and a.starts_at > as_of;

  -- Carry missing or ambiguous input facts onto the persisted opportunity for review.
  update public.opportunities o
  set data_quality_notes = q.notes,
      data_quality = case when q.notes is null then 'complete' else 'review' end,
      priority = case
        when q.notes is not null and o.data_quality <> 'review' then
          case o.priority when 'high' then 'medium' when 'medium' then 'low' else 'low' end
        else o.priority
      end,
      priority_reason = case when q.notes is not null
        then (case
          when o.data_quality <> 'review' then case o.priority when 'high' then 'medium' when 'medium' then 'low' else 'low' end
          else o.priority
        end) || ': prioridade reduzida por informações incompletas; regra base: ' ||
          coalesce(regexp_replace(o.priority_reason, '^[^:]+: *', ''), 'idade, prazo e valor observados')
        else o.priority_reason end
  from (
    select q.id, q.clinic_id,
      nullif(concat_ws(' ',
        case when q.amount is null then 'Valor do orçamento ausente.' end,
        case when exists (
          select 1 from public.import_rows ir
          where ir.clinic_id = q.clinic_id and ir.quote_id = q.id and ir.possible_duplicate
        ) then 'Possível duplicidade apontada pela importação.' end
      ), '') as notes
    from public.quotes q
  ) q
  where o.clinic_id = target_clinic_id and o.quote_id = q.id and q.clinic_id = target_clinic_id
    and o.status in ('open', 'in_contact');

  update public.opportunities o
  set data_quality_notes = case when exists (
        select 1 from public.import_rows ir
        where ir.clinic_id = o.clinic_id and ir.appointment_id = o.appointment_id and ir.possible_duplicate
      ) then 'Possível duplicidade apontada pela importação.' else null end,
      data_quality = case when exists (
        select 1 from public.import_rows ir
        where ir.clinic_id = o.clinic_id and ir.appointment_id = o.appointment_id and ir.possible_duplicate
      ) then 'review' else 'complete' end
  where o.clinic_id = target_clinic_id and o.appointment_id is not null
    and o.status in ('open', 'in_contact') and o.opportunity_type in ('overdue_follow_up', 'inactive_client');

  -- Accepted/declined/expired/cancelled quotes are not pending-response sales.
  with changed as (
    update public.opportunities o
    set status = 'invalid', updated_at = as_of,
        recommendation_reason = case
          when q.issued_at is null or q.issued_at > as_of then 'Data de emissão ausente ou no futuro; requer revisão.'
          else 'O orçamento saiu do status pendente (' || coalesce(q.status, 'sem status') || '). Isso não comprova uma venda.'
        end
    from public.quotes q
    where o.clinic_id = target_clinic_id and o.quote_id = q.id and q.clinic_id = target_clinic_id
      and o.source_record_type = 'quote' and o.opportunity_type = 'pending_quote'
      and o.status in ('open', 'in_contact') and (q.status is distinct from 'pending' or q.issued_at is null or q.issued_at > as_of)
    returning o.id, o.clinic_id
  )
  insert into public.action_history (clinic_id, opportunity_id, actor_user_id, action_type, notes)
  select c.clinic_id, c.id, v_user_id, 'status_changed',
         'Oportunidade encerrada porque a origem não está mais pendente; isso não confirma uma venda.'
  from changed c;
  get diagnostics v_closed = row_count;

  -- Follow-up is reserved for days 2–179; an older last event is classified as inactivity.
  with changed as (
    update public.opportunities o
    set status = 'invalid', updated_at = as_of,
        recommendation_reason = 'O atendimento deixou de se qualificar como acompanhamento atrasado.'
    from public.appointments a
    where o.clinic_id = target_clinic_id and o.appointment_id = a.id and a.clinic_id = target_clinic_id
      and o.source_record_type = 'appointment' and o.opportunity_type = 'overdue_follow_up'
      and o.status in ('open', 'in_contact')
      and (a.status is distinct from 'completed' or a.starts_at is null or a.starts_at <= as_of - interval '180 days')
    returning o.id, o.clinic_id
  )
  insert into public.action_history (clinic_id, opportunity_id, actor_user_id, action_type, notes)
  select c.clinic_id, c.id, v_user_id, 'status_changed',
         'Oportunidade encerrada automaticamente: o atendimento deixou de se qualificar como acompanhamento atrasado.'
  from changed c;
  get diagnostics v_changed = row_count;
  v_closed := v_closed + v_changed;

  -- An inactivity opportunity is stale if there is any later or undated commercial event.
  with changed as (
    update public.opportunities o
    set status = 'invalid', updated_at = as_of,
        recommendation_reason = 'Há evento posterior ou data ausente; a inatividade não pode ser confirmada.'
    from public.appointments a
    where o.clinic_id = target_clinic_id and o.appointment_id = a.id and a.clinic_id = target_clinic_id
      and o.source_record_type = 'appointment' and o.opportunity_type = 'inactive_client'
      and o.status in ('open', 'in_contact')
      and (
        a.status is distinct from 'completed' or a.starts_at is null
        or exists (select 1 from public.appointments x where x.clinic_id = target_clinic_id and x.client_id = o.client_id and x.import_id is not null and (x.starts_at is null or x.starts_at > a.starts_at))
        or exists (select 1 from public.quotes x where x.clinic_id = target_clinic_id and x.client_id = o.client_id and x.import_id is not null and (x.issued_at is null or x.issued_at > a.starts_at))
      )
    returning o.id, o.clinic_id
  )
  insert into public.action_history (clinic_id, opportunity_id, actor_user_id, action_type, notes)
  select c.clinic_id, c.id, v_user_id, 'status_changed',
         'Oportunidade encerrada automaticamente: existe atividade posterior ou informação de data pendente de revisão.'
  from changed c;
  get diagnostics v_changed = row_count;
  v_closed := v_closed + v_changed;

  return v_result || jsonb_build_object('closed_stale', v_closed, 'reviews', v_reviews);
end;
$$;

revoke all on function public.reconcile_clinic_opportunities(uuid, timestamptz) from public, anon;
grant execute on function public.reconcile_clinic_opportunities(uuid, timestamptz) to authenticated;
