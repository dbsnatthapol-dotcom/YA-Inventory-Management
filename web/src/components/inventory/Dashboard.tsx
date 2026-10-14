import { useEffect, useState } from 'react'
import { BRAND } from '../../data/brand'
import { BUCKET_LABEL } from '../../inventory/ledger'
import { bangkokDate, dashboardSummary, movementLog, type MovementRow } from '../../inventory/reports'
import type { InventoryApi } from '../../inventory/useInventory'
import { fmt, fmtTime, inputBase } from './format'
import { Chip, Panel } from './ui'

// สีกราฟ 2 ชุด (ผ่านการตรวจสีสำหรับผู้มีภาวะตาบอดสีแล้ว): รับเข้า = น้ำเงิน, เบิก = ส้ม
const SERIES = { received: '#2a78d6', issued: '#eb6834' } as const

interface Props {
  api: InventoryApi
  onTrace: (lotId: string) => void
  onOpenMovements: () => void
}

/** นาฬิกาที่เดินทุก 30 วินาที เพื่ออัปเดต "เมื่อ x นาทีที่แล้ว" */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

const relative = (iso: string, now: number) => {
  const min = Math.round((now - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'เมื่อสักครู่'
  if (min < 60) return `${min} นาทีที่แล้ว`
  return `${Math.floor(min / 60)} ชม. ${min % 60} นาทีที่แล้ว`
}

export function Dashboard({ api, onTrace, onOpenMovements }: Props) {
  const now = useNow()
  const [date, setDate] = useState(bangkokDate())
  const d = dashboardSummary(api.state, date)
  const feed = movementLog(api.state, { from: date, to: date }).slice(0, 12)
  const isToday = date === bangkokDate(new Date(now).toISOString())
  const lastAt = feed[0]?.movement.at

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold" style={{ color: BRAND.primary }}>
          ภาพรวมคลัง W/H ASSY
        </h2>
        {isToday && (
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:hidden" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            LIVE
          </span>
        )}
        <span className="text-xs text-slate-500">{lastAt ? `รายการล่าสุด ${relative(lastAt, now)}` : 'ยังไม่มีรายการในวันนี้'}</span>
        <label className="ml-auto flex items-center gap-1 whitespace-nowrap text-xs text-slate-600">
          วันที่
          <input id="dash-date" type="date" className={inputBase} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="รับเข้า BOI" value={fmt(d.receivedQty)} unit="ชิ้น" sub={`${d.receipts} invoice · ตาม invoice ${fmt(d.invoiceQty)}`} />
        <Kpi label="MRA เบิก" value={fmt(d.issuedQty)} unit="ชิ้น" sub="เข้าไลน์ประกอบ" />
        <Kpi label="รอตรวจ / ตรวจ MI3" value={fmt(d.pendingQcQty + d.inMi3Qty)} unit="ชิ้น" sub={`รอส่ง ${fmt(d.pendingQcQty)} · กำลังตรวจ ${fmt(d.inMi3Qty)}`} tone={d.pendingQcQty + d.inMi3Qty ? 'warn' : undefined} />
        <Kpi label="NG ที่พบวันนี้" value={fmt(d.ngFoundQty)} unit="ชิ้น" sub={`ส่งคืนแล้ว ${fmt(d.returnedQty)}`} tone={d.ngFoundQty ? 'bad' : undefined} />
        <Kpi label="ขาด / เสียหายตอนรับ" value={fmt(d.shortQty + d.damagedQty)} unit="ชิ้น" sub={`ขาด ${fmt(d.shortQty)} · เสียหาย ${fmt(d.damagedQty)}`} tone={d.shortQty + d.damagedQty ? 'bad' : undefined} />
        <Kpi label="คงคลัง (BOI + MI3)" value={fmt(d.onHandQty)} unit="ชิ้น" sub={`${d.movements} รายการเคลื่อนไหววันนี้`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Panel title="รับเข้า vs เบิก รายชั่วโมง (ชิ้น)">
            <HourlyChart data={d.hourly} />
          </Panel>
        </div>
        <div className="lg:col-span-2">
          <Panel
            title="ความเคลื่อนไหวล่าสุด"
            action={
              <button className="text-xs text-sky-700 hover:underline" onClick={onOpenMovements}>
                ดูทั้งหมด →
              </button>
            }
          >
            <ActivityFeed rows={feed} now={now} onTrace={onTrace} />
          </Panel>
        </div>
      </div>

      <Panel title="สรุปแยกตาม Model">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm tabular-nums">
            <thead className="text-xs text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="py-1.5">Model</th>
                <th className="text-right">รับเข้าวันนี้</th>
                <th className="text-right">เบิกวันนี้</th>
                <th className="text-right">รอตรวจ MI3</th>
                <th className="text-right">NG คงค้าง</th>
                <th className="text-right">คงคลัง</th>
              </tr>
            </thead>
            <tbody>
              {d.byModel.map((m) => (
                <tr key={m.model} className="border-b border-slate-100">
                  <td className="py-1.5 font-semibold">{m.model}</td>
                  <td className="text-right">{fmt(m.received)}</td>
                  <td className="text-right">{fmt(m.issued)}</td>
                  <td className="text-right text-amber-700">{fmt(m.pendingQc)}</td>
                  <td className="text-right text-rose-700">{fmt(m.ng)}</td>
                  <td className="text-right font-bold" style={{ color: BRAND.primary }}>
                    {fmt(m.onHand)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function Kpi({ label, value, unit, sub, tone }: { label: string; value: string; unit: string; sub: string; tone?: 'warn' | 'bad' }) {
  const stripe = tone === 'bad' ? 'border-l-rose-500' : tone === 'warn' ? 'border-l-amber-500' : 'border-l-transparent'
  return (
    <div className={`rounded-lg border border-l-4 border-slate-200 bg-white p-3 shadow-sm ${stripe}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="text-2xl font-bold tabular-nums text-slate-900">{value}</span>
        <span className="text-xs text-slate-500">{unit}</span>
      </div>
      <div className="mt-0.5 truncate text-[11px] text-slate-500" title={sub}>
        {sub}
      </div>
    </div>
  )
}

/** กราฟแท่งคู่รายชั่วโมง: แกนเดียว, แท่งบาง, มุมบนมน, เส้นตารางจาง, hover แสดงค่า */
function HourlyChart({ data }: { data: { hour: number; received: number; issued: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  // แสดงช่วง 06–20 น. และขยายถ้ามีรายการนอกช่วง
  const active = data.filter((h) => h.received || h.issued).map((h) => h.hour)
  const from = Math.min(6, ...active)
  const to = Math.max(20, ...active)
  const hours = data.slice(from, to + 1)
  const max = Math.max(1, ...hours.flatMap((h) => [h.received, h.issued]))
  const step = 10 ** Math.floor(Math.log10(max))
  const top = Math.ceil(max / step) * step
  const W = 720
  const H = 220
  const pad = { l: 52, r: 8, t: 10, b: 24 }
  const bandW = (W - pad.l - pad.r) / hours.length
  const barW = Math.min(14, (bandW - 6) / 2)
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top)
  const hovered = hover !== null ? hours.find((h) => h.hour === hover) : null

  return (
    <div className="relative">
      <div className="mb-2 flex gap-4 text-xs text-slate-600" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SERIES.received }} /> รับเข้า BOI
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SERIES.issued }} /> MRA เบิก
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="กราฟจำนวนรับเข้าและเบิกรายชั่วโมง" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#64748b">
              {t.toLocaleString('th-TH')}
            </text>
          </g>
        ))}
        {hours.map((h, i) => {
          const x = pad.l + i * bandW
          const cx = x + bandW / 2
          return (
            <g key={h.hour} onMouseEnter={() => setHover(h.hour)}>
              {/* พื้นที่ hover กว้างทั้งช่วงชั่วโมง */}
              <rect x={x} y={pad.t} width={bandW} height={H - pad.t - pad.b} fill={hover === h.hour ? '#f1f5f9' : 'transparent'} />
              <Bar x={cx - barW - 1} w={barW} y0={y(0)} y1={y(h.received)} color={SERIES.received} />
              <Bar x={cx + 1} w={barW} y0={y(0)} y1={y(h.issued)} color={SERIES.issued} />
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={10} fill="#64748b">
                {String(h.hour).padStart(2, '0')}
              </text>
            </g>
          )
        })}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="#94a3b8" strokeWidth={1} />
      </svg>
      {hovered && (
        <div className="pointer-events-none absolute right-2 top-8 rounded-md bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200">
          <div className="font-semibold text-slate-700">
            {String(hovered.hour).padStart(2, '0')}:00–{String(hovered.hour).padStart(2, '0')}:59
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-slate-600">
            <i className="inline-block h-2 w-2 rounded-sm" style={{ background: SERIES.received }} /> รับเข้า <b className="ml-auto pl-3 tabular-nums">{fmt(hovered.received)}</b>
          </div>
          <div className="flex items-center gap-1.5 text-slate-600">
            <i className="inline-block h-2 w-2 rounded-sm" style={{ background: SERIES.issued }} /> เบิก <b className="ml-auto pl-3 tabular-nums">{fmt(hovered.issued)}</b>
          </div>
        </div>
      )}
    </div>
  )
}

function Bar({ x, w, y0, y1, color }: { x: number; w: number; y0: number; y1: number; color: string }) {
  const h = y0 - y1
  if (h <= 0) return null
  const r = Math.min(4, h, w / 2)
  // มุมบนมน 4px ส่วนฐานตรงชิดแกน
  return <path d={`M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`} fill={color} />
}

const DIRECTION = {
  in: { tone: 'info', label: 'เข้า' },
  out: { tone: 'warn', label: 'ออก' },
  internal: { tone: 'muted', label: 'ย้าย' },
} as const

function ActivityFeed({ rows, now, onTrace }: { rows: MovementRow[]; now: number; onTrace: (lotId: string) => void }) {
  if (!rows.length) return <p className="text-sm text-slate-500">ยังไม่มีความเคลื่อนไหวในวันที่เลือก</p>
  return (
    <ol className="flex flex-col divide-y divide-slate-100 text-sm">
      {rows.map((r) => {
        const ng = r.movement.to === 'NG_CUSTOMER' || r.movement.to === 'NG_SUPPLIER'
        return (
          <li key={r.movement.id} className="flex items-start gap-2 py-1.5">
            <Chip tone={ng ? 'bad' : DIRECTION[r.direction].tone}>{ng ? 'NG' : DIRECTION[r.direction].label}</Chip>
            <div className="min-w-0 flex-1">
              <div className="truncate">
                <b>{r.label}</b> <span className="tabular-nums">{fmt(r.movement.qty)}</span> · <span className="font-mono text-xs">{r.lot.partNo}</span>{' '}
                <span className="text-xs text-slate-500">({r.lot.model})</span>
              </div>
              <div className="truncate text-[11px] text-slate-500">
                {r.movement.from ? BUCKET_LABEL[r.movement.from] : 'รับจากภายนอก'} → {r.movement.to ? BUCKET_LABEL[r.movement.to] : 'ออกนอกระบบ'} ·{' '}
                {r.movement.by ?? '—'} ·{' '}
                <button className="font-mono text-sky-700 hover:underline" onClick={() => onTrace(r.lot.id)}>
                  {r.lot.id}
                </button>
              </div>
            </div>
            <span className="whitespace-nowrap text-[11px] text-slate-400" title={fmtTime(r.movement.at)}>
              {relative(r.movement.at, now)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
