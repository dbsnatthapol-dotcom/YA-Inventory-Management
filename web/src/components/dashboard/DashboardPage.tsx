import { useMemo, useState, type ReactNode } from 'react'
import { BRAND } from '../../data/brand'
import { modelColor } from '../../data/modelColors'
import type { FactoryLayout } from '../../types/layout'
import {
  AVG_WINDOW,
  buildDashboard,
  LOW_DAYS,
  PERIOD_LABEL,
  WATCH_DAYS,
  type AreaFloor,
  type DashAction,
  type DashAlert,
  type DashPeriod,
  type ModelRow,
} from '../../wms/dashboard'
import { ACCURACY_TARGET } from '../../wms/cycleCount'
import { fmt as fmtN } from '../../wms/logic'
import type { Lpn, MasterData } from '../../wms/types'
import { useDashboard, type DashSource } from '../../wms/useDashboard'
import { useWms } from '../../wms/useWms'
import { Alert } from '../wms/ui'
import { TrendChart } from './TrendChart'

export type PlanTarget = Extract<DashAction, { kind: 'plan' }>

interface Props {
  layout: FactoryLayout
  /** กล่องในคลัง (ชุดเดียวกับผัง) · null = กำลังโหลด */
  lpns: Lpn[] | null
  /** เปิดผังคลัง 2D ที่โซน/ชั้น พร้อมไฮไลต์กล่อง */
  onPlan: (t: PlanTarget) => void
  /** ไปแท็บที่ต้องจัดการในงานคลัง */
  onWms: (tab: 'count' | 'ledger') => void
}

/** สถานะ (สีสถานะใช้คู่กับไอคอน + ข้อความเสมอ) */
const LEVEL: Record<DashAlert['level'] | 'good', { color: string; ink: string; icon: string; label: string }> = {
  critical: { color: '#d03b3b', ink: '#ffffff', icon: '!', label: 'ด่วน' },
  warning: { color: '#fab219', ink: '#3b2a00', icon: '!', label: 'เฝ้าดู' },
  info: { color: '#64748b', ink: '#ffffff', icon: 'i', label: 'แจ้ง' },
  good: { color: '#0ca30c', ink: '#ffffff', icon: '✓', label: 'ปกติ' },
}
const ALL_ACCENT = '#334155'
const fmt = (n: number) => fmtN(Math.round(n))
const days = (n: number) => (n >= 30 ? '30+' : n < 10 ? n.toFixed(1).replace(/\.0$/, '') : String(Math.round(n)))
const pct = (used: number, total: number) => (total ? Math.round((used / total) * 100) : 0)

function LevelIcon({ level }: { level: keyof typeof LEVEL }) {
  const l = LEVEL[level]
  return (
    <i className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold not-italic" style={{ background: l.color, color: l.ink }} aria-hidden>
      {l.icon}
    </i>
  )
}

function Card({ title, sub, action, className = '', children }: { title: string; sub?: ReactNode; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`min-w-0 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-800">{title}</h2>
          {sub && <p className="text-xs text-slate-500">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/** ความเต็ม: ปกติ = น้ำเงิน · ≥ 75% = เหลือง · ≥ 90% = แดง (มีตัวเลข % กำกับเสมอ) */
function Meter({ used, total }: { used: number; total: number }) {
  const p = total ? used / total : 0
  const [fill, track] = p >= 0.9 ? ['#d03b3b', '#f6d5d5'] : p >= 0.75 ? ['#fab219', '#fdecc4'] : [BRAND.primary, '#cde2fb']
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: track }} aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, p * 100)}%`, background: fill }} />
    </div>
  )
}

