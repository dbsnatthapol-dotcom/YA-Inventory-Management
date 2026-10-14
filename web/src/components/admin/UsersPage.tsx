import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { MIN_PASSWORD, ROLE_DUTY, ROLE_LABEL, ROLES, type Role, type StaffProfile } from '../../auth/staff'
import { useAuth } from '../../auth/useAuth'
import { BRAND } from '../../data/brand'
import { supabase } from '../../lib/layoutSource'
import { fmtTime, inputCls } from '../inventory/format'

interface AccessRow {
  id: number
  user_id: string
  employee_code: string
  event: 'login' | 'logout' | 'password_changed'
  user_agent: string | null
  at: string
}

const EVENT_LABEL: Record<AccessRow['event'], string> = { login: 'เข้าสู่ระบบ', logout: 'ออกจากระบบ', password_changed: 'เปลี่ยนรหัสผ่าน' }

/** รหัสผ่านชั่วคราวอ่านง่าย (ไม่มี 0/O, 1/l) — พนักงานต้องเปลี่ยนเองตอนเข้าครั้งแรก */
function tempPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

function device(ua: string | null) {
  if (!ua) return '—'
  if (/iPhone|Android.*Mobile/.test(ua)) return 'มือถือ'
  if (/iPad|Android|Tablet/.test(ua)) return 'แท็บเล็ต'
  return 'คอมพิวเตอร์'
}

async function callAdmin(body: Record<string, unknown>): Promise<string | null> {
  if (!supabase) return 'ยังไม่ได้เชื่อมต่อฐานข้อมูล'
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    // ข้อความจากฟังก์ชันอยู่ใน response body
    const detail = await (error as { context?: Response }).context?.json?.().catch(() => null)
    return detail?.error ?? error.message
  }
  return data?.error ?? null
}

async function fetchStaffAndLog(): Promise<{ staff: StaffProfile[]; log: AccessRow[] }> {
  if (!supabase) return { staff: [], log: [] }
  const [s, l] = await Promise.all([
    supabase.from('staff_profiles').select('id, employee_code, full_name, role, active, must_change_password').order('employee_code'),
    supabase.from('access_log').select('id, user_id, employee_code, event, user_agent, at').order('at', { ascending: false }).limit(200),
  ])
  return { staff: (s.data ?? []) as StaffProfile[], log: (l.data ?? []) as AccessRow[] }
}

