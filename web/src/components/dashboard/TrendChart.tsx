import { useEffect, useRef, useState } from 'react'

export interface TrendPoint {
  day: string
  received: number
  issued: number
}

interface Props {
  points: TrendPoint[]
  /** วันแรกของช่วงที่เลือก (วันก่อนหน้านี้แสดงจาง ๆ เป็นบริบท) */
  from: string
  /** สีของเบิกเข้าไลน์: รวมทุก Model = เทาเข้ม · กรอง Model = สีของ Model */
  accent: string
  accentLabel: string
}

/** รับเข้า = บริบท (เทา) · เบิกเข้าไลน์ = เรื่องหลัก (สีเน้น) */
const RECEIVED = '#94a3b8'
const GRID = '#e2e8f0'
const AXIS = '#cbd5e1'
const MUTED = '#64748b'
const LEFT = 46
const RIGHT = 10
/** 2 กราฟเล็กแกนเดียวกันตามวัน (สเกลแยก): รับเข้าเป็นล็อตใหญ่ไม่กี่วัน ส่วนเบิกเข้าไลน์ทุกวัน */
const PANELS = [
  { key: 'issued', top: 26, height: 120 },
  { key: 'received', top: 182, height: 70 },
] as const
const H = 290

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const compact = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : String(n))
const dayLabel = (day: string, o: Intl.DateTimeFormatOptions) => new Date(`${day}T00:00:00+07:00`).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', ...o })

/** แกน y ตัวเลขกลม ๆ (2–4 ช่วง) */
function niceTicks(max: number, steps: number) {
  const raw = Math.max(max, 1) / steps
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  const top = step * Math.ceil(Math.max(max, 1) / step)
  const ticks: number[] = []
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v))
  return { ticks, top }
}

