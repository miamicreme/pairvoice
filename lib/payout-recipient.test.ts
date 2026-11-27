import{beforeEach,describe,expect,it}from'vitest';import{encryptSecret}from'./credential-crypto';import{resolvePayPalRecipient}from'./payout-recipient';
describe('PayPal recipient resolution (CR-02)',()=>{
 beforeEach(()=>{process.env.PAIRVOICE_CREDENTIAL_ENCRYPTION_KEY=Buffer.alloc(32,9).toString('base64')});
 it('decrypts stored ciphertext and never returns it',()=>{const c=encryptSecret('Payee@Example.com');const r=resolvePayPalRecipient(c);expect(r).toBe('payee@example.com');expect(r).not.toContain('v1:')});
 it('accepts a legacy plaintext email',()=>expect(resolvePayPalRecipient(' old@example.com ')).toBe('old@example.com'));
 it('fails closed on tampered ciphertext',()=>{const c=encryptSecret('a@b.com');const parts=c.split(':');parts[3]=Buffer.from('zzzz').toString('base64');expect(()=>resolvePayPalRecipient(parts.join(':'))).toThrow('paypal_recipient_decrypt_failed')});
 it('fails closed when the key is wrong',()=>{const c=encryptSecret('a@b.com');process.env.PAIRVOICE_CREDENTIAL_ENCRYPTION_KEY=Buffer.alloc(32,1).toString('base64');expect(()=>resolvePayPalRecipient(c)).toThrow('paypal_recipient_decrypt_failed')});
 it('rejects a decrypted value that is not an email',()=>expect(()=>resolvePayPalRecipient(encryptSecret('cashtag$abc'))).toThrow('paypal_recipient_invalid'));
 it('rejects empty values',()=>{expect(()=>resolvePayPalRecipient(null)).toThrow('paypal_recipient_missing');expect(()=>resolvePayPalRecipient('')).toThrow('paypal_recipient_missing')});
});
