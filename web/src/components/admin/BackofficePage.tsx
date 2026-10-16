import { useEffect, useMemo, useState } from 'react'
import { ROLE_LABEL, type Role } from '../../auth/staff'
import { useAuth } from '../../auth/useAuth'
import { BRAND } from '../../data/brand'
import type { Zone } from '../../types/layout'
import { errorText } from '../../wms/api'
import { PERMS, type PermRow, type StaffBrief, type StorageLoc } from '../../wms/types'
import { useWms } from '../../wms/useWms'
import { Alert, BigButton, Card, Field, inputCls, Pill, Segmented, tdCls, thCls } from '../wms/ui'
import { UsersPage } from './UsersPage'

type Tab = 'users' | 'perms' | 'heads' | 'master' | 'system'

const EDIT_ROLES: Role[] = ['warehouse', 'mi3', 'production', 'planner', 'engineer', 'manager']

/** หลังบ้าน: ผู้ดูแลระบบจัดการผู้ใช้ สิทธิ์ หัวหน้าโซน ข้อมูลหลัก และโหมดระบบ */
export function BackofficePage({ zones }: { zones: Zone[] }) {
  const { profile, enabled } = useAuth()
  const { can } = useWms()
  const isAdmin = !enabled || profile?.role === 'admin'
  const tabs: [Tab, string][] = [
    ...(enabled ? ([['users', 'ผู้ใช้งาน & ประวัติเข้าใช้']] as [Tab, string][]) : []),
    ...(isAdmin ? ([['perms', 'สิทธิ์ตามบทบาท'], ['heads', 'หัวหน้าโซน']] as [Tab, string][]) : []),
    ...(isAdmin || can('master.edit') ? ([['master', 'ข้อมูลหลัก']] as [Tab, string][]) : []),
    ...(isAdmin ? ([['system', 'โหมดระบบ']] as [Tab, string][]) : []),
  ]
  const [tab, setTab] = useState<Tab>(tabs[0]?.[0] ?? 'master')

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 bg-white px-4 py-2">
        <nav className="mx-auto flex max-w-[1400px] flex-wrap gap-1" aria-label="หลังบ้าน">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              aria-current={tab === k ? 'page' : undefined}
              className={`min-h-[40px] rounded-lg px-4 text-sm font-semibold transition ${tab === k ? 'text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              style={tab === k ? { background: BRAND.primary } : undefined}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'users' && <UsersPage />}
        {tab !== 'users' && (
          <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-4">
            {tab === 'perms' && <PermissionsTab />}
            {tab === 'heads' && <ZoneHeadsTab zones={zones} />}
            {tab === 'master' && <MasterTab zones={zones} />}
            {tab === 'system' && <SystemTab />}
          </div>
        )}
      </div>
    </div>
  )
}

function PermissionsTab() {
  const { api, reload } = useWms()
  const [rows, setRows] = useState<PermRow[]>([])
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    api.permissionRows().then((r) => alive && setRows(r)).catch((e) => alive && setMsg({ tone: 'bad', text: errorText(e) }))
    return () => {
      alive = false
    }
  }, [api])

  const has = (role: string, perm: string) => rows.some((r) => r.role === role && r.perm === perm && r.allowed)
  const toggle = async (role: Role, perm: string) => {
    const next = !has(role, perm)
    setRows((rs) => [...rs.filter((r) => !(r.role === role && r.perm === perm)), { role, perm, allowed: next }])
    try {
      await api.setPermission(role, perm, next)
      setMsg({ tone: 'ok', text: `${next ? 'เปิด' : 'ปิด'}สิทธิ์ "${PERMS.find((p) => p.key === perm)?.label}" ให้ ${ROLE_LABEL[role]} แล้ว · มีผลเมื่อผู้ใช้โหลดหน้าใหม่` })
      void reload()
    } catch (e) {
      setRows((rs) => [...rs.filter((r) => !(r.role === role && r.perm === perm)), { role, perm, allowed: !next }])
      setMsg({ tone: 'bad', text: errorText(e) })
    }
  }

  const groups = [...new Set(PERMS.map((p) => p.group))]
  return (
    <Card title="สิทธิ์ตามบทบาท" eyebrow="ติ๊กเพื่อเปิด/ปิดได้ทันที · ผู้ดูแลระบบทำได้ทุกอย่างเสมอ (กันล็อกตัวเองออก)">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr>
              <th className={thCls}>งาน</th>
              {EDIT_ROLES.map((r) => (
                <th key={r} className={`${thCls} text-center`}>
                  {ROLE_LABEL[r]}
                </th>
              ))}
              <th className={`${thCls} text-center`}>{ROLE_LABEL.admin}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => [
              <tr key={g}>
                <td colSpan={EDIT_ROLES.length + 2} className="bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-500">
                  {g}
                </td>
              </tr>,
              ...PERMS.filter((p) => p.group === g).map((p) => (
                <tr key={p.key}>
                  <td className={tdCls}>
                    {p.label}
                    <span className="ml-2 font-mono text-[10px] text-slate-400">{p.key}</span>
                  </td>
                  {EDIT_ROLES.map((r) => (
                    <td key={r} className={`${tdCls} text-center`}>
                      <input type="checkbox" className="h-5 w-5 cursor-pointer" checked={has(r, p.key)} onChange={() => void toggle(r, p.key)} aria-label={`${p.label} · ${ROLE_LABEL[r]}`} />
                    </td>
                  ))}
                  <td className={`${tdCls} text-center`}>
                    <input type="checkbox" className="h-5 w-5" checked disabled aria-label={`${p.label} · ผู้ดูแลระบบ`} />
                  </td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">สร้างบัญชี เปลี่ยนบทบาท และรีเซ็ตรหัสผ่าน ทำได้เฉพาะผู้ดูแลระบบในแท็บ "ผู้ใช้งาน"</p>
    </Card>
  )
}

const HEAD_KINDS = new Set(['storage', 'tent', 'receiving', 'inspection', 'ng', 'assembly', 'utility'])

function ZoneHeadsTab({ zones }: { zones: Zone[] }) {
  const { api, master, reload } = useWms()
  const [staff, setStaff] = useState<StaffBrief[]>([])
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    api.staffDirectory().then((s) => alive && setStaff(s)).catch((e) => alive && setMsg({ tone: 'bad', text: errorText(e) }))
    return () => {
      alive = false
    }
  }, [api])

  const save = async (zone: Zone, staffId: string) => {
    try {
      await api.setZoneHead(zone.id, staffId || null)
      await reload()
      setMsg({ tone: 'ok', text: `บันทึกหัวหน้าโซน ${zone.code} แล้ว · ป้ายที่พิมพ์ต่อจากนี้จะขึ้นชื่อนี้` })
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    }
  }

  return (
    <Card title="หัวหน้าโซน" eyebrow="ชื่อจะขึ้นบนป้ายกล่องและหน้าสแกน · เลือกจากพนักงานที่ลงทะเบียนแล้ว">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {zones
          .filter((z) => HEAD_KINDS.has(z.kind))
          .map((z) => {
            const head = master.zoneHeads.find((h) => h.zoneId === z.id)
            return (
              <div key={z.id} className="flex flex-col gap-1.5 rounded-lg border border-slate-200 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono font-semibold">{z.code}</span>
                  <span className="truncate text-xs text-slate-500">{z.name}</span>
                </div>
                <select id={`head-${z.id}`} className={inputCls} value={head?.staffId ?? ''} onChange={(e) => void save(z, e.target.value)} aria-label={`หัวหน้าโซน ${z.code}`}>
                  <option value="">— ยังไม่กำหนด —</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} ({s.employeeCode}) · {ROLE_LABEL[s.role as Role] ?? s.role}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
      </div>
    </Card>
  )
}

function MasterTab({ zones }: { zones: Zone[] }) {
  const [sub, setSub] = useState<'parts' | 'rules' | 'locs'>('parts')
  return (
    <>
      <Segmented
        label="ข้อมูลหลัก"
        value={sub}
        onChange={setSub}
        options={[
          ['parts', 'Part'],
          ['rules', 'กฎโซนจัดเก็บ'],
          ['locs', 'ช่องเก็บ'],
        ]}
      />
      {sub === 'parts' && <PartsEditor />}
      {sub === 'rules' && <RulesEditor zones={zones} />}
      {sub === 'locs' && <LocationsEditor zones={zones} />}
    </>
  )
}

const EMPTY_PART = { partNo: '', name: '', type: '', customerId: 'RE', models: [] as string[] }

function PartsEditor() {
  const { api, master, settings, reload } = useWms()
  const [q, setQ] = useState('')
  const [form, setForm] = useState(EMPTY_PART)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const types = useMemo(() => [...new Set(master.parts.map((p) => p.type).filter(Boolean))].sort() as string[], [master.parts])
  const shown = master.parts.filter((p) => !q || `${p.partNo} ${p.name} ${p.type} ${p.models.join(' ')}`.toLowerCase().includes(q.toLowerCase())).slice(0, 200)

  const save = async () => {
    try {
      await api.upsertPart({ ...form, type: form.type || null })
      await reload()
      setMsg({ tone: 'ok', text: `บันทึก ${form.partNo} แล้ว` })
      setForm(EMPTY_PART)
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <Card title={`Part ทั้งหมด (${master.parts.length})`}>
        <input id="part-search" className={inputCls} placeholder="ค้นหา Part No. / ชื่อ / กลุ่ม / Model" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-[60vh] overflow-auto rounded-lg ring-1 ring-slate-200">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0">
              <tr>
                <th className={thCls}>Part No.</th>
                <th className={thCls}>ชื่อ</th>
                <th className={thCls}>กลุ่ม</th>
                <th className={thCls}>Model</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.partNo}>
                  <td className={`${tdCls} font-mono font-semibold`}>{p.partNo}</td>
                  <td className={tdCls}>{p.name}</td>
                  <td className={tdCls}>{p.type && <Pill tone={settings.qiPartTypes.includes(p.type) ? 'mi3' : 'muted'}>{p.type}</Pill>}</td>
                  <td className={`${tdCls} text-xs text-slate-500`}>{p.models.join(', ')}</td>
                  <td className={tdCls}>
                    <button className="text-sm text-sky-700 hover:underline" onClick={() => setForm({ partNo: p.partNo, name: p.name, type: p.type ?? '', customerId: p.customerId ?? 'RE', models: p.models })}>
                      แก้ไข
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title={master.parts.some((p) => p.partNo === form.partNo) ? `แก้ไข ${form.partNo}` : 'เพิ่ม Part ใหม่'}>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Field label="Part No.">
          <input id="pf-no" className={`${inputCls} font-mono`} value={form.partNo} onChange={(e) => setForm({ ...form, partNo: e.target.value })} />
        </Field>
        <Field label="ชื่อ / รายการ">
          <input id="pf-name" className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="กลุ่ม (เช่น RIM, HUB, SPOKE)" hint="กลุ่ม RIM / HUB ต้องผ่าน MI3 (ตั้งได้ในแท็บโหมดระบบ)">
          <input id="pf-type" list="pf-types" className={`${inputCls} uppercase`} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} />
          <datalist id="pf-types">
            {types.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <div>
          <div className="mb-1 text-sm font-medium text-slate-600">ใช้กับ Model</div>
          <div className="flex flex-wrap gap-1.5">
            {master.models.map((m) => {
              const on = form.models.includes(m.code)
              return (
                <button
                  key={m.code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setForm({ ...form, models: on ? form.models.filter((x) => x !== m.code) : [...form.models, m.code] })}
                  className={`rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ${on ? 'bg-sky-700 text-white ring-sky-700' : 'bg-white text-slate-600 ring-slate-300'}`}
                >
                  {m.code}
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-xs text-slate-400">เพิ่ม Model ได้ · การเอา Model ออกให้แจ้งผู้ดูแลระบบ (กันประวัติเดิมหลุด)</p>
        </div>
        <div className="flex gap-2">
          <BigButton disabled={!form.partNo.trim() || !form.name.trim()} onClick={() => void save()}>
            บันทึก
          </BigButton>
          <BigButton tone="ghost" onClick={() => setForm(EMPTY_PART)}>
            ล้างฟอร์ม
          </BigButton>
        </div>
      </Card>
    </div>
  )
}

function RulesEditor({ zones }: { zones: Zone[] }) {
  const { api, master, reload } = useWms()
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [add, setAdd] = useState({ type: '', zoneId: '' })
  const storeZones = zones.filter((z) => z.kind === 'storage' || z.kind === 'tent')
  const save = async (partType: string | null, zoneId: string) => {
    try {
      await api.setZoneRule({ customerId: 'RE', partType, zoneId })
      await reload()
      setMsg({ tone: 'ok', text: `บันทึกกฎ ${partType ?? 'ค่าเริ่มต้น'} → ${zones.find((z) => z.id === zoneId)?.code} แล้ว` })
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    }
  }
  return (
    <Card title="กฎโซนจัดเก็บ (Royal Enfield)" eyebrow="ตอนรับของ ระบบแนะนำช่องเก็บว่างแรกในโซนตามกลุ่ม part">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {[...master.rules]
          .filter((r) => r.customerId === 'RE')
          .sort((a, b) => (a.partType ?? '~').localeCompare(b.partType ?? '~'))
          .map((r) => (
            <div key={r.partType ?? '-'} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2.5">
              <span className="w-28 font-mono text-sm font-semibold">{r.partType ?? 'ค่าเริ่มต้น'}</span>
              <select className={inputCls} value={r.zoneId} onChange={(e) => void save(r.partType, e.target.value)} aria-label={`โซนของ ${r.partType ?? 'ค่าเริ่มต้น'}`}>
                {storeZones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.code} · {z.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
      </div>
      <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        <Field label="กลุ่ม part ใหม่">
          <input id="rule-type" className={`${inputCls} uppercase`} value={add.type} onChange={(e) => setAdd({ ...add, type: e.target.value })} placeholder="เช่น CHAIN" />
        </Field>
        <Field label="เก็บที่โซน">
          <select id="rule-zone" className={inputCls} value={add.zoneId} onChange={(e) => setAdd({ ...add, zoneId: e.target.value })}>
            <option value="">— เลือก —</option>
            {storeZones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.code} · {z.name}
              </option>
            ))}
          </select>
        </Field>
        <BigButton disabled={!add.type.trim() || !add.zoneId} onClick={() => void save(add.type.trim().toUpperCase(), add.zoneId).then(() => setAdd({ type: '', zoneId: '' }))}>
          เพิ่มกฎ
        </BigButton>
      </div>
    </Card>
  )
}

const LOC_KIND: Record<StorageLoc['kind'], string> = { bin: 'ช่องชั้นวาง', floor: 'พื้นเต็นท์', staging: 'จุดพักรับเข้า', hold: 'พื้นที่กัก (MI3)', ng: 'พื้นที่ NG' }

function LocationsEditor({ zones }: { zones: Zone[] }) {
  const { api, master, reload } = useWms()
  const [zoneId, setZoneId] = useState(zones.find((z) => z.kind === 'storage')?.id ?? '')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const locs = master.locations.filter((l) => l.zoneId === zoneId)
  const zone = zones.find((z) => z.id === zoneId)

  const save = async (l: StorageLoc, text: string) => {
    try {
      await api.upsertLocation(l)
      await reload()
      setMsg({ tone: 'ok', text })
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    }
  }

  return (
    <Card title="ช่องเก็บ" eyebrow="รหัสสากล: โซน-ช่อง-ชั้น (RK-A-01-1) · เต็นท์ใช้ โซน-บล็อก (TENT-T-01) · ปิดช่องที่ใช้ไม่ได้ ระบบจะไม่แนะนำ">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="โซน">
          <select id="loc-zone" className={inputCls} value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
            {zones
              .filter((z) => master.locations.some((l) => l.zoneId === z.id) || z.kind === 'storage' || z.kind === 'tent')
              .map((z) => (
                <option key={z.id} value={z.id}>
                  {z.code} · {z.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="เพิ่มช่องใหม่">
          <input id="loc-code" className={`${inputCls} font-mono uppercase`} value={code} onChange={(e) => setCode(e.target.value)} placeholder={`${zone?.code ?? 'RK-A'}-25-1`} />
        </Field>
        <BigButton
          disabled={!code.trim() || !zoneId}
          onClick={() =>
            void save({ code: code.trim().toUpperCase(), zoneId, kind: zone?.kind === 'tent' ? 'floor' : 'bin', active: true }, `เพิ่มช่อง ${code.trim().toUpperCase()} แล้ว`).then(() => setCode(''))
          }
        >
          เพิ่มช่อง
        </BigButton>
      </div>
      <p className="text-sm text-slate-500">
        {locs.length} ช่อง · ใช้งาน {locs.filter((l) => l.active).length}
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
        {locs.map((l) => (
          <button
            key={l.code}
            onClick={() => void save({ ...l, active: !l.active }, `${l.active ? 'ปิด' : 'เปิด'}ช่อง ${l.code} แล้ว`)}
            title={`${LOC_KIND[l.kind]} · แตะเพื่อ${l.active ? 'ปิด' : 'เปิด'}`}
            className={`rounded-md px-2 py-1.5 font-mono text-xs ring-1 ${l.active ? 'bg-white text-slate-700 ring-slate-200 hover:bg-sky-50' : 'bg-slate-100 text-slate-400 line-through ring-slate-200'}`}
          >
            {l.code}
          </button>
        ))}
      </div>
    </Card>
  )
}

function SystemTab() {
  const { api, settings, master, reload } = useWms()
  const [confirm, setConfirm] = useState<'live' | 'trial' | 'round' | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const types = useMemo(() => [...new Set(master.parts.map((p) => p.type).filter(Boolean))].sort() as string[], [master.parts])

  const act = async (fn: () => Promise<unknown>, text: string) => {
    try {
      await fn()
      await reload()
      setMsg({ tone: 'ok', text })
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    } finally {
      setConfirm(null)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {msg && (
        <div className="lg:col-span-2">
          <Alert tone={msg.tone}>{msg.text}</Alert>
        </div>
      )}
      <Card title="โหมดระบบงานคลัง">
        <div className="flex items-center gap-3">
          {settings.mode === 'trial' ? <Pill tone="warn">โหมดทดลอง · รอบที่ {settings.trialRound}</Pill> : <Pill tone="ok">ใช้งานจริง</Pill>}
        </div>
        <p className="text-sm text-slate-600">
          โหมดทดลองเก็บข้อมูลแยกจากของจริง ทุกเครื่องเห็นโหมดเดียวกัน · ป้ายที่พิมพ์ในโหมดทดลองมีคำว่า "ทดลอง" · เลขเอกสารของสองโหมดนับแยกกัน
        </p>
        {confirm === 'live' || confirm === 'trial' ? (
          <div className="flex flex-col gap-2 rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
            <p className="text-sm font-medium text-amber-900">
              {confirm === 'live' ? 'เปลี่ยนเป็นใช้งานจริง: ทุกคนจะเห็นข้อมูลจริง (เริ่มจากว่าง) ข้อมูลทดลองถูกเก็บไว้ ไม่ได้ย้ายมา' : 'กลับไปโหมดทดลอง: ข้อมูลจริงยังอยู่ครบ แต่จะซ่อนจนกว่าจะเปลี่ยนกลับ'}
            </p>
            <div className="flex gap-2">
              <BigButton tone={confirm === 'live' ? 'primary' : 'secondary'} onClick={() => void act(() => api.setSetting('wms_mode', confirm), confirm === 'live' ? 'เปลี่ยนเป็นใช้งานจริงแล้ว' : 'กลับเป็นโหมดทดลองแล้ว')}>
                ยืนยัน
              </BigButton>
              <BigButton tone="ghost" onClick={() => setConfirm(null)}>
                ยกเลิก
              </BigButton>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {settings.mode === 'trial' ? <BigButton onClick={() => setConfirm('live')}>เปลี่ยนเป็นใช้งานจริง</BigButton> : <BigButton tone="secondary" onClick={() => setConfirm('trial')}>กลับไปโหมดทดลอง</BigButton>}
          </div>
        )}
      </Card>

      <Card title="เริ่มรอบทดลองใหม่">
        <p className="text-sm text-slate-600">ล้างหน้าจอทดลองให้เริ่มจากว่าง · ข้อมูลรอบก่อนถูกซ่อนไว้ ไม่ได้ลบทิ้ง (กู้คืนได้) · ข้อมูลใช้งานจริงไม่ถูกแตะ</p>
        {confirm === 'round' ? (
          <div className="flex gap-2">
            <BigButton tone="danger" onClick={() => void act(() => api.newTrialRound(), 'เริ่มรอบทดลองใหม่แล้ว')}>
              ยืนยัน เริ่มรอบที่ {settings.trialRound + 1}
            </BigButton>
            <BigButton tone="ghost" onClick={() => setConfirm(null)}>
              ยกเลิก
            </BigButton>
          </div>
        ) : (
          <BigButton tone="secondary" disabled={settings.mode !== 'trial'} onClick={() => setConfirm('round')}>
            เริ่มรอบทดลองใหม่
          </BigButton>
        )}
      </Card>

      <Card title="กลุ่ม part ที่ MI3 ต้องตรวจ" className="lg:col-span-2">
        <p className="text-sm text-slate-600">ใช้กับ Model ที่ตั้งว่าต้องผ่าน MI3 เท่านั้น (K1G ไม่ตรวจ) · แตะเพื่อเปิด/ปิด</p>
        <div className="flex flex-wrap gap-1.5">
          {types.map((t) => {
            const on = settings.qiPartTypes.includes(t)
            return (
              <button
                key={t}
                aria-pressed={on}
                onClick={() => void act(() => api.setSetting('qi_part_types', on ? settings.qiPartTypes.filter((x) => x !== t) : [...settings.qiPartTypes, t]), `${on ? 'เลิก' : 'เริ่ม'}ตรวจกลุ่ม ${t}`)}
                className={`rounded-full px-3 py-1.5 font-mono text-sm font-semibold ring-1 ${on ? 'bg-violet-600 text-white ring-violet-600' : 'bg-white text-slate-600 ring-slate-300'}`}
              >
                {t}
              </button>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
