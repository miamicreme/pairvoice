// CR-03: decide how a PayPal submission error is reconciled.
// FAILED is only safe when PayPal definitively rejected the request and no money moved.
// Anything ambiguous (network error, timeout, 5xx, 429, duplicate batch, unparseable
// error) becomes UNKNOWN so finance reconciles it against PayPal before any retry.
// RETRY: the request never reached the payouts endpoint (missing credentials or OAuth
// failure), so the claim is released and the attempt is retried on a later run.
export type SubmitOutcome='FAILED'|'UNKNOWN'|'RETRY';

export function classifyPayPalSubmitError(error:unknown):SubmitOutcome{
 const message=error instanceof Error?error.message:String(error??'');
 const payload=(error as {payload?:{name?:string}}|null)?.payload;
 const name=String(payload?.name||'').toUpperCase();
 if(name.includes('DUPLICATE'))return 'UNKNOWN';
 if(message==='paypal_credentials_missing'||message.startsWith('paypal_oauth_'))return 'RETRY';
 const m=/^paypal_payout_(\d{3})$/.exec(message);
 if(!m)return 'UNKNOWN';
 const status=Number(m[1]);
 if(status===429||status>=500)return 'UNKNOWN';
 if(status>=400&&status<500)return 'FAILED';
 return 'UNKNOWN';
}
