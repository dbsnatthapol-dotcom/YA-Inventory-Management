import { useState, type FormEvent, type ReactNode } from 'react'
import logoUrl from '../assets/uam-logo.png'
import { BRAND } from '../data/brand'
import { MIN_PASSWORD, ROLE_LABEL } from './staff'
import { useAuth } from './useAuth'

const input = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base focus:border-sky-500 focus:outline-none'

function Card({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-4" style={{ background: `linear-gradient(160deg, ${BRAND.primary}, #06315f)` }}>
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center gap-3">
          <img src={logoUrl} alt={BRAND.shortName} className="h-12 w-14 object-contain" />
          <div className="leading-tight">
            <div className="text-sm font-bold" style={{ color: BRAND.primary }}>
              UNION AUTOPARTS MANUFACTURING
            </div>
            <div className="text-xs text-slate-500">ระบบบริหารคลังสินค้า · ผังโรงงาน 3 มิติ</div>
          </div>
        </div>
        <h1 className="text-lg font-bold text-slate-800">{title}</h1>
        <p className="mb-4 text-sm text-slate-500">{sub}</p>
        {children}
      </div>
    </div>
  )
}

function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button type="submit" disabled={busy} className="w-full rounded-md py-2.5 font-semibold text-white disabled:opacity-60" style={{ background: BRAND.primary }}>
      {busy ? 'กำลังดำเนินการ…' : children}
    </button>
  )
}

export function LoginScreen() {
  const { signIn } = useAuth()
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(await signIn(code, password))
    setBusy(false)
  }

  return (
    <Card title="เข้าสู่ระบบ" sub="ใช้รหัสพนักงาน ระบบจะบันทึกประวัติการเข้าใช้ทุกครั้ง">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          รหัสพนักงาน
          <input className={input} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="username" autoFocus />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          รหัสผ่าน
          <input className={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <SubmitButton busy={busy}>เข้าสู่ระบบ</SubmitButton>
        <p className="text-center text-xs text-slate-400">ลืมรหัสผ่าน ติดต่อผู้ดูแลระบบเพื่อตั้งรหัสใหม่</p>
      </form>
    </Card>
  )
}

/** บังคับเปลี่ยนรหัสผ่านครั้งแรก หรือหลังผู้ดูแลระบบรีเซ็ตให้ */
export function ChangePasswordScreen() {
  const { profile, changePassword, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) return setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน')
    setBusy(true)
    setError(await changePassword(password))
    setBusy(false)
  }

  return (
    <Card
      title="ตั้งรหัสผ่านใหม่"
      sub={`${profile?.full_name ?? ''} (${profile?.employee_code ?? ''} · ${profile ? ROLE_LABEL[profile.role] : ''}) — ตั้งรหัสผ่านของตัวเองก่อนเริ่มใช้งาน`}
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          รหัสผ่านใหม่ (อย่างน้อย {MIN_PASSWORD} ตัวอักษร)
          <input className={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          ยืนยันรหัสผ่านใหม่
          <input className={input} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </label>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <SubmitButton busy={busy}>บันทึกรหัสผ่าน</SubmitButton>
        <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => void signOut()}>
          ออกจากระบบ
        </button>
      </form>
    </Card>
  )
}

export function LoadingScreen() {
  return <div className="flex h-full items-center justify-center text-sm text-slate-500">กำลังโหลด…</div>
}
