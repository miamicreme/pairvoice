import {decryptSecret} from './credential-crypto';
import {isValidEmail,normalizeEmail} from './validation';

// CR-02: payout methods store the recipient encrypted (v1:iv:tag:data). The worker
// must decrypt server-side and validate before calling PayPal. Legacy rows saved
// before encryption may hold a plaintext email; those are accepted only if valid.
export function resolvePayPalRecipient(stored:unknown):string{
 const raw=String(stored??'').trim();
 if(!raw)throw new Error('paypal_recipient_missing');
 let value:string;
 if(raw.startsWith('v1:')){
  try{value=decryptSecret(raw)}catch{throw new Error('paypal_recipient_decrypt_failed')}
 }else{
  value=raw;
 }
 const email=normalizeEmail(value);
 if(!isValidEmail(email))throw new Error('paypal_recipient_invalid');
 return email;
}
