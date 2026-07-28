import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}})
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  try{
    const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin=createClient(url,service,{auth:{persistSession:false}})
    const token=(req.headers.get('Authorization')||'').replace('Bearer ','')
    const {data:caller}=await admin.auth.getUser(token)
    if(!caller.user)return json({error:'로그인이 필요합니다.'},401)
    const {data:callerProfile}=await admin.from('profiles').select('role,is_active').eq('id',caller.user.id).single()
    if(!callerProfile?.is_active||callerProfile.role!=='admin')return json({error:'관리자 권한이 필요합니다.'},403)
    const body=await req.json(),action=body.action
    if(action==='list'){
      const {data,error}=await admin.from('profiles').select('id,username,display_name,role,is_active,created_at,updated_at').order('username')
      if(error)throw error
      return json({users:data||[]})
    }
    if(action==='create'){
      if(!body.username||!body.password)return json({error:'아이디와 비밀번호가 필요합니다.'},400)
      const username=String(body.username).trim().toLowerCase(),email=`${username.replace(/[^a-z0-9._-]/g,'_')}@daekyung.local`
      const {data:created,error:createError}=await admin.auth.admin.createUser({email,password:body.password,email_confirm:true})
      if(createError)throw createError
      const {error:profileError}=await admin.from('profiles').insert({id:created.user.id,username,display_name:body.display_name||username,role:body.role||'viewer',is_active:body.is_active!==false})
      if(profileError){await admin.auth.admin.deleteUser(created.user.id);throw profileError}
      return json({ok:true,id:created.user.id})
    }
    if(action==='update'){
      const {error}=await admin.from('profiles').update({username:String(body.username).trim().toLowerCase(),display_name:body.display_name||body.username,role:body.role||'viewer',is_active:body.is_active!==false,updated_at:new Date().toISOString()}).eq('id',body.id)
      if(error)throw error
      return json({ok:true})
    }
    if(action==='reset-password'){
      const {error}=await admin.auth.admin.updateUserById(body.id,{password:body.password})
      if(error)throw error
      return json({ok:true})
    }
    return json({error:'지원하지 않는 요청입니다.'},400)
  }catch(e){return json({error:e.message||String(e)},500)}
})
