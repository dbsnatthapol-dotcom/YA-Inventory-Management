// Supabase Edge Function: จัดการบัญชีพนักงาน (เฉพาะผู้ดูแลระบบ)
// action: create { employeeCode, fullName, role, password }
//         reset_password { userId, password }
//         update { userId, fullName?, role?, active? }
// ใช้ service role ฝั่ง server เท่านั้น — หน้าเว็บไม่มีสิทธิ์สร้างผู้ใช้เอง
import { createClient } from 'npm:@supabase/supabase-js@2'
import { CORS, json, staffCaller } from '../_shared/staff.ts'

const ROLES = ['warehouse', 'mi3', 'production', 'planner', 'manager', 'admin']
const MIN_PASSWORD = 8
const staffEmail = (code: string) => `${code.trim().toLowerCase()}@staff.uam.local`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const caller = await staffCaller(req)
  if (!caller || caller.role !== 'admin') return json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' }, 403)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const body = await req.json().catch(() => ({}))

  if (body.action === 'create') {
    const code = String(body.employeeCode ?? '').trim()
    const fullName = String(body.fullName ?? '').trim()
    if (!/^[A-Za-z0-9-]{2,20}$/.test(code)) return json({ error: 'รหัสพนักงานต้องเป็นตัวเลข/ตัวอักษร 2–20 ตัว' }, 400)
    if (!fullName) return json({ error: 'กรอกชื่อพนักงาน' }, 400)
    if (!ROLES.includes(body.role)) return json({ error: 'บทบาทไม่ถูกต้อง' }, 400)
    if (String(body.password ?? '').length < MIN_PASSWORD) return json({ error: 'รหัสผ่านสั้นเกินไป' }, 400)

    const { data: exists } = await admin.from('staff_profiles').select('id').eq('employee_code', code).maybeSingle()
    if (exists) return json({ error: `รหัสพนักงาน ${code} มีในระบบแล้ว` }, 409)

    const { data, error } = await admin.auth.admin.createUser({
      email: staffEmail(code),
      password: body.password,
      email_confirm: true,
      user_metadata: { employee_code: code, full_name: fullName },
    })
    if (error || !data.user) return json({ error: `สร้างบัญชีไม่สำเร็จ: ${error?.message}` }, 400)
    const { error: profileError } = await admin
      .from('staff_profiles')
      .insert({ id: data.user.id, employee_code: code, full_name: fullName, role: body.role })
    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id)
      return json({ error: `บันทึกโปรไฟล์ไม่สำเร็จ: ${profileError.message}` }, 400)
    }
    return json({ ok: true, userId: data.user.id })
  }

  const userId = String(body.userId ?? '')
  if (!userId) return json({ error: 'ไม่ระบุผู้ใช้' }, 400)
  if (userId === caller.id) return json({ error: 'แก้บัญชีของตัวเองจากหน้านี้ไม่ได้' }, 400)

  if (body.action === 'reset_password') {
    if (String(body.password ?? '').length < MIN_PASSWORD) return json({ error: 'รหัสผ่านสั้นเกินไป' }, 400)
    const { error } = await admin.auth.admin.updateUserById(userId, { password: body.password })
    if (error) return json({ error: error.message }, 400)
    await admin.from('staff_profiles').update({ must_change_password: true, updated_at: new Date().toISOString() }).eq('id', userId)
    return json({ ok: true })
  }

  if (body.action === 'update') {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.fullName !== undefined) patch.full_name = String(body.fullName).trim()
    if (body.role !== undefined) {
      if (!ROLES.includes(body.role)) return json({ error: 'บทบาทไม่ถูกต้อง' }, 400)
      patch.role = body.role
    }
    if (body.active !== undefined) {
      patch.active = !!body.active
      // ปิดบัญชี = ห้าม login ใหม่ และ session เดิมหมดสิทธิ์อ่านข้อมูลทันที (RLS ตรวจ active)
      await admin.auth.admin.updateUserById(userId, { ban_duration: body.active ? 'none' : '876000h' })
    }
    const { error } = await admin.from('staff_profiles').update(patch).eq('id', userId)
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  return json({ error: 'ไม่รู้จัก action นี้' }, 400)
})
