import{describe,expect,it}from'vitest';import{classifyPayPalSubmitError}from'./paypal-outcome';
const err=(m:string,payload?:unknown)=>Object.assign(new Error(m),{payload});
describe('PayPal submit outcome (CR-03)',()=>{
 it('definitive 4xx rejection is FAILED',()=>{expect(classifyPayPalSubmitError(err('paypal_payout_400',{name:'VALIDATION_ERROR'}))).toBe('FAILED');expect(classifyPayPalSubmitError(err('paypal_payout_422'))).toBe('FAILED')});
 it('duplicate batch is UNKNOWN, never FAILED',()=>expect(classifyPayPalSubmitError(err('paypal_payout_400',{name:'DUPLICATE_REQUEST_ID'}))).toBe('UNKNOWN'));
 it('server errors and throttling are UNKNOWN',()=>{expect(classifyPayPalSubmitError(err('paypal_payout_500'))).toBe('UNKNOWN');expect(classifyPayPalSubmitError(err('paypal_payout_503'))).toBe('UNKNOWN');expect(classifyPayPalSubmitError(err('paypal_payout_429'))).toBe('UNKNOWN')});
 it('network errors are UNKNOWN',()=>{expect(classifyPayPalSubmitError(new TypeError('fetch failed'))).toBe('UNKNOWN');expect(classifyPayPalSubmitError('weird')).toBe('UNKNOWN')});
 it('credential and OAuth failures are RETRY (request never sent)',()=>{expect(classifyPayPalSubmitError(err('paypal_credentials_missing'))).toBe('RETRY');expect(classifyPayPalSubmitError(err('paypal_oauth_401'))).toBe('RETRY')});
});
