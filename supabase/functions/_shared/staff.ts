// ตรวจว่าผู้เรียกเป็นพนักงานที่ active (ใช้ JWT ของผู้ใช้ ไม่ใช่ anon key) แล้วคืนบทบาท
import { createClient } from 'npm:@supabase/supabase-js@2'

export interface Caller {
  id: string
  role: string
}

export async function staffCaller(req: Request): Promise<Caller | null> {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return null
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
  const { data: user } = await client.auth.getUser()
  if (!user.user) return null
  const { data: role } = await client.rpc('staff_role')
  return role ? { id: user.user.id, role: role as string } : null
}

// หน้าเว็บเรียกจากโดเมนอื่น จึงต้องตอบ CORS (รวม preflight OPTIONS)
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS })
