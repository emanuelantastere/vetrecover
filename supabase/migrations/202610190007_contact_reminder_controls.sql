-- Atomically register a contact event and explicitly keep, clear, or reschedule
-- an existing follow-up reminder. Migration 005 remains compatible and intact.
create or replace function public.record_clinic_opportunity_event_with_reminder(
  p_opportunity_id uuid,
  p_event_type text,
  p_notes text default null,
  p_next_action_at timestamptz default null,
  p_next_action_note text default null,
  p_request_id uuid default null,
  p_reminder_action text default 'keep'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_clinic uuid;
  v_status text;
  v_target text;
  v_notes text := nullif(btrim(p_notes), '');
  v_existing public.action_history%rowtype;
  v_log_notes text;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'request_id_required';
  end if;
  if p_event_type not in ('contact_attempted', 'contacted', 'no_response') then
    raise exception using errcode = '22023', message = 'invalid_event_type';
  end if;
  if p_reminder_action is null or p_reminder_action not in ('keep', 'clear', 'schedule') then
    raise exception using errcode = '22023', message = 'invalid_reminder_action';
  end if;
  if length(coalesce(v_notes, '')) > 1000 or length(coalesce(p_next_action_note, '')) > 500 then
    raise exception using errcode = '22023', message = 'action_text_too_long';
  end if;
  if p_reminder_action = 'schedule' then
    if p_next_action_at is null or p_next_action_at <= now() then
      raise exception using errcode = '22023', message = 'future_follow_up_required';
    end if;
  elsif p_next_action_at is not null or nullif(btrim(p_next_action_note), '') is not null then
    raise exception using errcode = '22023', message = 'reminder_fields_require_schedule';
  end if;

  select o.clinic_id, o.status into v_clinic, v_status
  from public.opportunities o where o.id = p_opportunity_id for update;
  if v_clinic is null or not public.is_clinic_member(v_clinic) then
    raise exception using errcode = '42501', message = 'clinic_membership_required';
  end if;

  select * into v_existing from public.action_history
  where clinic_id = v_clinic and actor_user_id = v_user and request_id = p_request_id;
  if found then
    if v_existing.opportunity_id <> p_opportunity_id then
      raise exception using errcode = '22023', message = 'request_id_conflict';
    end if;
    return jsonb_build_object('opportunity_id', p_opportunity_id, 'status', v_status, 'replayed', true);
  end if;
  if v_status not in ('open', 'in_contact', 'waiting_reply') then
    raise exception using errcode = '22023', message = 'opportunity_already_closed';
  end if;

  v_target := case
    when p_event_type = 'no_response' then 'waiting_reply'
    when p_reminder_action = 'schedule' then 'waiting_reply'
    else 'in_contact'
  end;
  v_log_notes := coalesce(v_notes, case p_event_type
    when 'contact_attempted' then 'Tentativa de contato registrada.'
    when 'contacted' then 'Contato realizado.'
    else 'Sem resposta registrada.' end);
  if p_reminder_action = 'clear' then
    v_log_notes := v_log_notes || ' Retorno anterior marcado como concluido pela equipe.';
  elsif p_reminder_action = 'schedule' then
    v_log_notes := v_log_notes || ' Retorno atualizado pela equipe.';
  end if;

  update public.opportunities
  set status = v_target,
      updated_at = now(),
      next_action_at = case
        when p_reminder_action = 'clear' then null
        when p_reminder_action = 'schedule' then p_next_action_at
        else next_action_at
      end,
      next_action_note = case
        when p_reminder_action = 'clear' then null
        when p_reminder_action = 'schedule' then nullif(btrim(p_next_action_note), '')
        else next_action_note
      end
  where id = p_opportunity_id and clinic_id = v_clinic;

  insert into public.action_history (
    clinic_id, opportunity_id, actor_user_id, action_type, notes, request_id
  ) values (
    v_clinic, p_opportunity_id, v_user,
    p_event_type, v_log_notes, p_request_id
  );
  return jsonb_build_object(
    'opportunity_id', p_opportunity_id,
    'status', v_target,
    'reminder_action', p_reminder_action,
    'replayed', false
  );
end;
$$;

revoke all on function public.record_clinic_opportunity_event_with_reminder(uuid, text, text, timestamptz, text, uuid, text) from public, anon, authenticated;
grant execute on function public.record_clinic_opportunity_event_with_reminder(uuid, text, text, timestamptz, text, uuid, text) to authenticated;
