import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { ROLE_LABEL, ROLES, type Role } from '../../auth/staff'
import type { Perm, PermRow } from '../../wms/types'
import { useWms } from '../../wms/useWms'
import { Card, Pill } from './ui'

/** หน้าจอที่ผังระบบพาไปได้ (หน้าหลักบอกว่าอันไหนไปได้บนเครื่องนี้) */
export type MapTarget = 'work' | 'trace' | 'receive' | 'labels' | 'scan' | 'move' | 'invoice' | 'issue' | 'ledger' | 'count' | 'dash' | 'plan' | 'map3d' | 'layout' | 'admin'

type Device = 'mobile' | 'desk'

interface Step {
  n: number
  title: string
  /** เอกสาร / เลขที่ระบบออก */
  doc: string
  what: string
  perms: Perm[]
  device: Device[]
  go: MapTarget
}

const GROUPS: { title: string; tone: string; steps: Step[] }[] = [
  {
    title: 'รับเข้า',
    tone: 'bg-sky-600',
    steps: [
      {
        n: 1,
        title: 'ตรวจรับตาม Packing List',
        doc: 'ใบตรวจรับ CHK-…',
        what: 'ถ่าย PL/Invoice ให้ AI อ่าน แล้วตรวจของทีละเคส หลายคนช่วยกันได้',
        perms: ['receive.create'],
        device: ['mobile', 'desk'],
        go: 'receive',
      },
      {
        n: 2,
        title: 'ออก GRN & ป้าย QR',
        doc: 'GRN-… · ป้ายกล่อง LPN-…',
        what: 'ตรวจครบกดออก GRN ระบบสร้างกล่อง (1 เคส = 1 กล่อง) ของเสียหายแยกกล่อง NG',
        perms: ['receive.create', 'label.print'],
        device: ['mobile', 'desk'],
        go: 'labels',
      },
      { n: 3, title: 'ตรวจคุณภาพ MI3', doc: 'ผลตรวจ QI-…', what: 'part ที่ต้องตรวจถูกกักไว้ MI3 บันทึกดี / NG แล้วจึงเบิกได้', perms: ['scan.qi'], device: ['mobile'], go: 'scan' },
    ],
  },
  {
    title: 'จัดเก็บ',
    tone: 'bg-emerald-600',
    steps: [
      {
        n: 4,
        title: 'จัดเก็บเข้าช่อง',
        doc: 'PUT / MOVE',
        what: 'สแกนกล่อง + ป้ายช่อง หรือเลือกหลายกล่องจากรายการแล้วย้ายทีเดียว ระบบแนะนำช่องตามโซน',
        perms: ['scan.put', 'scan.move'],
        device: ['mobile', 'desk'],
        go: 'move',
      },
      {
        n: 5,
        title: 'ในช่องเก็บ พร้อมเบิก',
        doc: 'ช่อง RK-… บนผัง 2D / 3D',
        what: 'ค้นหา part / กล่อง แล้วดูตำแหน่งบนผัง · นับวนทุกวันให้ยอดตรง',
        perms: ['scan.count'],
        device: ['mobile', 'desk'],
        go: 'plan',
      },
      {
        n: 6,
        title: 'NG รอส่งคืน',
        doc: 'กล่องที่พื้นที่กัก NG',
        what: 'ของเสียหายจากตรวจรับเบิกเข้าไลน์ไม่ได้ ตัดยอดด้วยการเบิก → NG / ส่งคืน แล้วรับของทดแทน',
        perms: ['scan.issue'],
        device: ['mobile', 'desk'],
        go: 'scan',
      },
    ],
  },
  {
    title: 'จ่ายออก & ปิดยอด',
    tone: 'bg-indigo-600',
    steps: [
      {
        n: 7,
        title: 'เบิกเข้าไลน์',
        doc: 'ใบเบิก RQ-…',
        what: 'สแกนกล่องเบิก หรือบันทึกใบเบิก ระบบตัดกล่องที่รับเข้าก่อน (FIFO) ข้ามของ NG',
        perms: ['scan.issue'],
        device: ['mobile', 'desk'],
        go: 'issue',
      },
      {
        n: 8,
        title: 'กระทบ FM-P-005',
        doc: 'FM-P-005 (วัน + Model)',
        what: 'จบวันกรอกยอด FM-P-005 ระบบเทียบกับใบย่อย ส่วนต่างตัดเพิ่ม / คืนเข้าสต็อก',
        perms: ['scan.issue'],
        device: ['desk'],
        go: 'issue',
      },
      {
        n: 9,
        title: 'ปิดยอด FM-P-537',
        doc: 'บัญชีคุมรายเดือน',
        what: 'สิ้นเดือนหัวหน้าปิดยอดแต่ละ Model · Planning และบัญชีกดรับทราบ',
        perms: ['ledger.close', 'ledger.ack.planning', 'ledger.ack.account'],
        device: ['desk'],
        go: 'ledger',
      },
    ],
  },
]

