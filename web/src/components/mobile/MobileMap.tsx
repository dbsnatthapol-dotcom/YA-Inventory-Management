import { useMemo, useState } from 'react'
import { BRAND } from '../../data/brand'
import { routeDirections } from '../../lib/directions'
import { floorPaint } from '../../lib/floorPlan'
import { buildingOf } from '../../lib/geometry'
import { findRoute } from '../../lib/pathfinding'
import type { FactoryLayout, Zone } from '../../types/layout'
import { fmt } from '../../wms/logic'
import type { Lpn } from '../../wms/types'
import { useWms } from '../../wms/useWms'
import { PlanCanvas } from '../layout-editor/PlanCanvas'

interface Props {
  layout: FactoryLayout
  lpns: Lpn[] | null
  /** โซนปลายทาง (จากหน้าค้นหา หรือแตะบนผัง) */
  target: string | null
  onTarget: (zoneId: string | null) => void
}

const KIND_LABEL: Partial<Record<Zone['kind'], string>> = {
  storage: 'โซนเก็บ',
  tent: 'เต็นท์',
  receiving: 'จุดรับเข้า',
  inspection: 'พื้นที่ตรวจ MI3',
  ng: 'พื้นที่กัก NG',
  assembly: 'ไลน์ประกอบ',
  utility: 'ที่ชาร์จรถยก',
  stairs: 'บันได',
  lift: 'ลิฟต์',
}
const NO_STOCK = new Map()
const NO_ISSUES = new Map()
const noop = () => {}
const short = (name: string) => name.replace('อาคาร ', '')

