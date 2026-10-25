import { useCallback, useEffect, useMemo, useState } from 'react'
import { ROLE_LABEL, type Role } from '../../auth/staff'
import { useAuth } from '../../auth/useAuth'
import { BRAND } from '../../data/brand'
import type { Zone } from '../../types/layout'
import { fmtTime } from '../../lib/format'
import { errorText } from '../../wms/api'
import { buildReadiness, HEAD_KINDS, type ReadyItem, type ReadyTarget } from '../../wms/readiness'
import { ARCHIVE_CONFIRM, ENV_TABLES, envLabel, PERMS, type EnvSummary, type FgItem, type PermRow, type StaffBrief, type StorageLoc } from '../../wms/types'
import { resolvePart } from '../../wms/partCodes'
import { useWms } from '../../wms/useWms'
import { PrintDialog } from '../wms/Print'
import { SlotLabelPages, SLOTS_PER_PAGE } from '../wms/SlotLabels'
import { Alert, BigButton, Card, Field, inputCls, Pill, Segmented, tdCls, thCls } from '../wms/ui'
import { MasterImport } from './MasterImport'
import { UsersPage } from './UsersPage'

type Tab = 'ready' | 'users' | 'perms' | 'heads' | 'master' | 'import' | 'system'
type MasterSub = 'parts' | 'fg' | 'rules' | 'locs'

const EDIT_ROLES: Role[] = ['warehouse', 'mi3', 'production', 'planner', 'engineer', 'manager']

