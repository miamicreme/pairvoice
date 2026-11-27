// CR-04: the lead edge function returns referrer details (email, first name, language)
// so the server can notify the referrer. Those fields must never reach the public
// browser response. Only fields on this allowlist are returned to the caller.
export type LeadEdgeResult={
 inviteCode?:string;
 languageCode?:'en'|'es';
 partnerJoined?:boolean;
 referrerEmail?:string;
 referrerFirstName?:string;
 referrerLanguage?:'en'|'es';
 [key:string]:unknown;
};

export function publicLeadResponse(result:LeadEdgeResult,extra:{inviteUrl:string;emailStatus:{sent:boolean;queued:boolean}}){
 return {
  inviteCode:typeof result.inviteCode==='string'?result.inviteCode:undefined,
  languageCode:result.languageCode==='es'?'es':'en',
  partnerJoined:result.partnerJoined===true,
  inviteUrl:extra.inviteUrl,
  emailStatus:extra.emailStatus,
  phoneCaptured:true
 };
}
