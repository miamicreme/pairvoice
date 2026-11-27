import {NextRequest,NextResponse} from 'next/server';
import {serviceClient} from '../../../../lib/supabase-server';
import {createPayPalPayout} from '../../../../lib/paypal';
import {subsystemEnabled} from '../../../../lib/subsystem-controls';
import {resolvePayPalRecipient} from '../../../../lib/payout-recipient';
import {classifyPayPalSubmitError} from '../../../../lib/paypal-outcome';

function authorized(req:NextRequest){
 const expected=process.env.PAIRVOICE_INTERNAL_SECRET||process.env.CRON_SECRET;
 return Boolean(expected&&req.headers.get('authorization')===`Bearer ${expected}`);
}

type Db=ReturnType<typeof serviceClient>;

async function reconcile(db:Db,attemptId:string,outcome:'FAILED'|'UNKNOWN',stage:string,message:string,extra:Record<string,unknown>={}){
 const {error}=await db.rpc('reconcile_payout_attempt',{
  p_attempt_id:attemptId,p_outcome:outcome,p_provider_reference:null,
  p_result_metadata:{stage,...extra},p_last_error:message,
  p_actor_user_id:null,p_actor_label:'SYSTEM:PAYPAL',
  p_reason:outcome==='FAILED'?'PayPal payout rejected before any money moved':'PayPal payout outcome uncertain; reconcile against PayPal before retrying'
 });
 if(error)console.error('payout reconcile failed',attemptId,outcome,error.message);
}

export async function POST(req:NextRequest){
 if(!authorized(req))return NextResponse.json({error:'Forbidden'},{status:403});
 const db=serviceClient();
 if(!await subsystemEnabled(db,'PAYOUT'))return NextResponse.json({ok:true,paused:true,processed:0});
 const {data:attempts,error}=await db.from('provider_payout_attempts')
  .select('id,payout_id,idempotency_key,provider_reference')
  .eq('provider','paypal-payouts').eq('state','PROCESSING').is('provider_reference',null).is('submit_claimed_at',null)
  .order('created_at',{ascending:true}).limit(10);
 if(error)return NextResponse.json({error:'Unable to load payout queue.'},{status:500});

 let submitted=0,failed=0,uncertain=0,skipped=0,retry=0;
 for(const attempt of attempts||[]){
  // CR-03: claim the attempt atomically before any provider call. Only one worker can
  // win the claim, and a claimed attempt is never picked up again automatically, so a
  // lost database write can never cause a resubmission that is then marked FAILED.
  const {data:claimed,error:claimError}=await db.from('provider_payout_attempts')
   .update({submit_claimed_at:new Date().toISOString()})
   .eq('id',attempt.id).eq('state','PROCESSING').is('provider_reference',null).is('submit_claimed_at',null)
   .select('id');
  if(claimError||!claimed?.length){skipped++;continue}

  // Validation before PayPal: no money can have moved, so FAILED is safe.
  let recipient:string,payout:{id:string;amount_cents:number;currency:string};
  try{
   const {data:p,error:payoutError}=await db.from('payouts')
    .select('id,amount_cents,currency,payout_method_id').eq('id',attempt.payout_id).single();
   if(payoutError||!p)throw new Error('payout_not_found');
   const {data:method,error:methodError}=await db.from('participant_payout_methods')
    .select('provider,provider_recipient_reference,status').eq('id',p.payout_method_id).single();
   if(methodError||!method)throw new Error('payout_method_not_found');
   if(method.status!=='VERIFIED')throw new Error('payout_method_not_verified');
   if(String(method.provider).toUpperCase()!=='PAYPAL')throw new Error('paypal_payout_method_required');
   recipient=resolvePayPalRecipient(method.provider_recipient_reference);
   payout={id:p.id,amount_cents:Number(p.amount_cents),currency:String(p.currency)};
  }catch(e){
   await reconcile(db,attempt.id,'FAILED','validation',e instanceof Error?e.message:'payout_validation_failed');
   failed++;continue;
  }

  let result:any;
  try{
   result=await createPayPalPayout({
    senderBatchId:`pairvoice-${attempt.id}`,
    senderItemId:attempt.id,
    recipientEmail:recipient,
    amountCents:payout.amount_cents,
    currency:payout.currency,
    note:'PairVoice approved-work payout'
   });
  }catch(e){
   const message=e instanceof Error?e.message:'paypal_submission_failed';
   const outcome=classifyPayPalSubmitError(e);
   if(outcome==='RETRY'){
    await db.from('provider_payout_attempts').update({submit_claimed_at:null,last_error:message}).eq('id',attempt.id);
    retry++;continue;
   }
   await reconcile(db,attempt.id,outcome,'paypal_submit',message);
   if(outcome==='FAILED')failed++;else uncertain++;
   continue;
  }

  // PayPal accepted the request. From here on the payout must never be marked FAILED.
  const batchId=String(result?.batch_header?.payout_batch_id||'');
  if(!batchId){
   await reconcile(db,attempt.id,'UNKNOWN','paypal_response','paypal_batch_id_missing',{response_status:result?.batch_header?.batch_status||null});
   uncertain++;continue;
  }
  const {error:saveError}=await db.from('provider_payout_attempts').update({
   provider_reference:batchId,
   result_metadata:{paypal_batch_id:batchId,batch_status:result?.batch_header?.batch_status||null}
  }).eq('id',attempt.id).eq('state','PROCESSING');
  if(saveError){
   // The claim stays set, so this attempt is not resubmitted. Log the batch ID for manual reconciliation.
   console.error('PAYOUT_RECONCILIATION_REQUIRED',JSON.stringify({attemptId:attempt.id,paypalBatchId:batchId,error:saveError.message}));
   uncertain++;continue;
  }
  submitted++;
 }
 return NextResponse.json({ok:true,processed:(attempts||[]).length,submitted,failed,uncertain,retry,skipped});
}
