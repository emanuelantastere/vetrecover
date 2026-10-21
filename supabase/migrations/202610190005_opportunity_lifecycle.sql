-- Extend the existing opportunity lifecycle without changing import behavior.
alter table public.opportunities
  add column if not exists next_action_at timestamptz,
  add column if not exists next_action_note text;

alter table public.opportunities drop constraint if exists opportunities_status_check;
alter table public.opportunities add constraint opportunities_status_check
  check (status = any (array['open','in_contact','waiting_reply','won','dismissed','invalid']::text[]));

alter table public.action_history add column if not exists request_id uuid;
alter table public.action_history drop constraint if exists action_history_action_type_check;
alter table public.action_history add constraint action_history_action_type_check
  check (action_type = any (array['recommendation_approved','recommendation_rejected','contact_attempted','contacted','no_response','follow_up_scheduled','sale_confirmed','note_added','status_changed']::text[]));
create unique index if not exists action_history_request_id_idx
  on public.action_history (clinic_id, actor_user_id, request_id) where request_id is not null;

create or replace function public.record_clinic_opportunity_event(
  p_opportunity_id uuid,
  p_event_type text,
  p_notes text default null,
  p_next_action_at timestamptz default null,
  p_next_action_note text default null,
  p_confirmed_revenue numeric default null,
  p_evidence_reference text default null,
  p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_clinic uuid;
  v_status text;
  v_target text;
  v_action text;
  v_notes text := nullif(btrim(p_notes), '');
  v_evidence text := nullif(btrim(p_evidence_reference), '');
  v_existing public.action_history%rowtype;
begin
  if v_user is null then raise exception using errcode='42501', message='authentication_required'; end if;
  if p_request_id is null then raise exception using errcode='22023', message='request_id_required'; end if;
  select o.clinic_id,o.status into v_clinic,v_status from public.opportunities o where o.id=p_opportunity_id for update;
  if v_clinic is null or not public.is_clinic_member(v_clinic) then raise exception using errcode='42501', message='clinic_membership_required'; end if;
  select * into v_existing from public.action_history
    where clinic_id=v_clinic and actor_user_id=v_user and request_id=p_request_id;
  if found then
    if v_existing.opportunity_id <> p_opportunity_id then raise exception using errcode='22023', message='request_id_conflict'; end if;
    return jsonb_build_object('opportunity_id',p_opportunity_id,'status',v_status,'replayed',true);
  end if;
  if v_status not in ('open','in_contact','waiting_reply') then raise exception using errcode='22023', message='opportunity_already_closed'; end if;
  if length(coalesce(v_notes,''))>1000 or length(coalesce(p_next_action_note,''))>500 or length(coalesce(v_evidence,''))>200 then raise exception using errcode='22023', message='action_text_too_long'; end if;

  case p_event_type
    when 'contact_attempted' then v_target:='in_contact'; v_action:='contact_attempted';
    when 'contacted' then v_target:='in_contact'; v_action:='contacted';
    when 'no_response' then v_target:='waiting_reply'; v_action:='no_response';
    when 'follow_up_scheduled' then
      if p_next_action_at is null or p_next_action_at <= now() then raise exception using errcode='22023', message='future_follow_up_required'; end if;
      v_target:='waiting_reply'; v_action:='follow_up_scheduled';
    when 'note_added' then
      if v_notes is null then raise exception using errcode='22023', message='note_required'; end if;
      v_target:=v_status; v_action:='note_added';
    when 'won' then
      if p_confirmed_revenue is null or p_confirmed_revenue<0 or p_confirmed_revenue>999999999999 or v_evidence is null then raise exception using errcode='22023', message='sale_amount_and_evidence_required'; end if;
      v_target:='won'; v_action:='sale_confirmed';
    when 'dismissed' then
      if v_notes is null then raise exception using errcode='22023', message='reason_required'; end if;
      v_target:='dismissed'; v_action:='status_changed';
    when 'invalid' then
      if v_notes is null then raise exception using errcode='22023', message='reason_required'; end if;
      v_target:='invalid'; v_action:='status_changed';
    else raise exception using errcode='22023', message='invalid_event_type';
  end case;
  if p_event_type <> 'won' and (p_confirmed_revenue is not null or v_evidence is not null) then raise exception using errcode='22023', message='sale_evidence_only_for_won'; end if;
  update public.opportunities set status=v_target, updated_at=now(),
    next_action_at=case when p_event_type='follow_up_scheduled' then p_next_action_at when p_event_type in ('won','dismissed','invalid') then null else next_action_at end,
    next_action_note=case when p_event_type='follow_up_scheduled' then nullif(btrim(p_next_action_note),'') when p_event_type in ('won','dismissed','invalid') then null else next_action_note end
    where id=p_opportunity_id and clinic_id=v_clinic;
  insert into public.action_history (clinic_id,opportunity_id,actor_user_id,action_type,notes,confirmed_revenue,evidence_reference,request_id)
    values (v_clinic,p_opportunity_id,v_user,v_action,coalesce(v_notes,case p_event_type when 'contact_attempted' then 'Tentativa de contato registrada.' when 'contacted' then 'Contato realizado.' when 'no_response' then 'Sem resposta registrada.' when 'follow_up_scheduled' then 'Retorno agendado.' when 'won' then 'Venda concluída com evidência.' else null end),
      case when p_event_type='won' then p_confirmed_revenue else null end,case when p_event_type='won' then v_evidence else null end,p_request_id);
  return jsonb_build_object('opportunity_id',p_opportunity_id,'status',v_target,'replayed',false);
end; $$;

revoke all on function public.record_clinic_opportunity_event(uuid,text,text,timestamptz,text,numeric,text,uuid) from public,anon;
grant execute on function public.record_clinic_opportunity_event(uuid,text,text,timestamptz,text,numeric,text,uuid) to authenticated;

-- The legacy status-only RPC must not bypass the event log after this migration.
revoke all on function public.record_clinic_opportunity_action(uuid,text,text,numeric,text) from public,anon,authenticated;

create or replace function public.clinic_intelligence_totals(target_clinic_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='authentication_required'; end if;
  if not public.is_clinic_member(target_clinic_id) then raise exception using errcode='42501', message='clinic_membership_required'; end if;
  with active_opportunities as (
    select o.id,o.status,o.quote_id,o.potential_value,
      case when o.quote_id is not null then 'quote:'||o.quote_id::text else 'opportunity:'||o.id::text end as financial_key
    from public.opportunities o where o.clinic_id=target_clinic_id and o.status in ('open','in_contact','waiting_reply')
  ), deduplicated_potential as (
    select financial_key,max(potential_value) as amount,bool_or(status in ('in_contact','waiting_reply')) as in_negotiation
    from active_opportunities where potential_value is not null group by financial_key
  ), evidenced_sales as (
    select evidence_reference,max(confirmed_revenue) as amount from public.action_history
    where clinic_id=target_clinic_id and action_type='sale_confirmed' and evidence_reference is not null and confirmed_revenue is not null
    group by evidence_reference
  )
  select jsonb_build_object(
    'pending_opportunity_count',(select count(*) from active_opportunities where status='open'),
    'pending_potential_value',coalesce((select sum(amount) from deduplicated_potential),0),
    'potential_value',coalesce((select sum(amount) from deduplicated_potential),0),
    'negotiation_value',coalesce((select sum(amount) from deduplicated_potential where in_negotiation),0),
    'confirmed_revenue',coalesce((select sum(amount) from evidenced_sales),0),
    'attributed_revenue',0
  ) into v_result;
  return v_result;
end; $$;
revoke all on function public.clinic_intelligence_totals(uuid) from public,anon;
grant execute on function public.clinic_intelligence_totals(uuid) to authenticated;

-- Keep reconciliation active for opportunities awaiting a reply.
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
    and o.status in ('open', 'in_contact', 'waiting_reply');

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
    and o.status in ('open', 'in_contact', 'waiting_reply') and o.opportunity_type in ('overdue_follow_up', 'inactive_client');

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
      and o.status in ('open', 'in_contact', 'waiting_reply') and (q.status is distinct from 'pending' or q.issued_at is null or q.issued_at > as_of)
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
      and o.status in ('open', 'in_contact', 'waiting_reply')
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
      and o.status in ('open', 'in_contact', 'waiting_reply')
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


revoke all on function public.reconcile_clinic_opportunities(uuid,timestamptz) from public,anon;
grant execute on function public.reconcile_clinic_opportunities(uuid,timestamptz) to authenticated;
