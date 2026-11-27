import{describe,expect,it}from'vitest';import{publicLeadResponse}from'./lead-response';
describe('public lead response (CR-04)',()=>{
 const edge={inviteCode:'ABC123',languageCode:'es' as const,partnerJoined:true,referrerEmail:'referrer@example.com',referrerFirstName:'Ana',referrerLanguage:'es' as const,internalId:'x'};
 const out=publicLeadResponse(edge,{inviteUrl:'https://pairvoice.com/invite/ABC123',emailStatus:{sent:true,queued:false}});
 it('never returns referrer details',()=>{const s=JSON.stringify(out);expect(s).not.toContain('referrer@example.com');expect(s).not.toContain('Ana');expect(out).not.toHaveProperty('referrerEmail');expect(out).not.toHaveProperty('referrerFirstName');expect(out).not.toHaveProperty('referrerLanguage')});
 it('drops unknown edge fields',()=>expect(out).not.toHaveProperty('internalId'));
 it('keeps the fields the client needs',()=>expect(out).toEqual({inviteCode:'ABC123',languageCode:'es',partnerJoined:true,inviteUrl:'https://pairvoice.com/invite/ABC123',emailStatus:{sent:true,queued:false},phoneCaptured:true}));
});