/** แท่งปลายมน 4px ฐานเหลี่ยม */
function bar(x: number, y: number, w: number, h: number) {
  if (h <= 0) return ''
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`
}

/** เบิกเข้าไลน์ (บน) และรับเข้า (ล่าง) รายวัน · ชี้/โฟกัสวันเพื่อดูตัวเลขทั้งคู่ · ดูเป็นตารางได้ */
export function TrendChart({ points, from, accent, accentLabel }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const plotW = width - LEFT - RIGHT
  const band = plotW / Math.max(1, points.length)
  const barW = Math.max(4, Math.min(24, band - 8))
  const every = Math.ceil(30 / band)
  const last = points.length - 1
  const total = points.reduce((s, p) => ({ received: s.received + p.received, issued: s.issued + p.issued }), { received: 0, issued: 0 })
  const panels = PANELS.map((pn) => {
    const { ticks, top } = niceTicks(Math.max(...points.map((p) => p[pn.key])), pn.height > 100 ? 3 : 2)
    return { ...pn, ticks, y: (v: number) => pn.top + pn.height - (v / top) * pn.height }
  })
  const xBase = PANELS[1].top + PANELS[1].height
  const tip = hover !== null ? points[hover] : null
  const series = { issued: { color: accent, label: accentLabel }, received: { color: RECEIVED, label: 'รับเข้า' } }

  return (
    <div ref={wrap}>
      <div className="mb-1 flex items-center">
        <span className="text-xs text-slate-500">ชิ้นต่อวัน · สเกลของแต่ละกราฟแยกกัน</span>
        <button className="ml-auto rounded-md px-2 py-1 text-xs text-sky-700 hover:bg-sky-50" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? 'ดูเป็นกราฟ' : 'ดูเป็นตาราง'}
        </button>
      </div>

      {table ? (
        <div className="max-h-[290px] overflow-y-auto rounded-lg ring-1 ring-slate-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">วันที่</th>
                <th className="px-3 py-1.5 text-right font-medium">{accentLabel}</th>
                <th className="px-3 py-1.5 text-right font-medium">รับเข้า</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {[...points].reverse().map((p) => (
                <tr key={p.day} className={p.day < from ? 'text-slate-400' : 'text-slate-700'}>
                  <td className="px-3 py-1.5">{dayLabel(p.day, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                  <td className="px-3 py-1.5 text-right">{fmt(p.issued)}</td>
                  <td className="px-3 py-1.5 text-right">{fmt(p.received)}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold text-slate-800">
                <td className="px-3 py-1.5">รวม</td>
                <td className="px-3 py-1.5 text-right">{fmt(total.issued)}</td>
                <td className="px-3 py-1.5 text-right">{fmt(total.received)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative" onPointerLeave={() => setHover(null)}>
          <svg width={width} height={H} role="img" aria-label={`${accentLabel} ${fmt(total.issued)} ชิ้น รับเข้า ${fmt(total.received)} ชิ้น ใน ${points.length} วัน`} className="block">
            {panels.map((pn) => (
              <g key={pn.key}>
                {/* ชื่อกราฟ (ชุดเดียวต่อกราฟ ไม่ต้องมีกล่องคำอธิบายสี) */}
                <rect x={LEFT} y={pn.top - 17} width={8} height={8} rx={2} fill={series[pn.key].color} />
                <text x={LEFT + 13} y={pn.top - 9} fontSize={12} fontWeight={600} fill="#334155">
                  {series[pn.key].label}
                </text>
                {pn.ticks.map((t) => (
                  <g key={t}>
                    <line x1={LEFT} x2={width - RIGHT} y1={pn.y(t)} y2={pn.y(t)} stroke={t === 0 ? AXIS : GRID} strokeWidth={1} />
                    <text x={LEFT - 8} y={pn.y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={MUTED} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {compact(t)}
                    </text>
                  </g>
                ))}
              </g>
            ))}
            {points.map((p, i) => {
              const cx = LEFT + band * (i + 0.5)
              return (
                <g
                  key={p.day}
                  tabIndex={0}
                  role="img"
                  aria-label={`${dayLabel(p.day, { weekday: 'long', day: 'numeric', month: 'long' })} ${accentLabel} ${fmt(p.issued)} รับเข้า ${fmt(p.received)} ชิ้น`}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  style={{ outline: 'none' }}
                >
                  {/* พื้นที่ชี้ทั้งช่องของวัน ครอบทั้ง 2 กราฟ */}
                  <rect x={LEFT + band * i} y={PANELS[0].top - 4} width={band} height={xBase - PANELS[0].top + 4} fill={hover === i ? '#f1f5f9' : 'transparent'} />
                  <g opacity={p.day < from ? 0.4 : 1}>
                    {panels.map((pn) => (
                      <path key={pn.key} d={bar(cx - barW / 2, pn.y(p[pn.key]), barW, pn.top + pn.height - pn.y(p[pn.key]))} fill={series[pn.key].color} />
                    ))}
                  </g>
                  {/* ตัวเลขเฉพาะวันล่าสุด */}
                  {i === last &&
                    panels.map(
                      (pn) =>
                        p[pn.key] > 0 && (
                          <text key={pn.key} x={cx} y={pn.y(p[pn.key]) - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill="#0f172a">
                            {compact(p[pn.key])}
                          </text>
                        ),
                    )}
                  {(i % every === 0 || i === last) && (
                    <>
                      <text x={cx} y={xBase + 15} textAnchor="middle" fontSize={11} fill={i === last ? '#0f172a' : MUTED} fontWeight={i === last ? 600 : 400}>
                        {dayLabel(p.day, { day: 'numeric' })}
                      </text>
                      <text x={cx} y={xBase + 29} textAnchor="middle" fontSize={10} fill={MUTED}>
                        {dayLabel(p.day, band >= 34 ? { weekday: 'short' } : { month: 'short' })}
                      </text>
                    </>
                  )}
                </g>
              )
            })}
          </svg>
          {tip && hover !== null && (
            <div
              className="pointer-events-none absolute z-10 min-w-[10rem] rounded-lg bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200"
              style={{ left: Math.min(Math.max(LEFT + band * (hover + 0.5) + band / 2 + 4, 0), width - 170), top: PANELS[0].top }}
            >
              <div className="mb-1 font-medium text-slate-500">{dayLabel(tip.day, { weekday: 'short', day: 'numeric', month: 'short' })}</div>
              {(['issued', 'received'] as const).map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <i className="h-0.5 w-3 rounded-full" style={{ background: series[k].color }} />
                  <b className="tabular-nums text-slate-900">{fmt(tip[k])}</b>
                  <span className="text-slate-500">{series[k].label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