/** จัดการผู้ใช้ (ผู้ดูแลระบบ) และประวัติการเข้าใช้ (ผู้ดูแลระบบ + ผู้จัดการ) */
export function UsersPage() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [staff, setStaff] = useState<StaffProfile[]>([])
  const [log, setLog] = useState<AccessRow[]>([])
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const reload = useCallback(async () => {
    const data = await fetchStaffAndLog()
    setStaff(data.staff)
    setLog(data.log)
  }, [])

  useEffect(() => {
    let alive = true
    fetchStaffAndLog().then((data) => {
      if (!alive) return
      setStaff(data.staff)
      setLog(data.log)
    })
    return () => {
      alive = false
    }
  }, [])

  const run = async (body: Record<string, unknown>, okText: string) => {
    const error = await callAdmin(body)
    setNotice(error ? { kind: 'error', text: error } : { kind: 'ok', text: okText })
    if (!error) await reload()
    return !error
  }

  const lastLogin = new Map<string, string>()
  for (const r of log) if (r.event === 'login' && !lastLogin.has(r.user_id)) lastLogin.set(r.user_id, r.at)
  const nameOf = new Map(staff.map((s) => [s.id, s.full_name]))

  return (
    <div className="h-full overflow-y-auto bg-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4">
        {notice && (
          <div className={`rounded-md px-3 py-2 text-sm ${notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
            {notice.text}
            <button className="ml-3 text-xs underline" onClick={() => setNotice(null)}>
              ปิด
            </button>
          </div>
        )}

        {isAdmin && <CreateUser onCreate={(body, pw) => run({ action: 'create', ...body, password: pw }, `สร้างบัญชี ${body.employeeCode} แล้ว — รหัสผ่านชั่วคราว: ${pw} (ให้พนักงานเปลี่ยนเองตอนเข้าครั้งแรก)`)} />}

        <section className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-bold" style={{ color: BRAND.primary }}>
            พนักงานในระบบ ({staff.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-3">รหัส</th>
                  <th className="pr-3">ชื่อ</th>
                  <th className="pr-3">บทบาท</th>
                  <th className="pr-3">สถานะ</th>
                  <th className="pr-3">เข้าใช้ล่าสุด</th>
                  {isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => {
                  const self = s.id === profile?.id
                  return (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="py-1.5 pr-3 font-medium tabular-nums">{s.employee_code}</td>
                      <td className="pr-3">{s.full_name}</td>
                      <td className="pr-3">
                        {isAdmin && !self ? (
                          <select
                            className="rounded border border-slate-300 px-1 py-0.5"
                            value={s.role}
                            onChange={(e) => void run({ action: 'update', userId: s.id, role: e.target.value }, `เปลี่ยนบทบาท ${s.employee_code} แล้ว`)}
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABEL[r]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          ROLE_LABEL[s.role]
                        )}
                      </td>
                      <td className="pr-3">
                        {!s.active ? (
                          <span className="text-red-600">ปิดบัญชี</span>
                        ) : s.must_change_password ? (
                          <span className="text-amber-600">รอตั้งรหัสผ่าน</span>
                        ) : (
                          <span className="text-emerald-700">ใช้งาน</span>
                        )}
                      </td>
                      <td className="pr-3 text-slate-500">{lastLogin.has(s.id) ? fmtTime(lastLogin.get(s.id)!) : '—'}</td>
                      {isAdmin && (
                        <td className="whitespace-nowrap text-right">
                          {!self && (
                            <>
                              <button
                                className="mr-2 text-xs text-sky-700 hover:underline"
                                onClick={() => {
                                  const pw = tempPassword()
                                  if (confirm(`ตั้งรหัสผ่านใหม่ให้ ${s.employee_code}?`))
                                    void run({ action: 'reset_password', userId: s.id, password: pw }, `รหัสผ่านชั่วคราวของ ${s.employee_code}: ${pw}`)
                                }}
                              >
                                รีเซ็ตรหัสผ่าน
                              </button>
                              <button
                                className={`text-xs hover:underline ${s.active ? 'text-red-600' : 'text-emerald-700'}`}
                                onClick={() =>
                                  confirm(`${s.active ? 'ปิด' : 'เปิด'}บัญชี ${s.employee_code}?`) &&
                                  void run({ action: 'update', userId: s.id, active: !s.active }, `${s.active ? 'ปิด' : 'เปิด'}บัญชี ${s.employee_code} แล้ว`)
                                }
                              >
                                {s.active ? 'ปิดบัญชี' : 'เปิดบัญชี'}
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold" style={{ color: BRAND.primary }}>
              ประวัติการเข้าใช้ (200 รายการล่าสุด)
            </h2>
            <button className="text-xs text-sky-700 hover:underline" onClick={() => void reload()}>
              โหลดใหม่
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-3">เวลา</th>
                  <th className="pr-3">รหัส</th>
                  <th className="pr-3">ชื่อ</th>
                  <th className="pr-3">รายการ</th>
                  <th>อุปกรณ์</th>
                </tr>
              </thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="py-1 pr-3 tabular-nums text-slate-500">{fmtTime(r.at)}</td>
                    <td className="pr-3 tabular-nums">{r.employee_code}</td>
                    <td className="pr-3">{nameOf.get(r.user_id) ?? '—'}</td>
                    <td className="pr-3">{EVENT_LABEL[r.event]}</td>
                    <td className="text-slate-500">{device(r.user_agent)}</td>
                  </tr>
                ))}
                {!log.length && (
                  <tr>
                    <td colSpan={5} className="py-3 text-center text-slate-400">
                      ยังไม่มีประวัติ
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

function CreateUser({ onCreate }: { onCreate: (body: { employeeCode: string; fullName: string; role: Role }, password: string) => Promise<boolean> }) {
  const [employeeCode, setCode] = useState('')
  const [fullName, setName] = useState('')
  const [role, setRole] = useState<Role>('warehouse')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!employeeCode.trim() || !fullName.trim()) return
    setBusy(true)
    if (await onCreate({ employeeCode: employeeCode.trim(), fullName: fullName.trim(), role }, tempPassword())) {
      setCode('')
      setName('')
    }
    setBusy(false)
  }

  return (
    <section className="rounded-lg bg-white p-4 shadow-sm">
      <h2 className="mb-1 font-bold" style={{ color: BRAND.primary }}>
        เพิ่มพนักงาน
      </h2>
      <p className="mb-3 text-xs text-slate-500">ระบบสร้างรหัสผ่านชั่วคราว ({MIN_PASSWORD}+ ตัวอักษร) ให้ส่งต่อพนักงาน แล้วพนักงานตั้งรหัสผ่านเองตอนเข้าครั้งแรก</p>
      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[8rem_1fr_10rem_auto]">
        <input className={inputCls} placeholder="รหัสพนักงาน" value={employeeCode} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
        <input className={inputCls} placeholder="ชื่อ-นามสกุล" value={fullName} onChange={(e) => setName(e.target.value)} />
        <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as Role)} title={ROLE_DUTY[role]}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy} className="rounded-md px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60" style={{ background: BRAND.primary }}>
          {busy ? 'กำลังสร้าง…' : 'สร้างบัญชี'}
        </button>
      </form>
      <p className="mt-2 text-xs text-slate-500">หน้าที่ของบทบาท: {ROLE_DUTY[role]}</p>
    </section>
  )
}