/** หลังบ้าน: ผู้ดูแลระบบจัดการผู้ใช้ สิทธิ์ หัวหน้าโซน ข้อมูลหลัก และโหมดระบบ */
export function BackofficePage({ zones, onNavigate }: { zones: Zone[]; /** ไปหน้าอื่นนอกหลังบ้าน (จากเช็กลิสต์พร้อมใช้จริง) */ onNavigate?: (to: 'layout' | 'count') => void }) {
  const { profile, enabled } = useAuth()
  const { can } = useWms()
  const isAdmin = !enabled || profile?.role === 'admin'
  const tabs: [Tab, string][] = [
    ...(isAdmin ? ([['ready', 'พร้อมใช้จริง']] as [Tab, string][]) : []),
    ...(enabled ? ([['users', 'ผู้ใช้งาน & ประวัติเข้าใช้']] as [Tab, string][]) : []),
    ...(isAdmin ? ([['perms', 'สิทธิ์ตามบทบาท'], ['heads', 'หัวหน้าโซน']] as [Tab, string][]) : []),
    ...(isAdmin || can('master.edit') ? ([['master', 'ข้อมูลหลัก']] as [Tab, string][]) : []),
    ...(isAdmin || can('master.edit') ? ([['import', 'นำเข้าข้อมูล (Excel)']] as [Tab, string][]) : []),
    ...(isAdmin ? ([['system', 'โหมดระบบ']] as [Tab, string][]) : []),
  ]
  const [tab, setTab] = useState<Tab>(tabs[0]?.[0] ?? 'master')
  const [masterSub, setMasterSub] = useState<MasterSub>('parts')
  const go = (t: ReadyTarget) => {
    if (t.kind === 'admin') {
      setTab(t.tab)
      if (t.sub) setMasterSub(t.sub)
    } else onNavigate?.(t.kind === 'layout' ? 'layout' : 'count')
  }

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
            {tab === 'ready' && <ReadinessTab zones={zones} onGo={go} canGo={(t) => t.kind !== 'admin' || tabs.some(([k]) => k === t.tab)} />}
            {tab === 'perms' && <PermissionsTab />}
            {tab === 'heads' && <ZoneHeadsTab zones={zones} />}
            {tab === 'master' && <MasterTab zones={zones} sub={masterSub} onSub={setMasterSub} />}
            {tab === 'import' && <ImportTab />}
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

  const [bulk, setBulk] = useState('')
  const [busy, setBusy] = useState(false)
  const headZones = zones.filter((z) => HEAD_KINDS.has(z.kind))
  // ตั้งคนเดียวดูแลทุกโซน (ช่วงแรก) แล้วค่อยแยกรายโซนตามสายงาน
  const saveAll = async () => {
    const who = staff.find((s) => s.id === bulk)
    if (!who || !window.confirm(`ตั้ง ${who.fullName} เป็นหัวหน้าทั้ง ${headZones.length} โซน?`)) return
    setBusy(true)
    try {
      for (const z of headZones) await api.setZoneHead(z.id, who.id)
      await reload()
      setMsg({ tone: 'ok', text: `ตั้ง ${who.fullName} เป็นหัวหน้าทุกโซน (${headZones.length}) แล้ว · แยกรายโซนได้ด้านล่าง` })
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

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
      <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
        <Field label="ใช้คนเดียวทุกโซน">
          <select id="head-all" className={inputCls} value={bulk} onChange={(e) => setBulk(e.target.value)}>
            <option value="">— เลือกพนักงาน —</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName} ({s.employeeCode})
              </option>
            ))}
          </select>
        </Field>
        <BigButton disabled={!bulk || busy} onClick={() => void saveAll()}>
          {busy ? 'กำลังบันทึก…' : `ตั้งทั้ง ${headZones.length} โซน`}
        </BigButton>
        <p className="w-full text-xs text-slate-500">ไม่มีชื่อในรายการ? เพิ่มบัญชีพนักงานที่แท็บ “ผู้ใช้งาน & ประวัติเข้าใช้” ก่อน</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {headZones
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

/**
 * นำเข้าข้อมูลหลักจาก Excel (แบบฟอร์มของระบบ): Part / รหัส UAM, BOM ชุดวงล้อ
 * ดาวน์โหลดแบบฟอร์ม (มีข้อมูลปัจจุบัน) → กรอก → อัปโหลด → ตรวจทีละแถว → บันทึก
 * ยอดคงเหลือ (ตรวจนับ) อยู่ที่เดียว: งานคลัง › 7 ตรวจนับ & อนุมัติ
 */
function ImportTab() {
  const [sub, setSub] = useState<'parts' | 'bom'>('parts')
  return (
    <>
      <Segmented
        label="นำเข้าข้อมูล"
        value={sub}
        onChange={setSub}
        options={[
          ['parts', 'Part / รหัส UAM'],
          ['bom', 'BOM ชุดวงล้อ'],
        ]}
      />
      {sub === 'parts' && <MasterImport kind="parts" />}
      {sub === 'bom' && <MasterImport kind="bom" />}
      <p className="text-sm text-slate-500">ยอดคงเหลือ (ตรวจนับด้วย Excel) อยู่ที่ งานคลัง › 7 ตรวจนับ &amp; อนุมัติ · ที่เดียวกับคิวอนุมัติปรับยอด</p>
    </>
  )
}

function MasterTab({ zones, sub, onSub }: { zones: Zone[]; sub: MasterSub; onSub: (s: MasterSub) => void }) {
  return (
    <>
      <Segmented
        label="ข้อมูลหลัก"
        value={sub}
        onChange={onSub}
        options={[
          ['parts', 'Part'],
          ['fg', 'ชุดวงล้อ (BOM)'],
          ['rules', 'กฎโซนจัดเก็บ'],
          ['locs', 'ช่องเก็บ'],
        ]}
      />
      {sub === 'parts' && <PartsEditor />}
      {sub === 'fg' && <FgEditor />}
      {sub === 'rules' && <RulesEditor zones={zones} />}
      {sub === 'locs' && <LocationsEditor zones={zones} />}
    </>
  )
}

const EMPTY_PART = { partNo: '', name: '', type: '', customerId: 'RE', models: [] as string[], uamCode: '' }

function PartsEditor() {
  const { api, master, settings, reload } = useWms()
  const [q, setQ] = useState('')
  const [form, setForm] = useState(EMPTY_PART)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const types = useMemo(() => [...new Set(master.parts.map((p) => p.type).filter(Boolean))].sort() as string[], [master.parts])
  const shown = master.parts
    .filter((p) => !q || `${p.partNo} ${p.uamCode ?? ''} ${p.name} ${p.type} ${p.models.join(' ')}`.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 200)

  const save = async () => {
    try {
      await api.upsertPart({ ...form, type: form.type || null, uamCode: form.uamCode.trim() || null })
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
        <input id="part-search" className={inputCls} placeholder="ค้นหา Part No. / รหัส UAM / ชื่อ / กลุ่ม / Model" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-[60vh] overflow-auto rounded-lg ring-1 ring-slate-200">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0">
              <tr>
                <th className={thCls}>Part No.</th>
                <th className={thCls}>รหัส UAM</th>
                <th className={thCls}>ชื่อ</th>
                <th className={thCls}>กลุ่ม</th>
                <th className={thCls}>Model</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.partNo}>
                  <td className={`${tdCls} font-mono font-semibold`}>
                    {p.partNo}
                    {p.revision && <span className="ml-1 text-xs font-normal text-slate-400">rev {p.revision}</span>}
                  </td>
                  <td className={`${tdCls} font-mono text-slate-600`}>{p.uamCode ?? '–'}</td>
                  <td className={tdCls}>{p.name}</td>
                  <td className={tdCls}>{p.type && <Pill tone={settings.qiPartTypes.includes(p.type) ? 'mi3' : 'muted'}>{p.type}</Pill>}</td>
                  <td className={`${tdCls} text-xs text-slate-500`}>{p.models.join(', ')}</td>
                  <td className={tdCls}>
                    <button className="text-sm text-sky-700 hover:underline" onClick={() => setForm({ partNo: p.partNo, name: p.name, type: p.type ?? '', customerId: p.customerId ?? 'RE', models: p.models, uamCode: p.uamCode ?? '' })}>
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
        <Field label="Part No." hint="ใช้เลขฐาน เช่น RAT00586 · พิมพ์ /B มาก็ได้ ระบบเก็บเป็นเลขฐานและจำ revision ไว้">
          <input id="pf-no" className={`${inputCls} font-mono`} value={form.partNo} onChange={(e) => setForm({ ...form, partNo: e.target.value })} />
        </Field>
        <Field label="รหัสภายใน UAM" hint="รหัสในใบเบิกย่อยของ MRA เช่น 2011409 · ค้นหา/สแกนด้วยรหัสนี้ได้">
          <input id="pf-uam" className={`${inputCls} font-mono`} value={form.uamCode} onChange={(e) => setForm({ ...form, uamCode: e.target.value })} />
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

const EMPTY_FG: FgItem = { code: '', name: '', modelCode: null, active: true, lines: [] }

/** ชุดวงล้อ (FG) + BOM: part ที่ใช้ต่อ 1 วง · ใบเบิกใส่จำนวนวงแล้วระบบคำนวณทุก part ให้ */
function FgEditor() {
  const { api, master, reload } = useWms()
  const [form, setForm] = useState<FgItem>(EMPTY_FG)
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const partOf = (no: string) => master.parts.find((p) => p.partNo === no)

  const addLine = () => {
    const p = resolvePart(master.parts, code)
    if (!p) return setMsg({ tone: 'bad', text: `ไม่พบ "${code}" ใน Master (ใช้รหัสลูกค้า หรือรหัส UAM)` })
    if (!form.lines.some((l) => l.partNo === p.partNo)) setForm({ ...form, lines: [...form.lines, { partNo: p.partNo, qtyPer: 1 }] })
    setCode('')
    setMsg(null)
  }
  const save = async () => {
    try {
      await api.saveFg(form)
      await reload()
      setMsg({ tone: 'ok', text: `บันทึกชุด ${form.code} แล้ว` })
      setForm(EMPTY_FG)
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_440px]">
      <Card title={`ชุดวงล้อ (${master.fgItems.length})`} eyebrow="1 Model มีได้หลายชุด เช่น ล้อหน้า/หลัง แต่ละสี">
        <ul className="flex flex-col gap-1.5">
          {master.fgItems.length === 0 && <p className="text-sm text-slate-500">ยังไม่มีชุดวงล้อ · เพิ่มทางขวา</p>}
          {master.fgItems.map((f) => (
            <li key={f.code}>
              <button
                onClick={() => setForm(f)}
                className={`flex w-full flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ring-1 ${form.code === f.code ? 'bg-sky-50 ring-sky-600' : 'ring-slate-200 hover:bg-slate-50'} ${f.active ? '' : 'opacity-50'}`}
              >
                <b className="font-mono">{f.code}</b>
                <span>{f.name}</span>
                <span className="ml-auto text-xs text-slate-500">
                  {f.modelCode ?? '-'} · {f.lines.length} part{f.active ? '' : ' · เลิกใช้'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={master.fgItems.some((f) => f.code === form.code) ? `แก้ไข ${form.code}` : 'เพิ่มชุดวงล้อ'}>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="รหัส FG" hint="เช่น รหัส UAM ของวงล้อ 2019333">
            <input className={`${inputCls} font-mono uppercase`} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
          <Field label="Model">
            <select className={inputCls} value={form.modelCode ?? ''} onChange={(e) => setForm({ ...form, modelCode: e.target.value || null })}>
              <option value="">—</option>
              {master.models.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.code}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="ชื่อชุด">
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="เช่น K1G ล้อหลัง 17×3.50 TL BLACK" />
        </Field>
        <div className="rounded-lg ring-1 ring-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={thCls}>Part</th>
                <th className={`${thCls} text-right`}>ต่อ 1 วง</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {form.lines.map((l) => (
                <tr key={l.partNo}>
                  <td className={tdCls}>
                    <div className="font-mono font-semibold">{l.partNo}</div>
                    <div className="text-xs text-slate-500">{[partOf(l.partNo)?.uamCode, partOf(l.partNo)?.name].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className={`${tdCls} text-right`}>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right font-mono"
                      value={l.qtyPer}
                      onChange={(e) => setForm({ ...form, lines: form.lines.map((x) => (x.partNo === l.partNo ? { ...x, qtyPer: Math.max(0, Number(e.target.value) || 0) } : x)) })}
                      aria-label={`ต่อวง ${l.partNo}`}
                    />
                  </td>
                  <td className={tdCls}>
                    <button className="text-slate-400 hover:text-rose-600" onClick={() => setForm({ ...form, lines: form.lines.filter((x) => x.partNo !== l.partNo) })} aria-label="เอาออก">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            addLine()
          }}
        >
          <input list="fg-parts" className={`${inputCls} font-mono`} placeholder="+ part: รหัสลูกค้า / รหัส UAM" value={code} onChange={(e) => setCode(e.target.value)} />
          <datalist id="fg-parts">
            {master.parts
              .filter((p) => !form.modelCode || p.models.includes(form.modelCode))
              .map((p) => (
                <option key={p.partNo} value={p.partNo}>
                  {p.name}
                </option>
              ))}
          </datalist>
          <BigButton type="submit" tone="secondary" disabled={!code.trim()}>
            เพิ่ม
          </BigButton>
        </form>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" className="h-5 w-5" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          ใช้งานอยู่ (เอาออกเพื่อเลิกใช้ชุดนี้)
        </label>
        <div className="flex gap-2">
          <BigButton disabled={!form.code.trim() || !form.name.trim() || !form.lines.length} onClick={() => void save()}>
            บันทึก
          </BigButton>
          <BigButton tone="ghost" onClick={() => setForm(EMPTY_FG)}>
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
  // ช่องตามผัง + ช่องพิเศษ (ไม่แสดงช่องที่ผังเลิกใช้แล้ว)
  const locs = master.locations.filter((l) => l.zoneId === zoneId && (l.active || l.blocked || l.manual))
  const zone = zones.find((z) => z.id === zoneId)
  const [printOpen, setPrintOpen] = useState(false)
  const printable = locs
    .filter((l) => l.active)
    .map((l) => l.code)
    .sort()

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
    <Card title="ช่องเก็บ" eyebrow="รหัสสากล: โซน-ช่อง-ชั้น (RK-A-01-1) · เต็นท์ใช้ โซน-บล็อก (TENT-T-01)">
      <p className="text-sm text-slate-600">
        จำนวนช่องตามผัง เพิ่ม/ลดที่หน้า <b>ปรับผัง</b> · หน้านี้ใช้ <b>ปิดช่องที่ชำรุด</b> (ระบบจะไม่แนะนำให้วางของ) และ <b>เพิ่มช่องพิเศษ</b> ที่ไม่อยู่ในผัง · บันทึกผังจะไม่เปิดช่องที่ปิดไว้ และไม่ลบช่องพิเศษ
      </p>
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
        <Field label="เพิ่มช่องพิเศษ">
          <input id="loc-code" className={`${inputCls} font-mono uppercase`} value={code} onChange={(e) => setCode(e.target.value)} placeholder={`${zone?.code ?? 'RK-A'}-25-1`} />
        </Field>
        <BigButton
          disabled={!code.trim() || !zoneId}
          onClick={() =>
            void save({ code: code.trim().toUpperCase(), zoneId, kind: zone?.kind === 'tent' ? 'floor' : 'bin', active: true }, `เพิ่มช่องพิเศษ ${code.trim().toUpperCase()} แล้ว`).then(() => setCode(''))
          }
        >
          เพิ่มช่องพิเศษ
        </BigButton>
        <BigButton tone="secondary" disabled={!printable.length} onClick={() => setPrintOpen(true)}>
          พิมพ์ป้าย QR ช่อง ({printable.length})
        </BigButton>
      </div>
      <PrintDialog
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        format="sheet"
        title={`ป้ายช่องเก็บ ${zone?.code ?? ''}`}
        subtitle={`${printable.length} ป้าย · ${Math.ceil(printable.length / SLOTS_PER_PAGE)} แผ่น A4 (สติกเกอร์ 3×8 ดวง 70×37 มม. หรือกระดาษธรรมดาแล้วตัดตามเส้น) · ช่องที่ปิดใช้ไม่พิมพ์`}
        printLabel={`พิมพ์ ${printable.length} ป้าย`}
      >
        <SlotLabelPages codes={printable} zoneName={zone ? `${zone.code} · ${zone.name}` : ''} />
      </PrintDialog>
      <p className="text-sm text-slate-500">
        {locs.length} ช่อง · ใช้งาน {locs.filter((l) => l.active).length} · ปิด (ชำรุด) {locs.filter((l) => l.blocked).length} · ช่องพิเศษ {locs.filter((l) => l.manual).length}
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
        {locs.map((l) => (
          <button
            key={l.code}
            onClick={() => void save({ ...l, active: !l.active }, `${l.active ? 'ปิด' : 'เปิด'}ช่อง ${l.code} แล้ว`)}
            title={`${LOC_KIND[l.kind]}${l.manual ? ' · ช่องพิเศษ' : ''} · แตะเพื่อ${l.active ? 'ปิด (ชำรุด / ห้ามใช้)' : 'เปิดใช้'}`}
            className={`rounded-md px-2 py-1.5 font-mono text-xs ring-1 ${l.active ? 'bg-white text-slate-700 ring-slate-200 hover:bg-sky-50' : 'bg-slate-100 text-slate-400 line-through ring-slate-200'} ${l.manual ? 'ring-violet-300' : ''}`}
          >
            {l.code}
            {l.manual && <span className="ml-1 rounded bg-violet-100 px-1 font-sans text-[10px] text-violet-700 no-underline">พิเศษ</span>}
          </button>
        ))}
      </div>
    </Card>
  )
}

const READY_TONE = {
  ok: { icon: '✓', label: 'เรียบร้อย', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  todo: { icon: '○', label: 'ยังไม่ครบ', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  manual: { icon: '?', label: 'ตรวจที่หน้างาน', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
}

/** เช็กลิสต์ก่อนใช้งานจริง: คิดจากข้อมูลในระบบตอนนี้ · กดปุ่มไปยังหน้าที่ใช้แก้ */
function ReadinessTab({ zones, onGo, canGo }: { zones: Zone[]; onGo: (t: ReadyTarget) => void; /** หน้าปลายทางมีในบัญชีนี้ไหม (หน้าสาธิตไม่มีหน้าผู้ใช้งาน) */ canGo: (t: ReadyTarget) => boolean }) {
  const { api, master, settings } = useWms()
  const [data, setData] = useState<{ staff: StaffBrief[]; boxes: number; countSheets: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    Promise.all([api.staffDirectory(), api.activeLpns(), api.listStockCounts()])
      .then(([staff, lpns, counts]) => alive && setData({ staff, boxes: lpns.length, countSheets: counts.filter((c) => c.status === 'approved').length }))
      .catch((e) => alive && setError(errorText(e)))
    return () => {
      alive = false
    }
  }, [api, master])
  const items = data ? buildReadiness({ ...data, master, zones, mode: settings.mode }) : []
  const must = items.filter((i) => i.required && i.ok !== null)
  const done = must.filter((i) => i.ok).length
  const allDone = data !== null && done === must.length

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="bad">{error}</Alert>}
      <Card title="พร้อมใช้งานจริง">
        <p className="text-sm text-slate-600">ตรวจจากข้อมูลในระบบตอนนี้ · ทำข้อจำเป็นให้ครบก่อนเริ่มใช้จริง กดปุ่มของแต่ละข้อเพื่อไปหน้าที่ใช้ทำ</p>
        {data ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ${allDone ? READY_TONE.ok.cls : READY_TONE.todo.cls}`}>
              {allDone ? '✓ ข้อจำเป็นครบแล้ว' : `ข้อจำเป็น ${done}/${must.length}`}
            </span>
            <div className="h-2 min-w-[160px] flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${must.length ? (done / must.length) * 100 : 0}%` }} />
            </div>
          </div>
        ) : (
          !error && <p className="text-sm text-slate-400">กำลังตรวจ…</p>
        )}
      </Card>
      {data && (
        <ol className="flex flex-col gap-2">
          {items.map((i) => (
            <ReadyRow key={i.id} item={i} onGo={onGo} canGo={canGo(i.action.target)} />
          ))}
        </ol>
      )}
    </div>
  )
}

function ReadyRow({ item, onGo, canGo }: { item: ReadyItem; onGo: (t: ReadyTarget) => void; canGo: boolean }) {
  const tone = READY_TONE[item.ok === null ? 'manual' : item.ok ? 'ok' : 'todo']
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ring-1 ${tone.cls}`} aria-hidden>
        {tone.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-slate-800">{item.title}</b>
          <Pill tone={item.required ? 'info' : 'muted'}>{item.required ? 'จำเป็น' : 'แนะนำ'}</Pill>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${tone.cls}`}>{tone.label}</span>
        </div>
        <p className="mt-0.5 text-sm text-slate-600">{item.detail}</p>
        {item.progress && item.progress.total > 0 && (
          <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
            <div className="h-1.5 w-40 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              <div className={`h-full rounded-full ${item.ok ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{ width: `${(item.progress.done / item.progress.total) * 100}%` }} />
            </div>
            {item.progress.done.toLocaleString('en-US')}/{item.progress.total.toLocaleString('en-US')}
          </div>
        )}
      </div>
      {canGo ? (
        <BigButton tone={item.ok ? 'ghost' : 'secondary'} onClick={() => onGo(item.action.target)}>
          {item.action.label} →
        </BigButton>
      ) : (
        <span className="max-w-[220px] text-xs text-slate-500">หน้าสาธิตไม่มีบัญชีผู้ใช้จริง · ระบบจริง{item.action.label}ที่แท็บ "ผู้ใช้งาน & ประวัติเข้าใช้"</span>
      )}
    </li>
  )
}

function SystemTab() {
  const { api, settings, master, reload } = useWms()
  const [confirm, setConfirm] = useState<'live' | 'trial' | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [summary, setSummary] = useState<EnvSummary | null>(null)
  const types = useMemo(() => [...new Set(master.parts.map((p) => p.type).filter(Boolean))].sort() as string[], [master.parts])

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await api.envSummary())
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    }
  }, [api])
  useEffect(() => {
    let alive = true
    api.envSummary().then((s) => alive && setSummary(s)).catch((e) => alive && setMsg({ tone: 'bad', text: errorText(e) }))
    return () => {
      alive = false
    }
  }, [api])

  /** ทำงานแล้วโหลดค่าตั้ง + จำนวนข้อมูลใหม่ · คืน true เมื่อสำเร็จ */
  const run = async (fn: () => Promise<string>) => {
    try {
      const text = await fn()
      await reload()
      await loadSummary()
      setMsg({ tone: 'ok', text })
      return true
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
      return false
    } finally {
      setConfirm(null)
    }
  }
  const act = (fn: () => Promise<unknown>, text: string) =>
    run(async () => {
      await fn()
      return text
    })

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
        {confirm ? (
          <div className="flex flex-col gap-2 rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
            <p className="text-sm font-medium text-amber-900">
              {confirm === 'live' ? 'เปลี่ยนเป็นใช้งานจริง: ทุกคนจะเห็นข้อมูลของโหมดใช้งานจริง ข้อมูลทดลองถูกเก็บไว้ ไม่ได้ย้ายมา' : 'กลับไปโหมดทดลอง: ข้อมูลจริงยังอยู่ครบ แต่จะซ่อนจนกว่าจะเปลี่ยนกลับ'}
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

      <ResetCard
        summary={summary}
        onArchive={(typed, note) =>
          run(async () => {
            const id = await api.archiveEnv(typed, note)
            return `เก็บข้อมูลโหมด${envLabel(summary?.env ?? '')} เป็นชุดที่ ${id} แล้ว · ทุกเครื่องเริ่มจากคลังว่าง (กู้คืนได้จากรายการด้านล่าง)`
          })
        }
      />

      <ArchivesCard
        summary={summary}
        onRestore={(id) =>
          run(async () => {
            await api.restoreArchive(id)
            return `กู้คืนชุดที่ ${id} แล้ว · ข้อมูลกลับมาแสดงในโหมด${envLabel(summary?.env ?? '')}`
          })
        }
      />

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

const countsText = (counts: EnvSummary['counts']) =>
  ENV_TABLES.filter(([k]) => counts[k] > 0)
    .map(([k, label]) => `${label} ${counts[k].toLocaleString('th-TH')}`)
    .join(' · ')

/** ล้างข้อมูลรายการของโหมดปัจจุบันแบบเก็บถาวร: พิมพ์คำยืนยันก่อน */
function ResetCard({ summary, onArchive }: { summary: EnvSummary | null; onArchive: (typed: string, note: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const live = summary?.env === 'live'
  const mode = `โหมด${envLabel(summary?.env ?? '')}`
  const total = summary ? ENV_TABLES.reduce((s, [k]) => s + summary.counts[k], 0) : 0
  const close = () => {
    setOpen(false)
    setTyped('')
    setNote('')
  }
  const submit = async () => {
    setBusy(true)
    const ok = await onArchive(typed, note)
    setBusy(false)
    if (ok) close()
  }

  return (
    <Card title="ล้างข้อมูล (เก็บถาวร)">
      <p className="text-sm text-slate-600">ย้ายข้อมูลรายการทั้งหมดของ{summary ? mode : 'โหมดปัจจุบัน'} ไปเก็บเป็นชุด ไม่มีการลบ · กู้คืนได้จากรายการด้านล่าง</p>
      {summary ? (
        <dl className="grid grid-cols-1 gap-x-5 text-sm sm:grid-cols-2" aria-label={`ข้อมูลของ${mode}ตอนนี้`}>
          {ENV_TABLES.map(([k, label]) => (
            <div key={k} className="flex items-baseline justify-between gap-2 border-b border-slate-100 py-1">
              <dt className="text-slate-500">{label}</dt>
              <dd className={`font-semibold tabular-nums ${summary.counts[k] ? 'text-slate-800' : 'text-slate-300'}`}>{summary.counts[k].toLocaleString('th-TH')}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-slate-400">กำลังนับข้อมูล…</p>
      )}
      <p className="text-xs text-slate-500">
        คงไว้ครบ: part, BOM, Model, ผังคลัง, ช่องเก็บ, ผู้ใช้, สิทธิ์ และค่าตั้ง · เลขเอกสารเดินต่อจากเดิม ป้ายเก่าที่ยังติดกล่องจะสแกนแล้ว "ไม่พบ" ไม่ชนกับป้ายใหม่
      </p>
      {open ? (
        <div className={`flex flex-col gap-3 rounded-lg p-3 ring-1 ${live ? 'bg-rose-50 ring-rose-200' : 'bg-amber-50 ring-amber-200'}`}>
          <p className={`text-sm font-medium ${live ? 'text-rose-900' : 'text-amber-900'}`}>
            หลังยืนยัน ทุกเครื่องจะเห็นคลังว่างทันที: กล่อง สต็อก ใบเบิก และประวัติของ{mode} หายจากหน้าจอ (เก็บไว้ กู้คืนได้) · ควรทำตอนไม่มีใครรับหรือเบิกของ
          </p>
          <Field label="หมายเหตุ (ไม่บังคับ)">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ข้อมูลฝึกใช้งานก่อนเริ่มจริง" />
          </Field>
          <Field label={`พิมพ์ "${ARCHIVE_CONFIRM}" เพื่อยืนยัน`}>
            <input className={inputCls} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" aria-describedby="archive-total" />
          </Field>
          <p id="archive-total" className="text-xs text-slate-600">
            จะเก็บ {countsText(summary!.counts)}
          </p>
          <div className="flex flex-wrap gap-2">
            <BigButton tone="danger" disabled={busy || typed.trim() !== ARCHIVE_CONFIRM} onClick={() => void submit()}>
              {busy ? 'กำลังล้าง…' : `ยืนยัน ล้างข้อมูล${mode}`}
            </BigButton>
            <BigButton tone="ghost" disabled={busy} onClick={close}>
              ยกเลิก
            </BigButton>
          </div>
        </div>
      ) : (
        <BigButton tone="secondary" className="self-start" disabled={!summary || total === 0} onClick={() => setOpen(true)}>
          {summary && total === 0 ? 'โหมดนี้ยังไม่มีข้อมูลรายการ' : `ล้างข้อมูล${summary ? mode : ''}…`}
        </BigButton>
      )}
    </Card>
  )
}

/** ชุดที่ล้างเก็บไว้: กู้คืนได้เมื่ออยู่ในโหมดเดียวกับตอนล้างและโหมดนั้นยังว่าง */
function ArchivesCard({ summary, onRestore }: { summary: EnvSummary | null; onRestore: (id: number) => Promise<boolean> }) {
  const [ask, setAsk] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const restore = async (id: number) => {
    setBusy(true)
    if (await onRestore(id)) setAsk(null)
    setBusy(false)
  }

  return (
    <Card title="ชุดข้อมูลที่ล้างเก็บไว้" className="lg:col-span-2">
      {!summary ? (
        <p className="text-sm text-slate-400">กำลังโหลด…</p>
      ) : summary.archives.length === 0 ? (
        <p className="text-sm text-slate-500">ยังไม่เคยล้างข้อมูล</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {summary.archives.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-slate-800">ชุดที่ {a.id}</b>
                  <Pill tone={a.fromEnv === 'live' ? 'ok' : 'warn'}>{envLabel(a.fromEnv)}</Pill>
                  {a.restoredAt && <Pill tone="muted">กู้คืนแล้ว</Pill>}
                </div>
                <div className="mt-0.5 text-sm text-slate-600">
                  ล้างเมื่อ {fmtTime(a.archivedAt)} · โดย {a.archivedCode ?? 'ผู้ดูแลฐานข้อมูล'}
                  {a.note && ` · ${a.note}`}
                </div>
                <div className="text-xs text-slate-500">{countsText(a.counts)}</div>
                {a.restoredAt && (
                  <div className="text-xs text-slate-500">
                    กู้คืนเมื่อ {fmtTime(a.restoredAt)} · โดย {a.restoredCode ?? 'ผู้ดูแลฐานข้อมูล'}
                  </div>
                )}
              </div>
              {!a.restoredAt &&
                (ask === a.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-slate-600">ข้อมูลชุดนี้จะกลับมาแสดงใน{`โหมด${envLabel(a.fromEnv)}`}</span>
                    <BigButton disabled={busy} onClick={() => void restore(a.id)}>
                      {busy ? 'กำลังกู้คืน…' : `ยืนยัน กู้คืนชุดที่ ${a.id}`}
                    </BigButton>
                    <BigButton tone="ghost" disabled={busy} onClick={() => setAsk(null)}>
                      ยกเลิก
                    </BigButton>
                  </div>
                ) : (
                  <div className="flex flex-col items-end gap-1">
                    <BigButton tone="secondary" disabled={!a.restorable} onClick={() => setAsk(a.id)}>
                      กู้คืน
                    </BigButton>
                    {!a.restorable && (
                      <span className="max-w-[18rem] text-right text-xs text-slate-500">
                        {a.fromEnv !== summary.env ? `กู้คืนได้เมื่ออยู่ในโหมด${envLabel(a.fromEnv)}` : 'โหมดนี้มีข้อมูลใหม่แล้ว · ล้างข้อมูลปัจจุบันเก็บไว้ก่อนจึงกู้คืนได้'}
                      </span>
                    )}
                  </div>
                ))}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
