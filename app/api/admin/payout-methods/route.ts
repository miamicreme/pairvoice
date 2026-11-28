import {NextRequest,NextResponse} from 'next/server';
import {requireAdmin} from '../../../../lib/admin-server';

export async function GET(){
 const admin=await requireAdmin(['SUPER_ADMIN','PAYMENTS']);
 if(!admin)return NextResponse.json({error:'Forbidden'},{status:403});
 const {data,error}=await admin.db.from('participant_payout_methods')
  .select('id,participant_id,provider,label,status,is_default,created_at,participants(first_name,email,public_code)')
  .in('status',['PENDING','VERIFIED']).order('created_at',{ascending:true}).limit(100);
 if(error)return NextResponse.json({error:'Unable to load payout methods.'},{status:500});
 return NextResponse.json({methods:data||[]});
}

// CR-01: status changes go through set_payout_method_status, which verifies or disables the
// method, maintains exactly one default per participant and writes the audit event in one
// transaction. Previously only status was updated and no method ever became the default.
export async function PATCH(req:NextRequest){
 const admin=await requireAdmin(['SUPER_ADMIN','PAYMENTS']);
 if(!admin)return NextResponse.json({error:'Forbidden'},{status:403});
 try{
  const b=await req.json(),status=String(b.status||'').toUpperCase(),reason=String(b.reason||'').trim();
  if(!b.methodId||!['VERIFIED','DISABLED'].includes(status)||!reason)
   return NextResponse.json({error:'methodId, VERIFIED/DISABLED status and reason are required.'},{status:400});
  const {data,error}=await admin.db.rpc('set_payout_method_status',{
   p_method_id:String(b.methodId),p_status:status,p_actor_user_id:admin.user.id,
   p_actor_label:`ADMIN:${admin.role}`,p_role:admin.role,p_reason:reason
  });
  if(error){
   if(/payout_method_not_found/.test(error.message))return NextResponse.json({error:'Payout method not found.'},{status:404});
   if(/disabled_payout_method_cannot_be_verified/.test(error.message))return NextResponse.json({error:'A disabled payout method cannot be verified. Ask the participant to add it again.'},{status:409});
   console.error(error);return NextResponse.json({error:'Unable to update payout method.'},{status:500});
  }
  return NextResponse.json(data||{ok:true});
 }catch(e){console.error(e);return NextResponse.json({error:'Unable to update payout method.'},{status:500})}
}
