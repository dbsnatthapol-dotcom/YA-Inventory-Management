import { BRAND } from '../data/brand'
import type { FactoryLayout, Zone } from '../types/layout'
import { findRoute, type RouteOptions, type RouteResult } from '../lib/pathfinding'

interface Props {
  layout: FactoryLayout
  sourceId: string
  targetId: string
  options: Required<Pick<RouteOptions, 'optimize' | 'avoid'>>
  tripsPerDay: number
  route: RouteResult | null
  onSourceChange: (id: string) => void
  onTargetChange: (id: string) => void
  onOptionsChange: (o: Props['options']) => void
  onTripsChange: (n: number) => void
}

const SOURCE_KINDS = new Set(['storage', 'receiving', 'tent'])
const fmtM = (m: number) => `${m.toFixed(0)} ม.`
const fmtTime = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} นาที ${Math.round(s % 60)} วิ` : `${Math.round(s)} วิ`)

export function RoutePanel(props: Props) {
  const { layout, sourceId, targetId, options, tripsPerDay, route } = props
  const sources = layout.zones.filter((z) => SOURCE_KINDS.has(z.kind))
  const targets = layout.zones.filter((z) => z.kind === 'assembly')
  const floorName = (z: Zone) => layout.floors.find((f) => f.id === z.floorId)?.name ?? z.floorId
  const target = layout.zones.find((z) => z.id === targetId)

  // จัดอันดับทุกจุดเก็บ → ไลน์ประกอบที่เลือก เพื่อดูว่าควรย้าย part ไปไว้ที่ไหน
  const ranking = target
    ? sources
        .map((s) => ({ zone: s, r: findRoute(layout, s.accessNodeId, target.accessNodeId, options) }))
        .filter((x): x is { zone: Zone; r: RouteResult } => x.r !== null)
        .sort((a, b) => a.r.walkDistance - b.r.walkDistance)
    : []

  return (
    <aside className="flex h-full w-full flex-col gap-4 overflow-y-auto border-l border-slate-200 bg-white p-4 text-sm text-slate-700 md:w-96">
      <section className="space-y-2">
        <h2 className="border-b-2 pb-1 text-base font-bold" style={{ color: BRAND.primary, borderColor: BRAND.primary }}>วิเคราะห์ระยะเดินส่ง Part</h2>
        <label className="block">
          <span className="text-slate-500">จาก (จุดเก็บ)</span>
          <select className="mt-1 w-full rounded border border-slate-300 bg-slate-50 p-2" value={sourceId} onChange={(e) => props.onSourceChange(e.target.value)}>
            {sources.map((z) => (
              <option key={z.id} value={z.id}>
                {floorName(z)} · {z.code} · {z.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-slate-500">ไปยัง (ไลน์ประกอบ)</span>
          <select className="mt-1 w-full rounded border border-slate-300 bg-slate-50 p-2" value={targetId} onChange={(e) => props.onTargetChange(e.target.value)}>
            {targets.map((z) => (
              <option key={z.id} value={z.id}>
                {floorName(z)} · {z.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-3">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={options.optimize === 'time'}
              onChange={() => props.onOptionsChange({ ...options, optimize: 'time' })}
            />
            เร็วที่สุด
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={options.optimize === 'distance'}
              onChange={() => props.onOptionsChange({ ...options, optimize: 'distance' })}
            />
            เดินน้อยที่สุด
          </label>
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={options.avoid.includes('lift')}
            onChange={(e) =>
              props.onOptionsChange({ ...options, avoid: e.target.checked ? ['lift'] : [] })
            }
          />
          ห้ามใช้ลิฟต์ (ใช้บันไดเท่านั้น)
        </label>
        <label className="block">
          <span className="text-slate-500">จำนวนเที่ยวต่อวัน</span>
          <input
            type="number"
            min={0}
            className="mt-1 w-full rounded border border-slate-300 bg-slate-50 p-2"
            value={tripsPerDay}
            onChange={(e) => props.onTripsChange(Math.max(0, Number(e.target.value)))}
          />
        </label>
      </section>

      <section className="grid grid-cols-2 gap-2">
        {route ? (
          <>
            <Stat label="ระยะเดิน (เที่ยวเดียว)" value={fmtM(route.walkDistance)} />
            <Stat label="เวลาโดยประมาณ" value={fmtTime(route.timeSeconds)} />
            <Stat label="ไป-กลับ / วัน" value={`${((route.walkDistance * 2 * tripsPerDay) / 1000).toFixed(2)} กม.`} />
            <Stat label="เวลา ไป-กลับ / วัน" value={fmtTime(route.timeSeconds * 2 * tripsPerDay)} />
            <Stat label="ขึ้น-ลงบันได" value={fmtM(route.stairsDistance)} />
            <Stat label="ใช้ลิฟต์" value={`${route.liftRides} ครั้ง`} />
          </>
        ) : (
          <p className="col-span-2 text-rose-600">ไม่พบเส้นทาง</p>
        )}
      </section>

      {target && (
        <section>
          <h3 className="mb-1 font-semibold" style={{ color: BRAND.primary }}>จัดอันดับจุดเก็บ → {target.name}</h3>
          <table className="w-full text-left text-xs">
            <thead className="text-slate-400">
              <tr>
                <th className="py-1">จุดเก็บ</th>
                <th>ระยะ</th>
                <th>เวลา</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map(({ zone, r }) => (
                <tr
                  key={zone.id}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${zone.id === sourceId ? 'font-semibold text-orange-600' : ''}`}
                  onClick={() => props.onSourceChange(zone.id)}
                >
                  <td className="py-1">
                    {floorName(zone)} · {zone.code}
                  </td>
                  <td>{fmtM(r.walkDistance)}</td>
                  <td>{fmtTime(r.timeSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="mt-auto text-xs text-slate-400">
        * ผังและความเร็วเดินเป็นค่าสมมติ — ปรับได้ที่ src/data/factoryLayout.ts และ src/lib/pathfinding.ts
      </p>
    </aside>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-lg font-bold" style={{ color: BRAND.primary }}>
        {value}
      </div>
    </div>
  )
}
