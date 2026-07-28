import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
})
const value = (body: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const candidate = body[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST 요청만 허용됩니다.' }, 405)
  try {
    let body: Record<string, unknown>
    try { body = await req.json() }
    catch { return json({ error: '로그인 요청 형식이 올바르지 않습니다.' }, 400) }

    const username = value(body, ['username', 'loginId', 'login_id', 'userId', 'user_id', 'identifier', 'id', 'email']).toLowerCase()
    const password = value(body, ['password', 'pw', 'passwd'])
    if (!username || !password) return json({ error: '아이디와 비밀번호를 입력하세요.' }, 400)

    const url = Deno.env.get('SUPABASE_URL') || ''
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const anon = Deno.env.get('SUPABASE_ANON_KEY') || ''
    if (!url || !service || !anon) return json({ error: '로그인 서버 설정이 완료되지 않았습니다.' }, 500)

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: profile, error: profileError } = await admin.from('profiles')
      .select('id,username,display_name,role,is_active').ilike('username', username).maybeSingle()
    if (profileError) {
      console.error('profile lookup failed', profileError)
      return json({ error: '사용자 정보를 조회하지 못했습니다. profiles 설정을 확인하세요.' }, 500)
    }
    if (!profile || !profile.is_active) return json({ error: '아이디 또는 비밀번호를 확인하세요.' }, 401)

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.id)
    if (userError || !userData.user?.email) {
      console.error('auth user lookup failed', userError)
      return json({ error: '계정 연결 정보를 확인할 수 없습니다.' }, 401)
    }
    const { data, error } = await client.auth.signInWithPassword({ email: userData.user.email, password })
    if (error || !data.session) return json({ error: '아이디 또는 비밀번호를 확인하세요.' }, 401)

    return json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
      token_type: data.session.token_type,
      profile,
    })
  } catch (error) {
    console.error('auth-login failed', error)
    return json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