const CONTROLS: { title: string; what: string; perms: Perm[]; device: Device[]; go: MapTarget }[] = [
  { title: 'กระทบยอด Invoice', what: 'ยอดรับทุกใบรับเทียบ Invoice · ครบกดปิด ไม่ครบแจ้งผู้ขาย', perms: ['invoice.close', 'invoice.report'], device: ['desk'], go: 'invoice' },
  {
    title: 'ตรวจนับ & อนุมัติปรับยอด',
    what: 'นับไม่ตรงขอปรับยอด คนขอกับคนอนุมัติต้องเป็นคนละคน · นำเข้าใบนับจาก Excel ได้',
    perms: ['scan.count', 'scan.adjust.approve'],
    device: ['mobile', 'desk'],
    go: 'count',
  },
  { title: 'ยกเลิกใบรับ (GRN)', what: 'รับผิดยกเลิกได้เมื่อของยังไม่ถูกใช้ ใบตรวจรับเปิดกลับมาแก้', perms: ['grn.void'], device: ['desk'], go: 'labels' },
  { title: 'คิวพิมพ์ป้าย', what: 'มือถือส่งงานพิมพ์ คอมจุดพิมพ์กดพิมพ์ทีเดียว', perms: ['label.print'], device: ['mobile', 'desk'], go: 'labels' },
  { title: 'ตามรอยเอกสาร / กล่อง', what: 'ค้นเลขไหนก็ได้ เห็นทั้งสาย PL → กล่อง → ใบเบิก → บัญชีคุม และย้อนกลับ', perms: [], device: ['mobile', 'desk'], go: 'trace' },
]

const VIEWS: { title: string; what: string; device: Device[]; go: MapTarget }[] = [
  { title: 'งานวันนี้', what: 'งานค้างตามสิทธิ์ + ผังขั้นตอนงานสด', device: ['mobile', 'desk'], go: 'work' },
  { title: 'ภาพรวม', what: 'สต็อกต่อ Model วันใช้ได้ คุณภาพ MI3 ความแม่นยำสต็อก', device: ['desk'], go: 'dash' },
  { title: 'ผังคลัง 2D', what: 'ทุกช่องเก็บรายชั้น สีตามสถานะ ค้นหาแล้วชี้ตำแหน่ง', device: ['mobile', 'desk'], go: 'plan' },
  { title: 'ผังโรงงาน 3D', what: 'ภาพรวมโรงงาน ทัวร์ผู้บริหาร heatmap การเคลื่อนไหว', device: ['desk'], go: 'map3d' },
]

const SETUP: { title: string; what: string; go: MapTarget }[] = [
  { title: 'หลังบ้าน', what: 'สิทธิ์ตามบทบาท หัวหน้าโซน ข้อมูลหลัก Part / BOM / ช่องเก็บ โหมดทดลอง / ใช้งานจริง ความพร้อมก่อนใช้งานจริง', go: 'admin' },
  { title: 'ปรับผัง', what: 'โซน ชั้นวาง จำนวนช่อง บันได ลิฟต์ (บันทึกลงฐานข้อมูลกลาง)', go: 'layout' },
]