function Tile({
  label,
  value,
  unit,
  sub,
  meter,
  onClick,
  link = 'ดูบนผังคลัง →',
}: {
  label: string
  value: string
  unit?: string
  sub?: ReactNode
  meter?: ReactNode
  onClick?: () => void
  link?: string
}) {
  const body = (
    <>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-semibold text-slate-900">{value}</span>
        {unit && <span className="text-sm text-slate-500">{unit}</span>}
      </div>
      {meter && <div className="mt-1.5">{meter}</div>}
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
      {onClick && <div className="mt-1 text-xs font-semibold text-sky-700">{link}</div>}
    </>
  )
  const cls = 'rounded-xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200'
  return onClick ? (
    <button className={`${cls} transition hover:ring-sky-300 focus-visible:ring-2 focus-visible:ring-sky-500`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/** สถานะเทียบเป้า: ไอคอน + ข้อความเสมอ (ไม่ใช้สีอย่างเดียว) */
function AccuracyNote({ lines, matched, pct }: { lines: number; matched: number; pct: number | null }) {
  if (pct === null) return <>ยังไม่มีการนับวน · เป้า ≥ {ACCURACY_TARGET}%</>
  const ok = pct >= ACCURACY_TARGET
  return (
    <>
      <span className={`font-semibold ${ok ? 'text-emerald-700' : 'text-amber-700'}`}>{ok ? `✓ ตามเป้า ${ACCURACY_TARGET}%` : `▲ ต่ำกว่าเป้า ${ACCURACY_TARGET}%`}</span>
      <span className="block">
        นับ {fmt(lines)} รายการ · ไม่ตรง {fmt(lines - matched)}
      </span>
    </>
  )
}

function Cover({ r }: { r: ModelRow }) {
  if (r.cover === null) return <span className="text-slate-400" title={`ไม่มีการเบิกเข้าไลน์ใน ${AVG_WINDOW} วัน`}>–</span>
  const level = r.cover < LOW_DAYS ? 'critical' : r.cover < WATCH_DAYS ? 'warning' : 'good'
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={`${LEVEL[level].label}: part ที่จะหมดก่อน ${r.coverPart}`}>
      <LevelIcon level={level} />
      <b className="text-slate-800">{days(r.cover)} วัน</b>
      <span className="font-mono text-[11px] text-slate-500">{r.coverPart}</span>
    </span>
  )
}

const build = (src: DashSource | null, lpns: Lpn[] | null, period: DashPeriod, layout: FactoryLayout, master: MasterData, model: string | null) =>
  src && lpns
    ? buildDashboard({ today: src.today, period, model, layout, master, lpns, reqs: src.reqs, activity: src.activity, pending: src.pending, closings: src.closings })
    : null

const ACTION_LABEL = (a: DashAction) => (a.kind === 'plan' ? 'ดูบนผัง →' : a.tab === 'count' ? 'ไปตรวจนับ & อนุมัติ →' : 'ไปบัญชีคุม →')

/**
 * ภาพรวมคลังสำหรับผู้บริหาร: ตัวเลขหลัก · ตาม Model (พอใช้กี่วัน) · รายการเตือน · รับเข้า vs เบิกออก · คุณภาพ MI3/NG · ความเต็มตามพื้นที่
 * ทุกส่วนกรองตามช่วงเวลาและ Model เดียวกัน · กดแล้วพาไปผังคลัง 2D (ไฮไลต์กล่อง) หรือแท็บที่ต้องจัดการ
 */
export function DashboardPage({ layout, lpns, onPlan, onWms }: Props) {
  const { master } = useWms()
  const dash = useDashboard(true)
  const [period, setPeriod] = useState<DashPeriod>('today')
  const [model, setModel] = useState<string | null>(null)
  const [allAlerts, setAllAlerts] = useState(false)

  // ชิป Model มาจากภาพรวมทุก Model (กรองแล้วชิปไม่หาย)
  const base = useMemo(() => build(dash.source, lpns, period, layout, master, null), [dash.source, lpns, period, layout, master])
  const data = useMemo(() => (model ? build(dash.source, lpns, period, layout, master, model) : base), [base, model, dash.source, lpns, period, layout, master])

  if (dash.error && !data) return <div className="p-4"><Alert tone="bad">โหลดภาพรวมไม่สำเร็จ: {dash.error}</Alert></div>
  if (!data || !base) return <p className="py-24 text-center text-slate-500">กำลังโหลดภาพรวม…</p>

  const k = data.kpi
  const label = PERIOD_LABEL[period]
  const modelLpns = model ? (data.models[0]?.lpnNos ?? []) : []
  const act = (a: DashAction) => (a.kind === 'plan' ? onPlan(a) : onWms(a.tab))
  const avg = data.models.reduce((s, r) => s + r.avgDaily, 0)
  const quality = data.models.filter((r) => r.holdBoxes || r.qiChecked || r.ngFound || r.ngWaitQty || r.ngReturned)
  const shownAlerts = allAlerts ? data.alerts : data.alerts.slice(0, 7)
  const updated = new Date(dash.source!.at).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="h-full overflow-y-auto bg-slate-100">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <h1 className="text-xl font-bold" style={{ color: BRAND.primary }}>
              ภาพรวมคลัง
            </h1>
            <p className="text-xs text-slate-500">
              อัปเดต {updated} น. · ดึงใหม่ทุก 1 นาที{dash.error && <span className="text-rose-600"> · ดึงล่าสุดไม่สำเร็จ: {dash.error}</span>}
            </p>
          </div>
          <button className="ml-auto rounded-lg bg-white px-3 py-1.5 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60" onClick={dash.refresh} disabled={dash.loading}>
            {dash.loading ? 'กำลังอัปเดต…' : '↻ อัปเดต'}
          </button>
        </div>

        {/* ตัวกรองแถวเดียว: ช่วงเวลา แล้ว Model · ทุกส่วนด้านล่างใช้ชุดเดียวกัน */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-white p-0.5 text-sm ring-1 ring-slate-200" role="radiogroup" aria-label="ช่วงเวลา">
            {(['today', '7d', 'month'] as const).map((p) => (
              <button
                key={p}
                role="radio"
                aria-checked={period === p}
                onClick={() => setPeriod(p)}
                className={`rounded-md px-3 py-1 transition ${period === p ? 'font-semibold text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                style={period === p ? { background: BRAND.primary } : undefined}
              >
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
          <span className="mx-1 h-5 w-px bg-slate-300" />
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Model">
            {[null, ...base.models.map((r) => r.model)].map((m) => (
              <button
                key={m ?? 'all'}
                role="radio"
                aria-checked={model === m}
                onClick={() => setModel(m)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm ring-1 transition ${model === m ? 'bg-slate-800 text-white ring-slate-800' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}
              >
                {m && <i className="h-2.5 w-2.5 rounded-full ring-1 ring-white" style={{ background: modelColor(m) }} />}
                {m ?? 'ทุก Model'}
              </button>
            ))}
          </div>
        </div>

        <div className={`flex flex-col gap-4 transition-opacity ${dash.loading ? 'opacity-70' : ''}`}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Tile
              label={model ? `ของดีคงคลัง ${model}` : 'ของดีคงคลัง'}
              value={fmt(k.onHand)}
              unit="ชิ้น"
              sub={`${fmt(k.boxes)} กล่อง พร้อมเบิก`}
              onClick={model && modelLpns.length ? () => onPlan({ kind: 'plan', zoneId: data.models[0]?.topZone ?? null, lpnNos: modelLpns }) : undefined}
            />
            <Tile
              label={`ความแม่นยำสต็อก ${label}`}
              value={k.accuracy.pct === null ? '–' : `${k.accuracy.pct}%`}
              sub={<AccuracyNote lines={k.accuracy.lines} matched={k.accuracy.matched} pct={k.accuracy.pct} />}
              onClick={() => onWms('count')}
              link="ดูการตรวจนับ →"
            />
            <Tile
              label={model ? `ช่องที่มี ${model}` : 'ช่องเก็บที่ใช้'}
              value={`${pct(k.slotsUsed, k.slots)}%`}
              meter={<Meter used={k.slotsUsed} total={k.slots} />}
              sub={`${fmt(k.slotsUsed)} / ${fmt(k.slots)} ช่อง`}
            />
            <Tile
              label="รอตรวจ MI3"
              value={fmt(k.holdBoxes)}
              unit="กล่อง"
              sub={k.holdBoxes ? `${fmt(k.holdQty)} ชิ้น · นานสุด ${k.holdOldestDays} วัน` : 'ไม่มีของรอตรวจ'}
              onClick={data.actions.hold ? () => act(data.actions.hold!) : undefined}
            />
            <Tile
              label="NG รอส่งคืน"
              value={fmt(k.ngWaitQty)}
              unit="ชิ้น"
              sub={`พบ NG ${label} ${fmt(k.ngFound)} ชิ้น${k.qiChecked ? ` (${((k.ngFound / k.qiChecked) * 100).toFixed(1)}%)` : ''}`}
              onClick={data.actions.ng ? () => act(data.actions.ng!) : undefined}
            />
            <Tile label={`รับเข้า ${label}`} value={fmt(k.received)} unit="ชิ้น" sub={`${fmt(k.receiptDocs)} ใบรับสินค้า`} />
            <Tile label={`เบิกเข้าไลน์ ${label}`} value={fmt(k.issued)} unit="ชิ้น" sub={`เฉลี่ย ${fmt(avg)} ชิ้น/วันทำงาน (${AVG_WINDOW} วัน)`} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card
              className="xl:col-span-2"
              title="ตาม Model"
              sub={`พอใช้ = ของดีคงเหลือ ÷ ยอดเบิกเฉลี่ยต่อวันทำงาน (${AVG_WINDOW} วันล่าสุด) ของ part ที่จะหมดก่อน · แดง < ${LOW_DAYS} วัน · เหลือง < ${WATCH_DAYS} วัน`}
            >
              {data.models.length === 0 ? (
                <p className="text-sm text-slate-500">ยังไม่มีของในคลังหรือความเคลื่อนไหว</p>
              ) : (
                <div className="-mx-4 overflow-x-auto px-4">
                  <table className="w-full min-w-[46rem] text-sm">
                    <thead className="text-xs text-slate-500">
                      <tr className="border-b border-slate-200">
                        <th className="py-2 text-left font-medium">Model</th>
                        <th className="py-2 text-right font-medium">คงเหลือ</th>
                        <th className="py-2 text-right font-medium">กล่อง</th>
                        <th className="py-2 text-right font-medium">รอ MI3</th>
                        <th className="py-2 text-right font-medium">รับเข้า {label}</th>
                        <th className="py-2 text-right font-medium">เบิก {label}</th>
                        <th className="py-2 text-right font-medium">ใช้/วัน</th>
                        <th className="py-2 pl-4 text-left font-medium">พอใช้</th>
                        <th className="py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 tabular-nums">
                      {data.models.map((r) => (
                        <tr key={r.model}>
                          <td className="py-2">
                            <button
                              className="flex items-center gap-2 rounded-md px-1 py-0.5 font-semibold text-slate-800 hover:bg-slate-100"
                              onClick={() => setModel((m) => (m === r.model ? null : r.model))}
                              aria-pressed={model === r.model}
                              title={model === r.model ? 'ดูทุก Model' : `กรองเฉพาะ ${r.model}`}
                            >
                              <i className="h-2.5 w-2.5 rounded-full" style={{ background: modelColor(r.model) }} />
                              {r.model}
                            </button>
                          </td>
                          <td className="py-2 text-right font-semibold text-slate-800">{fmt(r.onHand)}</td>
                          <td className="py-2 text-right text-slate-600">{fmt(r.boxes)}</td>
                          <td className="py-2 text-right text-slate-600">{r.holdBoxes ? `${fmt(r.holdBoxes)} กล่อง` : '–'}</td>
                          <td className="py-2 text-right text-slate-600">{fmt(r.received)}</td>
                          <td className="py-2 text-right text-slate-600">{fmt(r.issued)}</td>
                          <td className="py-2 text-right text-slate-600">{r.avgDaily ? fmt(r.avgDaily) : '–'}</td>
                          <td className="py-2 pl-4">
                            <Cover r={r} />
                          </td>
                          <td className="py-2 text-right">
                            {r.lpnNos.length > 0 && (
                              <button
                                className="whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-50"
                                onClick={() => onPlan({ kind: 'plan', zoneId: r.topZone, lpnNos: r.lpnNos })}
                                title={`ไฮไลต์ทุกกล่องของ ${r.model} บนผังคลัง`}
                              >
                                ดูบนผัง →
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.workingDays < 3 && (
                <p className="mt-2 text-xs text-amber-700">ข้อมูลการเบิกยังน้อย ({data.workingDays} วันทำงาน) · ค่า "พอใช้" จะแม่นขึ้นเมื่อใช้งานต่อเนื่อง 1–2 สัปดาห์</p>
              )}
            </Card>

            <Card
              title="รายการเตือน"
              sub={data.alerts.length ? `${data.alerts.length} รายการ · เรียงจากด่วนที่สุด` : undefined}
              action={
                data.alerts.length > 7 && (
                  <button className="text-xs font-semibold text-sky-700 hover:underline" onClick={() => setAllAlerts((v) => !v)}>
                    {allAlerts ? 'ย่อ' : `ดูทั้งหมด (${data.alerts.length})`}
                  </button>
                )
              }
            >
              {data.alerts.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-slate-600">
                  <LevelIcon level="good" /> ไม่มีรายการเตือน
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {shownAlerts.map((a) => (
                    <li key={a.id} className="flex items-start gap-2.5 py-2">
                      <span className="mt-0.5">
                        <LevelIcon level={a.level} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-800">
                          <span className="sr-only">{LEVEL[a.level].label}: </span>
                          {a.title}
                        </div>
                        {a.detail && <div className="text-xs text-slate-500">{a.detail}</div>}
                      </div>
                      {a.action && (
                        <button className="shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-200 hover:bg-sky-50" onClick={() => act(a.action!)}>
                          {ACTION_LABEL(a.action)}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2" title={`เบิกเข้าไลน์ / รับเข้า รายวัน${model ? ` · ${model}` : ''}`} sub="วันก่อนช่วงที่เลือกแสดงจาง · ชี้หรือแตะที่วันเพื่อดูตัวเลข">
              <TrendChart points={data.trend} from={data.range.from} accent={model ? modelColor(model) : ALL_ACCENT} accentLabel="เบิกเข้าไลน์" />
            </Card>
            <Card title="คุณภาพ MI3 / NG" sub={`ตรวจแล้วและ NG ที่พบ: ${label} · รอตรวจและ NG รอส่งคืน: ตอนนี้`}>
              {quality.length === 0 ? (
                <p className="text-sm text-slate-500">ไม่มีของรอตรวจหรือ NG</p>
              ) : (
                <div className="-mx-4 overflow-x-auto px-4">
                  <table className="w-full text-sm tabular-nums">
                    <thead className="text-xs text-slate-500">
                      <tr className="border-b border-slate-200">
                        <th className="py-2 text-left font-medium">Model</th>
                        <th className="py-2 text-right font-medium">ตรวจแล้ว</th>
                        <th className="py-2 text-right font-medium">NG พบ</th>
                        <th className="py-2 text-right font-medium">รอตรวจ</th>
                        <th className="py-2 text-right font-medium">NG รอคืน</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {quality.map((r) => (
                        <tr key={r.model}>
                          <td className="py-2">
                            <span className="flex items-center gap-2 font-semibold text-slate-800">
                              <i className="h-2.5 w-2.5 rounded-full" style={{ background: modelColor(r.model) }} />
                              {r.model}
                            </span>
                          </td>
                          <td className="py-2 text-right text-slate-600">{fmt(r.qiChecked)}</td>
                          <td className="py-2 text-right text-slate-600">
                            {fmt(r.ngFound)}
                            {r.qiChecked > 0 && <span className="block text-[11px] text-slate-400">{((r.ngFound / r.qiChecked) * 100).toFixed(1)}%</span>}
                          </td>
                          <td className="py-2 text-right text-slate-600">
                            {r.holdBoxes ? `${fmt(r.holdBoxes)} กล่อง` : '–'}
                            {r.holdOldestDays !== null && <span className="block text-[11px] text-slate-400">นานสุด {r.holdOldestDays} วัน</span>}
                          </td>
                          <td className="py-2 text-right text-slate-600">{r.ngWaitQty ? fmt(r.ngWaitQty) : '–'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <Card
            title="ตามพื้นที่"
            sub={`อาคาร → ชั้น → โซน · ความเต็มคิดจากช่องเก็บตามผัง${model ? ` · ชิ้นของ ${model} ในแต่ละโซน` : ''} · กดชั้นหรือโซนเพื่อเปิดผังคลัง 2D`}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              {data.floors.map((f) => (
                <FloorCard key={f.floorId} floor={f} model={model} onFloor={() => onPlan({ kind: 'plan', zoneId: null, floorId: f.floorId, lpnNos: modelLpns })} onZone={(zoneId) => onPlan({ kind: 'plan', zoneId, lpnNos: modelLpns })} />
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function FloorCard({ floor, model, onFloor, onZone }: { floor: AreaFloor; model: string | null; onFloor: () => void; onZone: (zoneId: string) => void }) {
  return (
    <div className="rounded-lg ring-1 ring-slate-200">
      <button className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 rounded-t-lg bg-slate-50 px-3 py-2 text-left hover:bg-sky-50" onClick={onFloor} title="เปิดชั้นนี้ในผังคลัง 2D">
        <span className="font-semibold text-slate-800">{floor.name}</span>
        <span className="text-xs text-slate-500">
          {floor.slots ? `ใช้ ${pct(floor.used, floor.slots)}% (${fmt(floor.used)}/${fmt(floor.slots)} ช่อง) · ` : ''}
          {fmt(floor.boxes)} กล่อง · {fmt(model ? floor.modelQty : floor.qty)} ชิ้น{model ? ` ${model}` : ''}
        </span>
        <span className="ml-auto text-xs font-semibold text-sky-700">ผัง →</span>
      </button>
      <table className="w-full text-sm tabular-nums">
        <thead className="text-[11px] text-slate-500">
          <tr className="border-b border-slate-100">
            <th className="px-3 py-1.5 text-left font-medium">โซน</th>
            <th className="w-[30%] px-2 py-1.5 text-left font-medium">ช่องที่ใช้</th>
            <th className="px-2 py-1.5 text-right font-medium">กล่อง</th>
            <th className="px-2 py-1.5 text-right font-medium">ชิ้น{model ? ` ${model}` : ''}</th>
            <th className="px-3 py-1.5 text-right font-medium">เก่าสุด</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {floor.zones.map((z) => (
            <tr key={z.zoneId} className={`cursor-pointer hover:bg-sky-50 ${model && !z.modelQty ? 'text-slate-400' : 'text-slate-700'}`} onClick={() => onZone(z.zoneId)}>
              <td className="px-3 py-1.5">
                <button
                  className="text-left"
                  onClick={(e) => {
                    e.stopPropagation()
                    onZone(z.zoneId)
                  }}
                  title={`เปิด ${z.code} ในผังคลัง 2D`}
                >
                  <span className="font-semibold">{z.code}</span> <span className="text-xs text-slate-500">{z.name}</span>
                </button>
              </td>
              <td className="px-2 py-1.5">
                {z.slots ? (
                  <div className="flex items-center gap-2">
                    <div className="min-w-[3rem] flex-1">
                      <Meter used={z.used} total={z.slots} />
                    </div>
                    <span className="w-9 text-right text-xs">{pct(z.used, z.slots)}%</span>
                  </div>
                ) : (
                  <span className="text-xs text-slate-400">พื้นที่{z.holdBoxes ? ` · รอ MI3 ${z.holdBoxes}` : ''}</span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right">{fmt(z.boxes)}</td>
              <td className="px-2 py-1.5 text-right">{fmt(model ? z.modelQty : z.qty)}</td>
              <td className={`px-3 py-1.5 text-right ${z.oldestDays !== null && z.oldestDays > 30 ? 'font-semibold text-amber-700' : ''}`}>{z.oldestDays === null ? '–' : `${z.oldestDays} วัน`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
