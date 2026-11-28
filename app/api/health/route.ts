import {NextResponse} from 'next/server';
import {serviceClient} from '../../../lib/supabase-server';

export const dynamic='force-dynamic';
export async function GET(){
 const configured=Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY&&process.env.SUPABASE_SERVICE_ROLE_KEY);
 const environment=process.env.PAIRVOICE_ENVIRONMENT||'unknown';
 const commit=process.env.RENDER_GIT_COMMIT||process.env.PAIRVOICE_COMMIT_SHA||'unknown';
 let databaseReady=false;
 if(configured){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),2500);
  try{
   const {data,error}=await serviceClient().from('subsystem_controls').select('subsystem').limit(1).abortSignal(controller.signal);
   databaseReady=!error&&Boolean(data?.length);
  }catch{}finally{clearTimeout(timer)}
 }
 return NextResponse.json({ok:databaseReady,service:'pairvoice',environment,commit,databaseConfigured:configured,databaseReady},{status:databaseReady?200:503,headers:{'Cache-Control':'no-store'}});
}