/** หน้าที่ในตาราง "ใครทำอะไร" (ตามตารางสิทธิ์จริง) */
const DUTIES: { label: string; perms: Perm[] }[] = [
  { label: 'ตรวจรับ / GRN', perms: ['receive.create'] },
  { label: 'พิมพ์ป้าย', perms: ['label.print'] },
  { label: 'จัดเก็บ', perms: ['scan.put'] },
  { label: 'ย้าย', perms: ['scan.move'] },
  { label: 'ผล MI3', perms: ['scan.qi'] },
  { label: 'เบิก / FM-P-005', perms: ['scan.issue'] },
  { label: 'ตรวจนับ', perms: ['scan.count'] },
  { label: 'อนุมัติปรับยอด', perms: ['scan.adjust.approve'] },
  { label: 'Invoice', perms: ['invoice.report', 'invoice.close'] },
  { label: 'ยกเลิกใบรับ', perms: ['grn.void'] },
  { label: 'ปิดยอดเดือน', perms: ['ledger.close'] },
  { label: 'รับทราบ Planning', perms: ['ledger.ack.planning'] },
  { label: 'รับทราบบัญชี', perms: ['ledger.ack.account'] },
  { label: 'ข้อมูลหลัก / ผัง', perms: ['master.edit', 'layout.edit'] },
]

const DEVICE: Record<Device, string> = { mobile: '📱 มือถือ', desk: '🖥 คอม' }

/** admin ทำได้ทุกอย่างเสมอ (ไม่อยู่ในตาราง) */
const allows = (rows: PermRow[], role: Role, perm: Perm) => role === 'admin' || rows.some((r) => r.role === role && r.perm === perm && r.allowed)

/**
 * ผังระบบงาน: ขั้นตอนหลัก งานควบคุม หน้าจอดูภาพรวม และใครทำอะไร (จากตารางสิทธิ์จริง)
 * ใช้สอนงาน / นำเสนอ · แตะการ์ดเพื่อเปิดหน้าจอนั้น (ถ้าเครื่องนี้เปิดได้)
 */
