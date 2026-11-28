-- 0041: release-blocker payout fixes (CR-01, CR-03). Additive and safe to apply to a live database.

-- CR-03: a PayPal submission is claimed atomically before the provider call, so an attempt
-- is never resubmitted automatically after a lost database write.
alter table public.provider_payout_attempts add column if not exists submit_claimed_at timestamptz;
create index if not exists provider_payout_attempts_unclaimed_idx
 on public.provider_payout_attempts(created_at)
 where state='PROCESSING' and provider_reference is null and submit_claimed_at is null;

-- CR-01: verifying or disabling a payout method also maintains exactly one default
-- (request_participant_payout requires a VERIFIED default method).
create or replace function public.set_payout_method_status(
 p_method_id uuid,p_status text,p_actor_user_id uuid,p_actor_label text,p_role text,p_reason text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_method participant_payout_methods%rowtype; v_status text:=upper(trim(coalesce(p_status,''))); v_promoted uuid; v_is_default boolean:=false;
begin
 if v_status not in('VERIFIED','DISABLED') or trim(coalesce(p_reason,''))='' then raise exception 'invalid_payout_method_status'; end if;
 select * into v_method from participant_payout_methods where id=p_method_id;
 if not found then raise exception 'payout_method_not_found'; end if;
 -- Serialize every default change for this participant.
 perform 1 from participants where id=v_method.participant_id for update;
 select * into v_method from participant_payout_methods where id=p_method_id for update;

 if v_status='VERIFIED' then
  if v_method.status='DISABLED' then raise exception 'disabled_payout_method_cannot_be_verified'; end if;
  -- The most recently verified method becomes the default; clear the old one first (unique index).
  update participant_payout_methods set is_default=false
   where participant_id=v_method.participant_id and id<>p_method_id and is_default;
  update participant_payout_methods set status='VERIFIED',is_default=true where id=p_method_id;
  v_is_default:=true;
 else
  update participant_payout_methods set status='DISABLED',is_default=false where id=p_method_id;
  if v_method.is_default then
   select id into v_promoted from participant_payout_methods
    where participant_id=v_method.participant_id and status='VERIFIED' and id<>p_method_id
    order by updated_at desc,created_at desc limit 1;
   if v_promoted is not null then update participant_payout_methods set is_default=true where id=v_promoted; end if;
  end if;
 end if;

 insert into audit_events(actor_user_id,actor_label,role,operation,resource_type,resource_id,before_data,after_data,reason)
 values(p_actor_user_id,p_actor_label,nullif(p_role,'')::admin_role,'PAYOUT_METHOD_'||v_status,'PAYOUT_METHOD',p_method_id,
  jsonb_build_object('status',v_method.status,'is_default',v_method.is_default,'provider',v_method.provider),
  jsonb_build_object('status',v_status,'is_default',v_is_default,'provider',v_method.provider,'promoted_method_id',v_promoted),p_reason);

 return jsonb_build_object('ok',true,'methodId',p_method_id,'status',v_status,'isDefault',v_is_default,'promotedMethodId',v_promoted);
end $$;
revoke all on function public.set_payout_method_status(uuid,text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.set_payout_method_status(uuid,text,uuid,text,text,text) to service_role;

-- Backfill: participants who already have a VERIFIED method but no default get their newest one.
update participant_payout_methods m set is_default=true
from (
 select distinct on (participant_id) id from participant_payout_methods v
 where status='VERIFIED'
  and not exists(select 1 from participant_payout_methods d where d.participant_id=v.participant_id and d.is_default and d.status<>'DISABLED')
 order by participant_id,created_at desc
) pick
where m.id=pick.id;
