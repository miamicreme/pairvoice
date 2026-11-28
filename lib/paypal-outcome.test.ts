import{describe,expect,it}from'vitest';
import{classifyPayPalSubmitError}from'./paypal-outcome';
const err=(m:string,payload?:unknown)=>Object.assign(new Error(m),{payload});
describe('PayPal submit outcome (CR-03)',()=>{
 it('holds even 4xx responses until provider reconciliation proves no movement',()=>{
  for(const status of [400,401,403,408,409,422,429,500,503])expect(classifyPayPalSubmitError(err('paypal_payout_'+status))).toBe('UNKNOWN');
 });
 it('holds top-level and nested duplicates and malformed payloads',()=>{
  for(const payload of [{name:'DUPLICATE_REQUEST_ID'},{name:'VALIDATION_ERROR',details:[{issue:'DUPLICATE_BATCH_ID'}]},null,'invalid'])expect(classifyPayPalSubmitError(err('paypal_payout_400',payload))).toBe('UNKNOWN');
 });
 it('holds network and unrecognized errors',()=>{
  expect(classifyPayPalSubmitError(new TypeError('fetch failed'))).toBe('UNKNOWN');
  expect(classifyPayPalSubmitError('paypal_credentials_missing')).toBe('UNKNOWN');
  expect(classifyPayPalSubmitError(err('paypal_oauth_unexpected'))).toBe('UNKNOWN');
 });
 it('retries only explicit failures before payout submission',()=>{
  for(const message of ['paypal_credentials_missing','paypal_oauth_401','paypal_oauth_token_missing'])expect(classifyPayPalSubmitError(err(message))).toBe('RETRY');
 });
});