export function SystemMap({ compact = false, onGo, canGo = () => true }: { compact?: boolean; onGo?: (to: MapTarget) => void; canGo?: (to: MapTarget) => boolean }) {
  const { api, ready } = useWms()
  const [rows, setRows] = useState<PermRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!ready) return
    let alive = true
    api
      .permissionRows()
      .then((r) => alive && setRows(r))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [api, ready])

  const who = (perms: Perm[]) => (rows ? ROLES.filter((role) => role !== 'admin' && perms.some((p) => allows(rows, role, p))) : [])
  const open = (to: MapTarget) => (onGo && canGo(to) ? () => onGo(to) : undefined)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <header>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">ผังระบบงานคลัง</div>
          <h2 className="text-xl font-bold text-slate-800">ของเข้า → เก็บ → ออก ด้วยข้อมูลชุดเดียวกัน</h2>
          <p className="text-sm text-slate-600">
            ทุกหน้าจอทั้งมือถือและคอมอ่าน / บันทึกที่ฐานข้อมูลกลางที่เดียว · เอกสารทุกใบผูกกันด้วยเลขที่ระบบออก จึงตามรอยได้ทั้งสาย · แตะการ์ดเพื่อเปิดหน้าจอนั้น
          </p>
        </header>
        <Hub compact={compact} />
      </Card>

      <Card title="ขั้นตอนหลัก 9 ขั้น" eyebrow="ตามลำดับที่ของเดินจริง · ตัวเลขสดดูได้ที่ งานวันนี้">
        <div className={`grid gap-3 ${compact ? '' : 'xl:grid-cols-3'}`}>
          {GROUPS.map((g, gi) => (
            <section key={g.title} className="relative flex min-w-0 flex-col gap-2 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
              <h3 className="flex items-center gap-2 px-1 text-sm font-bold text-slate-700">
                <span className={`grid h-6 w-6 place-items-center rounded-full text-xs text-white ${g.tone}`}>{gi + 1}</span>
                {g.title}
              </h3>
              {g.steps.map((s, i) => (
                <Fragment key={s.n}>
                  {i > 0 && (
                    <span aria-hidden className="-my-1.5 self-center text-slate-300">
                      ↓
                    </span>
                  )}
                  <Tile
                    onClick={open(s.go)}
                    badge={<span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold text-white ${g.tone}`}>{s.n}</span>}
                    title={s.title}
                  >
                    <span className="font-mono text-[12px] text-slate-700">{s.doc}</span>
                    <span className="text-xs leading-snug text-slate-600">{s.what}</span>
                    <Meta device={s.device} roles={rows ? who(s.perms) : null} />
                  </Tile>
                </Fragment>
              ))}
              {gi < GROUPS.length - 1 && (
                <span aria-hidden className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 text-xl font-bold text-slate-300 xl:block">
                  →
                </span>
              )}
            </section>
          ))}
        </div>
      </Card>

      <div className={`grid gap-4 ${compact ? '' : 'lg:grid-cols-2'}`}>
        <Card title="งานควบคุมที่วิ่งคู่กัน" eyebrow="ให้ยอดตรง เอกสารครบ">
          <div className="grid gap-2">
            {CONTROLS.map((c) => (
              <Tile key={c.title} onClick={open(c.go)} title={c.title}>
                <span className="text-xs leading-snug text-slate-600">{c.what}</span>
                <Meta device={c.device} roles={rows && c.perms.length ? who(c.perms) : null} />
              </Tile>
            ))}
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          <Card title="ดูภาพรวม" eyebrow="หัวหน้างาน · ผู้บริหาร">
            <div className="grid gap-2 sm:grid-cols-2">
              {VIEWS.map((v) => (
                <Tile key={v.title} onClick={open(v.go)} title={v.title}>
                  <span className="text-xs leading-snug text-slate-600">{v.what}</span>
                  <Meta device={v.device} roles={null} />
                </Tile>
              ))}
            </div>
          </Card>
          <Card title="ตั้งค่าระบบ" eyebrow="ผู้ดูแลระบบ · ผู้จัดการ">
            <div className="grid gap-2">
              {SETUP.map((v) => (
                <Tile key={v.title} onClick={open(v.go)} title={v.title}>
                  <span className="text-xs leading-snug text-slate-600">{v.what}</span>
                  <Meta device={['desk']} roles={null} />
                </Tile>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card title="ใครทำอะไร" eyebrow="จากตารางสิทธิ์ที่ใช้อยู่จริง (แก้ได้ที่หลังบ้าน) · ผู้ดูแลระบบทำได้ทุกอย่าง">
        {failed ? (
          <p className="text-sm text-slate-500">โหลดตารางสิทธิ์ไม่ได้</p>
        ) : !rows ? (
          <p className="text-sm text-slate-500">กำลังโหลด…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white px-2 py-1.5 text-left text-xs font-semibold text-slate-500">บทบาท</th>
                  {DUTIES.map((d) => (
                    <th key={d.label} className="px-1.5 py-1.5 text-center text-[11px] font-semibold leading-tight text-slate-500">
                      {d.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROLES.map((role) => (
                  <tr key={role} className="odd:bg-slate-50">
                    <th className="sticky left-0 z-10 whitespace-nowrap bg-inherit px-2 py-1.5 text-left font-semibold text-slate-700">{ROLE_LABEL[role]}</th>
                    {DUTIES.map((d) => {
                      const n = d.perms.filter((p) => allows(rows, role, p)).length
                      return (
                        <td key={d.label} className="px-1.5 py-1.5 text-center">
                          {n === d.perms.length ? (
                            <span className="font-bold text-emerald-600" aria-label="ทำได้">
                              ✓
                            </span>
                          ) : n ? (
                            <span className="font-bold text-amber-600" aria-label="ทำได้บางส่วน" title={d.perms.filter((p) => allows(rows, role, p)).join(', ')}>
                              ◐
                            </span>
                          ) : (
                            <span className="text-slate-300" aria-label="ทำไม่ได้">
                              ·
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function Tile({ title, badge, children, onClick }: { title: string; badge?: ReactNode; children: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-sm font-bold text-slate-800">
        {badge}
        <span className="min-w-0 flex-1">{title}</span>
        {onClick && <span className="shrink-0 text-xs font-semibold text-sky-700">เปิด →</span>}
      </span>
      {children}
    </>
  )
  const cls = 'flex w-full flex-col gap-1 rounded-lg bg-white p-3 text-left ring-1 ring-slate-200'
  return onClick ? (
    <button type="button" className={`${cls} transition hover:shadow-md hover:ring-sky-300`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

function Meta({ device, roles }: { device: Device[]; roles: Role[] | null }) {
  return (
    <span className="flex flex-wrap items-center gap-1 pt-0.5">
      {device.map((d) => (
        <span key={d} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
          {DEVICE[d]}
        </span>
      ))}
      {roles &&
        (roles.length ? (
          roles.map((r) => (
            <Pill key={r} tone="info">
              {ROLE_LABEL[r]}
            </Pill>
          ))
        ) : (
          <Pill tone="muted">ผู้ดูแลระบบ</Pill>
        ))}
    </span>
  )
}

/** ทุกส่วนต่อกับฐานข้อมูลกลางที่เดียว (ภาพสำหรับนำเสนอ) */
const SPOKES: { title: string; sub: string }[] = [
  { title: '📱 มือถือหน้างาน', sub: 'ตรวจรับ สแกน จัดเก็บ เบิก นับ' },
  { title: '🖥 คอมธุรการ / หัวหน้า', sub: 'GRN Invoice FM-P-005 ปิดยอด อนุมัติ' },
  { title: '🗺 ผังคลัง 2D / 3D', sub: 'ตำแหน่งกล่องทุกช่อง สด' },
  { title: '📊 ภาพรวมผู้บริหาร', sub: 'สต็อก วันใช้ได้ คุณภาพ' },
  { title: '🤖 AI อ่านเอกสาร', sub: 'Packing List / Invoice จากรูป' },
  { title: '🖨 จุดพิมพ์ป้าย', sub: 'ป้าย QR กล่อง / ช่อง / เอกสาร' },
]

function Hub({ compact }: { compact: boolean }) {
  if (compact)
    return (
      <div className="flex flex-col gap-2">
        <div className="rounded-xl bg-sky-700 p-3 text-center text-white">
          <div className="font-bold">ฐานข้อมูลกลาง</div>
          <div className="text-xs opacity-80">ข้อมูลชุดเดียว ทุกเครื่องเห็นตรงกัน</div>
        </div>
        <ul className="grid grid-cols-2 gap-2">
          {SPOKES.map((s) => (
            <li key={s.title} className="rounded-lg bg-slate-50 p-2 ring-1 ring-slate-200">
              <div className="text-xs font-bold text-slate-800">{s.title}</div>
              <div className="text-[11px] leading-snug text-slate-500">{s.sub}</div>
            </li>
          ))}
        </ul>
      </div>
    )
  // วางรอบวงรี: บน ขวาบน ขวาล่าง ล่าง ซ้ายล่าง ซ้ายบน
  const pos = [
    [400, 48],
    [655, 112],
    [655, 248],
    [400, 312],
    [145, 248],
    [145, 112],
  ]
  return (
    <svg viewBox="0 0 800 360" className="mx-auto w-full max-w-4xl" role="img" aria-label="ทุกส่วนของระบบเชื่อมกับฐานข้อมูลกลาง">
      {pos.map(([x, y], i) => (
        <line key={i} x1={400} y1={180} x2={x} y2={y} stroke="#cbd5e1" strokeWidth={2} strokeDasharray="6 5" />
      ))}
      <ellipse cx={400} cy={180} rx={118} ry={52} fill="#0369a1" />
      <text x={400} y={176} textAnchor="middle" fill="#fff" fontSize={18} fontWeight={700}>
        ฐานข้อมูลกลาง
      </text>
      <text x={400} y={198} textAnchor="middle" fill="#e0f2fe" fontSize={12}>
        ข้อมูลชุดเดียว ทุกเครื่องเห็นตรงกัน
      </text>
      {SPOKES.map((s, i) => {
        const [x, y] = pos[i]
        return (
          <g key={s.title}>
            <rect x={x - 118} y={y - 26} width={236} height={52} rx={12} fill="#fff" stroke="#cbd5e1" strokeWidth={1.5} />
            <text x={x} y={y - 4} textAnchor="middle" fill="#1e293b" fontSize={14} fontWeight={700}>
              {s.title}
            </text>
            <text x={x} y={y + 15} textAnchor="middle" fill="#64748b" fontSize={11.5}>
              {s.sub}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
