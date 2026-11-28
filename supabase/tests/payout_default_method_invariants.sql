\set ON_ERROR_STOP on
-- CR-01 / CR-03 regression tests for migration 0041.
begin;
do $$
declare p uuid; m1 uuid; m2 uuid; m3 uuid; payout uuid; attempt uuid; r jsonb; n integer;
begin
 insert into participants(first_name,email,country_code,primary_language_code)
 values('Default','default-method-test@example.test','US','en') returning id into p;

 -- Methods are created exactly as POST /api/payout-method does: PENDING, not default.
 insert into participant_payout_methods(participant_id,provider,provider_recipient_reference,label,status,is_default)
 values(p,'PAYPAL','v1:x:y:z','First','PENDING',false) returning id into m1;
 insert into participant_payout_methods(participant_id,provider,provider_recipient_reference,label,status,is_default)
 values(p,'PAYPAL','v1:x:y:z','Second','PENDING',false) returning id into m2;
 insert into ledger_entries(participant_id,entry_type,amount_cents,currency,idempotency_key)
 values(p,'CAMPAIGN_EARNING',3000,'USD','earning:default-method-test');

 -- Before the fix this was the dead end: no default, payout request impossible.
 begin perform request_participant_payout(p,1000,'USD','default-test:before'); raise exception 'payout_allowed_without_default';
 exception when others then if sqlerrm not like '%verified_default_payout_method_required%' then raise; end if; end;

 -- First verification makes the method the default.
 r:=set_payout_method_status(m1,'VERIFIED',null,'TEST','SUPER_ADMIN','KYC checked');
 if not (select is_default from participant_payout_methods where id=m1) then raise exception 'first_verified_not_default'; end if;
 payout:=request_participant_payout(p,1000,'USD','default-test:after');
 if (select payout_method_id from payouts where id=payout)<>m1 then raise exception 'payout_not_frozen_to_default'; end if;

 -- Verifying a second method moves the default; still exactly one.
 r:=set_payout_method_status(m2,'VERIFIED',null,'TEST','PAYMENTS','New PayPal');
 select count(*) into n from participant_payout_methods where participant_id=p and is_default and status<>'DISABLED';
 if n<>1 then raise exception 'default_count_not_one:%',n; end if;
 if not (select is_default from participant_payout_methods where id=m2) then raise exception 'second_verified_not_default'; end if;
 -- The in-flight payout stays frozen to its original method.
 if (select payout_method_id from payouts where id=payout)<>m1 then raise exception 'frozen_method_changed'; end if;

 -- Disabling the default promotes the remaining verified method.
 r:=set_payout_method_status(m2,'DISABLED',null,'TEST','PAYMENTS','Closed account');
 if (r->>'promotedMethodId')::uuid<>m1 then raise exception 'no_promotion:%',r; end if;
 if not (select is_default from participant_payout_methods where id=m1) then raise exception 'promoted_not_default'; end if;
 if (select is_default or status<>'DISABLED' from participant_payout_methods where id=m2) then raise exception 'disabled_still_default'; end if;

 -- A disabled method cannot be re-verified.
 begin perform set_payout_method_status(m2,'VERIFIED',null,'TEST','PAYMENTS','retry'); raise exception 'disabled_reverified';
 exception when others then if sqlerrm not like '%disabled_payout_method_cannot_be_verified%' then raise; end if; end;

 -- Reason is mandatory; audit rows are written.
 begin perform set_payout_method_status(m1,'VERIFIED',null,'TEST','PAYMENTS',' '); raise exception 'blank_reason_allowed';
 exception when others then if sqlerrm not like '%invalid_payout_method_status%' then raise; end if; end;
 if (select count(*) from audit_events where resource_id in(m1,m2) and resource_type='PAYOUT_METHOD')<>3 then raise exception 'audit_rows_missing'; end if;

 -- Disabling the only method leaves no default (payouts blocked until a new method is verified).
 insert into participant_payout_methods(participant_id,provider,provider_recipient_reference,label,status,is_default)
 values(p,'PAYPAL','v1:x:y:z','Third','PENDING',false) returning id into m3;
 r:=set_payout_method_status(m1,'DISABLED',null,'TEST','PAYMENTS','Closed');
 if exists(select 1 from participant_payout_methods where participant_id=p and is_default and status<>'DISABLED') then raise exception 'pending_method_became_default'; end if;

 -- CR-03: the submission claim can be won exactly once.
 update participant_payout_methods set is_default=false where participant_id=p;
 r:=set_payout_method_status(m3,'VERIFIED',null,'TEST','PAYMENTS','ok');
 attempt:=create_payout_attempt(payout,'default-test:attempt',null,'TEST');
 update provider_payout_attempts set submit_claimed_at=now() where id=attempt and state='PROCESSING' and provider_reference is null and submit_claimed_at is null;
 get diagnostics n=row_count; if n<>1 then raise exception 'first_claim_failed'; end if;
 update provider_payout_attempts set submit_claimed_at=now() where id=attempt and state='PROCESSING' and provider_reference is null and submit_claimed_at is null;
 get diagnostics n=row_count; if n<>0 then raise exception 'second_claim_won'; end if;
end $$;
rollback;