/** ผัง 2D ดูอย่างเดียวสำหรับมือถือ: เลือกชั้น แตะโซนดูของ และนำทางจากจุดเริ่มไปโซนนั้น */
export function MobileMap({ layout, lpns, target, onTarget }: Props) {
  const { master } = useWms()
  const floors = useMemo(
    () =>
      [...layout.floors].sort(
        (a, b) => (a.area === 'yard' ? 1 : 0) - (b.area === 'yard' ? 1 : 0) || buildingOf(a).localeCompare(buildingOf(b)) || a.elevation - b.elevation,
      ),
    [layout.floors],
  )
  const targetZone = layout.zones.find((z) => z.id === target) ?? null
  const receiving = layout.zones.find((z) => z.kind === 'receiving')
  const [fromId, setFromId] = useState<string | null>(null)
  const from = layout.zones.find((z) => z.id === fromId) ?? receiving ?? null
  const [pickedFloor, setPickedFloor] = useState<string | null>(null)
  // ปลายทางเปลี่ยน ⇒ เปิดชั้นของปลายทาง (จนกว่าผู้ใช้จะเลือกชั้นเอง)
  const [lastTarget, setLastTarget] = useState(target)
  if (lastTarget !== target) {
    setLastTarget(target)
    setPickedFloor(null)
  }
  const floor = floors.find((f) => f.id === (pickedFloor ?? targetZone?.floorId)) ?? floors[0]

  const directions = useMemo(() => {
    if (!targetZone || !from || from.id === targetZone.id) return null
    const route = findRoute(layout, from.accessNodeId, targetZone.accessNodeId)
    return route ? { route, ...routeDirections(layout, route, from, targetZone) } : null
  }, [layout, from, targetZone])

  // ของในโซนปลายทาง (จากกล่องที่ยังอยู่ในคลัง)
  const inZone = useMemo(() => {
    if (!targetZone || !lpns) return null
    const codes = new Set(master.locations.filter((l) => l.zoneId === targetZone.id).map((l) => l.code))
    codes.add(targetZone.code)
    const here = lpns.filter((l) => codes.has(l.locationCode))
    return { boxes: here.length, qty: here.reduce((s, l) => s + l.items.reduce((t, i) => t + i.qty, 0), 0) }
  }, [targetZone, lpns, master.locations])

  const zones = layout.zones.filter((z) => z.floorId === floor.id)
  const nodes = layout.nodes.filter((n) => n.floorId === floor.id)
  const access = (z: Zone | null) => (z ? layout.nodes.find((n) => n.id === z.accessNodeId) : undefined)
  const marks = [
    ...(from && from.floorId === floor.id && access(from) ? [{ x: access(from)!.x, z: access(from)!.z, color: '#16a34a', label: 'A' }] : []),
    ...(targetZone && targetZone.floorId === floor.id && access(targetZone) ? [{ x: access(targetZone)!.x, z: access(targetZone)!.z, color: '#dc2626', label: 'B' }] : []),
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2" role="tablist" aria-label="ชั้น">
        {floors.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={f.id === floor.id}
            onClick={() => setPickedFloor(f.id)}
            className={`min-h-[40px] shrink-0 rounded-full px-3.5 text-sm font-semibold ring-1 ${f.id === floor.id ? 'text-white ring-transparent' : 'bg-white text-slate-600 ring-slate-200'}`}
            style={f.id === floor.id ? { background: BRAND.primary } : undefined}
          >
            {short(f.name)}
            {targetZone?.floorId === f.id && ' 📍'}
          </button>
        ))}
      </div>

      <div className="relative min-h-0 flex-1">
        <PlanCanvas
          key={floor.id}
          floor={floor}
          paint={floorPaint(layout, floor)}
          zones={zones}
          nodes={nodes}
          selectedId={targetZone?.floorId === floor.id ? targetZone.id : null}
          onSelect={(id) => id && onTarget(id)}
          onCommit={noop}
          issues={NO_ISSUES}
          stock={NO_STOCK}
          showAisles
          isEditable={() => false}
          route={directions?.paths.get(floor.id)}
          marks={marks}
        />
        {!targetZone && (
          <p className="pointer-events-none absolute inset-x-3 top-3 rounded-lg bg-white/90 px-3 py-2 text-center text-sm text-slate-600 shadow ring-1 ring-slate-200">
            แตะโซนบนผังเพื่อดูของและเส้นทาง · บีบ 2 นิ้วเพื่อซูม
          </p>
        )}
      </div>

      {targetZone && (
        <section className="max-h-[45%] shrink-0 overflow-y-auto border-t border-slate-200 bg-white px-3 pb-3 pt-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs text-slate-500">
                {KIND_LABEL[targetZone.kind] ?? 'โซน'} · {short(layout.floors.find((f) => f.id === targetZone.floorId)?.name ?? '')}
              </div>
              <h2 className="truncate text-lg font-bold" style={{ color: BRAND.primary }}>
                {targetZone.code} <span className="text-sm font-normal text-slate-600">{targetZone.name}</span>
              </h2>
              {inZone && (
                <div className="text-sm text-slate-600">{inZone.boxes ? `ของในโซน ${fmt(inZone.boxes)} กล่อง · ${fmt(inZone.qty)} ชิ้น` : 'ไม่มีของในโซนนี้'}</div>
              )}
            </div>
            <button className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-500 ring-1 ring-slate-200" onClick={() => onTarget(null)} aria-label="ปิด">
              ✕
            </button>
          </div>

          <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
            <span className="shrink-0 font-semibold text-emerald-700">A เริ่มจาก</span>
            <select
              className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm"
              value={from?.id ?? ''}
              onChange={(e) => setFromId(e.target.value)}
            >
              {layout.zones
                .filter((z) => z.kind !== 'stairs' && z.kind !== 'lift')
                .map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.code} · {z.name}
                  </option>
                ))}
            </select>
          </label>

          {directions ? (
            <>
              <p className="mt-2 text-sm font-semibold text-slate-800">
                ระยะเดิน ~{Math.round(directions.route.walkDistance)} ม. · ~{Math.max(1, Math.round(directions.route.timeSeconds / 60))} นาที
                {directions.route.floorChanges > 0 && ` · เปลี่ยนชั้น ${directions.route.floorChanges} ครั้ง`}
              </p>
              <ol className="mt-1 flex flex-col gap-1">
                {directions.steps.map((s, i) => (
                  <li key={i}>
                    <button
                      className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${s.floorId === floor.id ? 'bg-sky-50 text-sky-900' : 'text-slate-600'}`}
                      onClick={() => setPickedFloor(s.floorId)}
                    >
                      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-200 text-[11px] font-bold">{i + 1}</span>
                      {s.text}
                    </button>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            from?.id !== targetZone.id && <p className="mt-2 text-sm text-rose-600">ไม่พบเส้นทางเดินถึงโซนนี้</p>
          )}
        </section>
      )}
    </div>
  )
}
