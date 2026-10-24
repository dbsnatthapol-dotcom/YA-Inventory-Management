import { Fragment, useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { BRAND } from '../../data/brand'
import { modelColor } from '../../data/modelColors'
import { routeDirections } from '../../lib/directions'
import { floorPaint } from '../../lib/floorPlan'
import { fmtTime } from '../../lib/format'
import { buildingOf } from '../../lib/geometry'
import { findRoute } from '../../lib/pathfinding'
import type { FactoryLayout, Zone } from '../../types/layout'
import { pad } from '../../wms/locations'
import { fmt } from '../../wms/logic'
import { buildZoneStock } from '../../wms/mapStock'
import { buildSlotMap, findSlot, SLOT_LABEL, SLOT_STATUS, spotAt, sumCounts, type Slot, type SlotBox, type SlotStatus, type Spot, type ZoneSlots } from '../../wms/slotMap'
import type { Lpn } from '../../wms/types'
import { useWms } from '../../wms/useWms'
import { PlanCanvas } from '../layout-editor/PlanCanvas'
import { Alert } from '../wms/ui'

/** สั่งเปิดโซนจากภายนอก (ช่องค้นหา / หน้าอื่น) — ทำงานทุกครั้งที่ n เปลี่ยน */
export interface PlanFocus {
  /** โซนที่จะเปิด · null = เปิดชั้น (floorId) โดยไม่เลือกโซน */
  zoneId: string | null
  floorId?: string | null
  /** ป้ายกล่องที่จะเลือกช่องให้ (ผลค้นหาเลขป้าย) */
  lpnNo?: string | null
  /** รหัสช่องที่จะเลือก (ผลค้นหารหัสช่อง) */
  code?: string | null
  n: number
}

interface Props {
  layout: FactoryLayout
  /** กล่องในคลัง (null = กำลังโหลด) */
  lpns: Lpn[] | null
  error?: string | null
  focus?: PlanFocus | null
  /** ป้ายกล่องที่ไฮไลต์ (ผลค้นหา) */
  highlight?: ReadonlySet<string> | null
  /** เปิดกล่องในหน้าสแกน (มือถือ) · ไม่ส่ง = ลิงก์ /t/เลขป้าย */
  onOpenLpn?: (lpnNo: string) => void
  /** ดูโซนนี้ในผัง 3D (จอคอม) */
  onOpen3D?: (zoneId: string) => void
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
const STORE_KINDS = new Set<Zone['kind']>(['storage', 'tent', 'receiving', 'inspection', 'ng'])

/** สีสถานะช่อง: ผัง (SVG) และหน้า rack (HTML) ใช้ชุดเดียวกัน */
const FILL: Record<SlotStatus, string> = { empty: '#ffffff', stock: '#2563eb', hold: '#f59e0b', blocked: 'url(#slot-blocked)' }
const CELL: Record<SlotStatus, CSSProperties> = {
  empty: { background: '#ffffff', color: '#64748b', boxShadow: 'inset 0 0 0 1px #cbd5e1' },
  stock: { background: '#2563eb', color: '#ffffff' },
  hold: { background: '#f59e0b', color: '#451a03' },
  blocked: { background: 'repeating-linear-gradient(45deg, #e2e8f0 0 4px, #94a3b8 4px 6px)', color: '#334155' },
}
/** ไฮไลต์ผลค้นหา */
const LIT = '#e11d48'
/** ซูมเข้าจนเห็นกว้างไม่เกิน ~30 ม. ⇒ แสดงเลขที่วางในช่อง */
const FINE_UNIT = 0.3

const NO_ISSUES = new Map()
const noop = () => {}
const short = (name: string) => name.replace('อาคาร ', '')
const slotTotal = (zs: ZoneSlots) => SLOT_STATUS.reduce((s, k) => s + zs.counts[k], 0)

/**
 * ผังคลัง 2D ทีละชั้น (จอคอมและมือถือใช้ชุดเดียวกัน): ทุกช่องเก็บระบายสีตามสถานะ ว่าง / มีของ / รอ MI3 / ปิดใช้
 * แตะโซนหรือช่อง → หน้า rack (ชั้น × ที่วาง) และกล่องในช่อง · แท็บเส้นทางเดินจากจุดเริ่มถึงโซน
 */
export function WarehousePlan({ layout, lpns, error, focus, highlight, onOpenLpn, onOpen3D }: Props) {
  const { master } = useWms()
  const floors = useMemo(
    () =>
      [...layout.floors].sort(
        (a, b) => (a.area === 'yard' ? 1 : 0) - (b.area === 'yard' ? 1 : 0) || buildingOf(a).localeCompare(buildingOf(b)) || a.elevation - b.elevation,
      ),
    [layout.floors],
  )
  const slotMap = useMemo(() => buildSlotMap(layout, lpns ?? [], master), [layout, lpns, master])
  const stock = useMemo(() => buildZoneStock(lpns ?? [], master, layout), [layout, lpns, master])

  const [zoneId, setZoneId] = useState<string | null>(null)
  const [slotCode, setSlotCode] = useState<string | null>(null)
  /** กล่องจากผลค้นหา: เลือกช่องของกล่องนี้ (เมื่อโหลดกล่องเสร็จ) */
  const [focusLpn, setFocusLpn] = useState<string | null>(null)
  const [pickedFloor, setPickedFloor] = useState<string | null>(null)
  const [zoom, setZoom] = useState<{ zoneId: string; n: number } | null>(null)
  const [tab, setTab] = useState<'slots' | 'route'>('slots')
  const [fromId, setFromId] = useState<string | null>(null)

  // คำสั่งเปิดโซนใหม่ ⇒ เปิดชั้นของโซน เลือกโซน/ช่อง และซูมไปที่โซน
  const [focusN, setFocusN] = useState<number | null>(null)
  if (focus && focus.n !== focusN) {
    setFocusN(focus.n)
    setZoneId(focus.zoneId)
    setSlotCode(focus.code ?? null)
    setFocusLpn(focus.lpnNo ?? null)
    setPickedFloor(focus.zoneId ? null : (focus.floorId ?? null))
    setTab('slots')
    const zoneId = focus.zoneId
    setZoom((z) => (zoneId ? { zoneId, n: (z?.n ?? 0) + 1 } : null))
  }

  const zone = layout.zones.find((z) => z.id === zoneId) ?? null
  const floor = floors.find((f) => f.id === (pickedFloor ?? zone?.floorId)) ?? floors[0]
  const zs = zone ? (slotMap.zones.get(zone.id) ?? null) : null
  const selectedCode = slotCode ?? (focusLpn ? (slotMap.where.get(focusLpn)?.code ?? null) : null)
  const selected = zs && selectedCode ? findSlot(zs, selectedCode) : null

  // ผลค้นหา: ช่อง / โซน / ชั้นที่มีกล่องที่ค้นเจอ
  const lit = useMemo(() => {
    const spots = new Set<string>()
    const loose = new Set<string>()
    const zones = new Set<string>()
    for (const lpnNo of highlight ?? []) {
      const w = slotMap.where.get(lpnNo)
      if (!w) continue
      zones.add(w.zoneId)
      if (w.spot !== null) spots.add(`${w.zoneId}:${w.spot}`)
      else loose.add(w.zoneId)
    }
    const floorIds = new Set(layout.zones.filter((z) => zones.has(z.id)).map((z) => z.floorId))
    return { spots, loose, zones, floors: floorIds, boxes: highlight ?? new Set<string>() }
  }, [highlight, slotMap, layout.zones])

  const floorZones = useMemo(() => layout.zones.filter((z) => z.floorId === floor.id), [layout.zones, floor.id])
  // ลานนอกอาคารกว้างมาก: มุมมองแรกครอบเฉพาะเต็นท์/พื้นที่เก็บของ
  const fitTo = useMemo(() => {
    const list = floor.area === 'yard' ? floorZones.filter((z) => STORE_KINDS.has(z.kind)) : []
    if (!list.length) return undefined
    const x = Math.min(...list.map((z) => z.x))
    const z = Math.min(...list.map((zz) => zz.z))
    return { x, z, width: Math.max(...list.map((zz) => zz.x + zz.width)) - x, depth: Math.max(...list.map((zz) => zz.z + zz.depth)) - z }
  }, [floor.area, floorZones])
  const selKey = zone && selected?.spot ? `${zone.id}:${selected.spot.spot}` : null

  // ช่องบนผังของแต่ละโซน (สร้างครั้งเดียวต่อข้อมูล/การเลือก — เลื่อนหรือซูมผังไม่ต้องวาดใหม่)
  const layers = useMemo(() => {
    const out = new Map<string, { coarse: ReactNode; fine: ReactNode }>()
    for (const z of floorZones) {
      const s = slotMap.zones.get(z.id)
      if (!s) continue
      const ring = lit.loose.has(z.id) ? (
        <rect x={z.x - 0.35} y={z.z - 0.35} width={z.width + 0.7} height={z.depth + 0.7} fill="none" stroke={LIT} strokeWidth={0.3} strokeDasharray="0.9 0.45" />
      ) : null
      if (!s.spots.length) {
        if (ring) out.set(z.id, { coarse: ring, fine: ring })
        continue
      }
      const marks = s.spots.filter((sp) => lit.spots.has(`${z.id}:${sp.spot}`) || selKey === `${z.id}:${sp.spot}`)
      const draw = (fine: boolean) => (
        <g>
          {s.spots.map((sp) => (
            <SpotCell key={sp.spot} spot={sp} showNo={fine} />
          ))}
          {marks.map((sp) => (
            <SpotRing key={`m${sp.spot}`} spot={sp} color={selKey === `${z.id}:${sp.spot}` ? BRAND.primary : LIT} />
          ))}
          {ring}
        </g>
      )
      out.set(z.id, { coarse: draw(false), fine: draw(true) })
    }
    return out
  }, [floorZones, slotMap, lit, selKey])
  const renderZone = useCallback((z: Zone, unit: number) => {
    const l = layers.get(z.id)
    return l ? (unit < FINE_UNIT ? l.fine : l.coarse) : null
  }, [layers])

  /** แตะผัง: เลือกโซน และช่องที่แตะ (ชั้นล่างสุดที่มีของ หรือชั้น 1) */
  const tapAt = (id: string | null, x: number, z: number) => {
    if (!id) return
    setZoneId(id)
    setFocusLpn(null)
    setZoom(null)
    const s = slotMap.zones.get(id)
    const sp = s ? spotAt(s, x, z) : null
    setSlotCode(sp ? (sp.levels.find((l) => l.boxes.length) ?? sp.levels[0]).code : null)
  }
  const openZone = (id: string) => {
    setZoneId(id)
    setSlotCode(null)
    setFocusLpn(null)
    setZoom((z) => ({ zoneId: id, n: (z?.n ?? 0) + 1 }))
  }
  const closeZone = () => {
    setZoneId(null)
    setSlotCode(null)
    setFocusLpn(null)
  }
  /** เปลี่ยนชั้น: ปิดโซนของชั้นอื่น (แผงแสดงสรุปชั้นใหม่) ยกเว้นกำลังดูเส้นทางเดินข้ามชั้น */
  const pickFloor = (id: string) => {
    setPickedFloor(id)
    if (zone && zone.floorId !== id && tab !== 'route') closeZone()
  }

  const zoomZone = zoom ? layout.zones.find((z) => z.id === zoom.zoneId) : undefined
  const zoomTo = zoom && zoomZone && zoomZone.floorId === floor.id ? { x: zoomZone.x, z: zoomZone.z, width: zoomZone.width, depth: zoomZone.depth, n: zoom.n } : null

  // เส้นทางเดิน A (จุดเริ่ม) → B (โซนที่เลือก)
  const receiving = layout.zones.find((z) => z.kind === 'receiving')
  const from = layout.zones.find((z) => z.id === fromId) ?? receiving ?? null
  const directions = useMemo(() => {
    if (tab !== 'route' || !zone || !from || from.id === zone.id) return null
    const route = findRoute(layout, from.accessNodeId, zone.accessNodeId)
    return route ? { route, ...routeDirections(layout, route, from, zone) } : null
  }, [tab, layout, from, zone])
  const access = (z: Zone | null) => (z ? layout.nodes.find((n) => n.id === z.accessNodeId) : undefined)
  const pin = (z: Zone | null, color: string, label: string) => {
    const a = access(z)
    return z && a && z.floorId === floor.id ? [{ x: a.x, z: a.z, color, label }] : []
  }
  const marks = tab === 'route' && zone ? [...pin(from, '#16a34a', 'A'), ...pin(zone, '#dc2626', 'B')] : undefined

  const floorStats = useMemo(() => sumCounts([...slotMap.zones.values()].filter((z) => z.floorId === floor.id)), [slotMap, floor.id])
  const summary = useMemo(
    () =>
      floorZones
        .map((z) => ({ zone: z, zs: slotMap.zones.get(z.id)! }))
        .filter(({ zone: z, zs: s }) => s && (STORE_KINDS.has(z.kind) || s.boxes > 0)),
    [floorZones, slotMap],
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100 md:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2" role="tablist" aria-label="ชั้น">
          {floors.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={f.id === floor.id}
              onClick={() => pickFloor(f.id)}
              className={`relative min-h-[40px] shrink-0 rounded-full px-3.5 text-sm font-semibold ring-1 ${f.id === floor.id ? 'text-white ring-transparent' : 'bg-white text-slate-600 ring-slate-200'}`}
              style={f.id === floor.id ? { background: BRAND.primary } : undefined}
            >
              {short(f.name)}
              {zone?.floorId === f.id && ' 📍'}
              {lit.floors.has(f.id) && <i className="absolute right-1 top-1 h-2 w-2 rounded-full" style={{ background: LIT }} title="มีของที่ค้นหา" />}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-3 overflow-x-auto border-b border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600" aria-label="สถานะช่องเก็บของชั้นนี้">
          {SLOT_STATUS.map((k) => (
            <span key={k} className="flex shrink-0 items-center gap-1.5">
              <i className="h-3 w-3 rounded-sm" style={CELL[k]} />
              {SLOT_LABEL[k]} <b className="tabular-nums text-slate-800">{fmt(floorStats.counts[k])}</b>
            </span>
          ))}
          <span className="ml-auto shrink-0 text-slate-500">
            {fmt(floorStats.boxes)} กล่อง · {fmt(floorStats.qty)} ชิ้น
          </span>
        </div>

        <div className="relative min-h-0 flex-1">
          <PlanCanvas
            key={floor.id}
            floor={floor}
            paint={floorPaint(layout, floor)}
            zones={floorZones}
            nodes={layout.nodes.filter((n) => n.floorId === floor.id)}
            selectedId={zone?.floorId === floor.id ? zone.id : null}
            onSelect={noop}
            onTapAt={tapAt}
            onCommit={noop}
            issues={NO_ISSUES}
            stock={stock}
            showAisles
            isEditable={() => false}
            readOnly
            fitTo={fitTo}
            renderZone={renderZone}
            zoomTo={zoomTo}
            route={directions?.paths.get(floor.id)}
            marks={marks}
          />
          {(lpns === null || error) && (
            <p className="pointer-events-none absolute inset-x-3 top-3 rounded-lg bg-white/90 px-3 py-2 text-center text-sm shadow ring-1 ring-slate-200">
              {error ? <span className="text-rose-600">โหลดกล่องในคลังไม่สำเร็จ: {error}</span> : <span className="text-slate-600">กำลังโหลดของในคลัง…</span>}
            </p>
          )}
          {!zone && lpns !== null && !error && (
            <p className="pointer-events-none absolute inset-x-3 top-3 rounded-lg bg-white/90 px-3 py-2 text-center text-sm text-slate-600 shadow ring-1 ring-slate-200 md:hidden">
              แตะโซนหรือช่องบนผังเพื่อดูของ · บีบ 2 นิ้วเพื่อซูม
            </p>
          )}
        </div>
      </div>

      <aside
        className={`${zone ? 'flex' : 'hidden md:flex'} max-h-[52%] shrink-0 flex-col overflow-y-auto border-t border-slate-200 bg-white md:max-h-none md:w-[25rem] md:border-l md:border-t-0`}
        aria-label={zone ? `โซน ${zone.code}` : 'สรุปชั้น'}
      >
        {zone ? (
          <div className="flex flex-col gap-3 px-3 pb-4 pt-2 md:p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs text-slate-500">
                  {KIND_LABEL[zone.kind] ?? 'โซน'} · {short(layout.floors.find((f) => f.id === zone.floorId)?.name ?? '')}
                </div>
                <h2 className="truncate text-lg font-bold" style={{ color: BRAND.primary }}>
                  {zone.code} <span className="text-sm font-normal text-slate-600">{zone.name}</span>
                </h2>
                {zs && <ZoneStats zs={zs} />}
              </div>
              <div className="flex shrink-0 gap-1.5">
                {onOpen3D && (
                  <button className="h-10 rounded-full px-3 text-xs font-semibold text-sky-700 ring-1 ring-sky-200 hover:bg-sky-50" onClick={() => onOpen3D(zone.id)} title="เปิดโซนนี้ในผังโรงงาน 3D">
                    ดูใน 3D
                  </button>
                )}
                <button className="grid h-10 w-10 place-items-center rounded-full text-slate-500 ring-1 ring-slate-200" onClick={closeZone} aria-label="ปิด">
                  ✕
                </button>
              </div>
            </div>

            <div className="flex rounded-lg bg-slate-100 p-0.5 text-sm" role="tablist">
              {(
                [
                  ['slots', 'ช่องเก็บ'],
                  ['route', 'เส้นทางเดิน'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={`min-h-[36px] flex-1 rounded-md transition ${tab === k ? 'bg-white font-semibold shadow-sm' : 'text-slate-500'}`}
                  style={tab === k ? { color: BRAND.primary } : undefined}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'slots' ? (
              <ZoneSlotsView
                zs={zs}
                selected={selected}
                lit={lit.boxes}
                onPick={(code) => {
                  setSlotCode(code)
                  setFocusLpn(null)
                }}
                onOpenLpn={onOpenLpn}
              />
            ) : (
              <section className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <span className="shrink-0 font-semibold text-emerald-700">A เริ่มจาก</span>
                  <select className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm" value={from?.id ?? ''} onChange={(e) => setFromId(e.target.value)}>
                    {layout.zones
                      .filter((z) => z.kind !== 'stairs' && z.kind !== 'lift')
                      .map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.code} · {z.name}
                        </option>
                      ))}
                  </select>
                </label>
                <p className="text-sm text-slate-600">
                  <span className="font-semibold text-rose-600">B ปลายทาง</span> {zone.code}
                </p>
                {directions ? (
                  <>
                    <p className="text-sm font-semibold text-slate-800">
                      ระยะเดิน ~{Math.round(directions.route.walkDistance)} ม. · ~{Math.max(1, Math.round(directions.route.timeSeconds / 60))} นาที
                      {directions.route.floorChanges > 0 && ` · เปลี่ยนชั้น ${directions.route.floorChanges} ครั้ง`}
                    </p>
                    <ol className="flex flex-col gap-1">
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
                ) : from?.id === zone.id ? (
                  <p className="text-sm text-slate-500">เลือกจุดเริ่มที่ไม่ใช่โซนนี้</p>
                ) : (
                  <p className="text-sm text-rose-600">ไม่พบเส้นทางเดินถึงโซนนี้</p>
                )}
              </section>
            )}
          </div>
        ) : (
          <FloorSummary floorName={floor.name} list={summary} unknown={slotMap.unknown} litZones={lit.zones} onOpen={openZone} />
        )}
      </aside>
    </div>
  )
}

/** ที่วาง 1 จุดบนผัง: แบ่งแถบตามชั้น (ซ้าย → ขวา = ชั้นล่าง → บน) */
function SpotCell({ spot, showNo }: { spot: Spot; showNo: boolean }) {
  const g = Math.min(spot.w, spot.d) * 0.07
  const x = spot.x + g
  const y = spot.z + g
  const w = spot.w - g * 2
  const h = spot.d - g * 2
  const bw = w / spot.levels.length
  const font = Math.min(w, h, 1.6) * 0.42
  return (
    <g>
      {spot.levels.map((l, i) => (
        <rect key={l.code} x={x + i * bw} y={y} width={bw} height={h} fill={FILL[l.status]} />
      ))}
      {spot.levels.slice(1).map((l, i) => (
        <line key={`d${l.code}`} x1={x + (i + 1) * bw} y1={y} x2={x + (i + 1) * bw} y2={y + h} stroke="#94a3b8" strokeWidth={0.03} />
      ))}
      <rect x={x} y={y} width={w} height={h} fill="none" stroke="#64748b" strokeWidth={0.05} />
      {spot.levels.some((l) => l.blocked && l.boxes.length) && <rect x={x} y={y} width={w} height={h} fill="none" stroke="#dc2626" strokeWidth={0.1} strokeDasharray="0.2 0.12" />}
      {showNo && (
        <text
          x={x + w / 2}
          y={y + h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={font}
          fontWeight={700}
          fill="#0f172a"
          stroke="#ffffff"
          strokeWidth={font * 0.22}
          paintOrder="stroke"
          fontFamily="ui-monospace, monospace"
        >
          {pad(spot.spot)}
        </text>
      )}
    </g>
  )
}

/** กรอบเน้นที่วาง: ช่องที่เลือก / ผลค้นหา (วาดทับทุกช่อง ไม่ให้ช่องข้างเคียงบัง) */
function SpotRing({ spot, color }: { spot: Spot; color: string }) {
  return <rect x={spot.x - 0.06} y={spot.z - 0.06} width={spot.w + 0.12} height={spot.d + 0.12} fill="none" stroke={color} strokeWidth={0.24} rx={0.08} />
}

function ZoneStats({ zs }: { zs: ZoneSlots }) {
  const total = slotTotal(zs)
  return (
    <div className="text-sm text-slate-600">
      {total > 0 && (
        <div>
          มีของ <b className="tabular-nums">{fmt(zs.counts.stock + zs.counts.hold)}</b>/{fmt(total)} ช่อง · ว่าง {fmt(zs.counts.empty)}
          {zs.counts.blocked > 0 && ` · ปิดใช้ ${fmt(zs.counts.blocked)}`}
        </div>
      )}
      <div className="text-xs text-slate-500">
        {zs.boxes ? `${fmt(zs.boxes)} กล่อง · ${fmt(zs.qty)} ชิ้น` : 'ไม่มีของ'}
        {zs.holdBoxes > 0 && <span className="ml-1.5 font-semibold text-amber-700">รอตรวจ MI3 {fmt(zs.holdBoxes)} กล่อง</span>}
      </div>
    </div>
  )
}

/** แท็บช่องเก็บของโซน: ช่องที่เลือก → หน้า rack ทีละแถว → ช่องพิเศษ → กล่องนอกช่อง */
function ZoneSlotsView({
  zs,
  selected,
  lit,
  onPick,
  onOpenLpn,
}: {
  zs: ZoneSlots | null
  selected: { slot: Slot; spot: Spot | null } | null
  lit: ReadonlySet<string>
  onPick: (code: string) => void
  onOpenLpn?: (lpnNo: string) => void
}) {
  if (!zs || (!zs.spots.length && !zs.extra.length && !zs.loose.length))
    return <p className="text-sm text-slate-500">{zs?.kind === 'area' ? 'ไม่มีกล่องในพื้นที่นี้' : 'โซนนี้ไม่มีช่องเก็บ · ดูทางเดินได้ที่แท็บเส้นทางเดิน'}</p>
  return (
    <div className="flex flex-col gap-4">
      {selected && <SlotCard slot={selected.slot} spot={selected.spot} zs={zs} lit={lit} onOpenLpn={onOpenLpn} />}
      {zs.faces.map((count, face) => {
        const spots = zs.spots.filter((s) => s.face === face)
        return (
          <RackFace
            key={face}
            title={zs.kind === 'tent' ? `บล็อก ${pad(1)}–${pad(count)} (ตามแนวยาวเต็นท์)` : `แถว ${face + 1} · ที่ ${pad(spots[0].spot)}–${pad(spots[spots.length - 1].spot)}`}
            spots={spots}
            levels={zs.levels}
            selected={selected?.slot.code ?? null}
            lit={lit}
            onPick={onPick}
          />
        )
      })}
      {zs.spots.length > 0 && <p className="-mt-2 text-[11px] text-slate-400">แตะช่องเพื่อดูกล่อง · ตัวอักษรในช่อง = Model ของกล่อง</p>}
      {zs.extra.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-semibold text-slate-500">ช่องพิเศษ (เพิ่มในหลังบ้าน) {zs.extra.length}</h3>
          <div className="flex flex-wrap gap-1.5">
            {zs.extra.map((s) => (
              <button
                key={s.code}
                className="min-h-[36px] rounded-md px-2 font-mono text-xs font-semibold"
                style={{ ...CELL[s.status], outline: selected?.slot.code === s.code ? `2px solid ${BRAND.primary}` : undefined, outlineOffset: 1 }}
                onClick={() => onPick(s.code)}
                title={SLOT_LABEL[s.status]}
              >
                {s.code}
              </button>
            ))}
          </div>
        </section>
      )}
      {zs.loose.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-semibold text-slate-500">
            {zs.kind === 'area' ? `กล่องในพื้นที่ (${fmt(zs.loose.length)})` : `กล่องที่ไม่อยู่ในช่องของผัง (${fmt(zs.loose.length)})`}
          </h3>
          {zs.kind !== 'area' && <p className="mb-1.5 text-xs text-amber-700">รหัสช่องไม่มีในผังแล้ว หรือระบุแค่โซน · สแกน MOVE ย้ายเข้าช่องที่ถูกต้อง</p>}
          <ul className="flex flex-col gap-2">
            {zs.loose.map((b) => (
              <BoxRow key={b.lpnNo} box={b} lit={lit.has(b.lpnNo)} showLocation={zs.kind !== 'area'} onOpenLpn={onOpenLpn} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** หน้า rack 1 แถว: แนวตั้ง = ชั้น (บนสุดอยู่บน) · แนวนอน = ที่วางเรียงตามรหัส */
function RackFace({
  title,
  spots,
  levels,
  selected,
  lit,
  onPick,
}: {
  title: string
  spots: Spot[]
  levels: number
  selected: string | null
  lit: ReadonlySet<string>
  onPick: (code: string) => void
}) {
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold text-slate-500">{title}</h3>
      <div className="overflow-x-auto pb-1">
        <div className="grid gap-0.5" style={{ gridTemplateColumns: `2.1rem repeat(${spots.length}, minmax(1.6rem, 2.4rem))` }}>
          {Array.from({ length: levels }, (_, i) => levels - i).map((level) => (
            <Fragment key={level}>
              <span className="self-center pr-1 text-right text-[10px] text-slate-400">{levels > 1 ? `ชั้น ${level}` : ''}</span>
              {spots.map((s) => {
                const slot = s.levels[level - 1]
                const sel = slot.code === selected
                const label = slot.boxes.length ? `${slot.boxes[0].model}${slot.boxes.length > 1 ? `+${slot.boxes.length - 1}` : ''}` : slot.status === 'blocked' ? '✕' : ''
                return (
                  <button
                    key={slot.code}
                    onClick={() => onPick(slot.code)}
                    aria-pressed={sel}
                    aria-label={`${slot.code} ${SLOT_LABEL[slot.status]}`}
                    title={`${slot.code} · ${SLOT_LABEL[slot.status]}${slot.qty ? ` · ${fmt(slot.qty)} ชิ้น` : ''}`}
                    className="h-9 overflow-hidden truncate rounded px-0.5 text-[10px] font-semibold"
                    style={{
                      ...CELL[slot.status],
                      ...(slot.blocked && slot.boxes.length ? { boxShadow: 'inset 0 0 0 2px #dc2626' } : null),
                      outline: sel ? `2px solid ${BRAND.primary}` : slot.boxes.some((b) => lit.has(b.lpnNo)) ? `2px solid ${LIT}` : undefined,
                      outlineOffset: 1,
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </Fragment>
          ))}
          <span />
          {spots.map((s) => (
            <span key={s.spot} className="text-center font-mono text-[10px] text-slate-400">
              {pad(s.spot)}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

function SlotCard({ slot, spot, zs, lit, onOpenLpn }: { slot: Slot; spot: Spot | null; zs: ZoneSlots; lit: ReadonlySet<string>; onOpenLpn?: (lpnNo: string) => void }) {
  const where = spot ? (zs.kind === 'tent' ? `บล็อก ${pad(spot.spot)}` : `ที่วาง ${pad(spot.spot)} · ชั้น ${slot.level}${zs.levels > 1 ? ` จาก ${zs.levels}` : ''}`) : 'ช่องพิเศษ (เพิ่มในหลังบ้าน)'
  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-base font-bold text-slate-800">{slot.code}</span>
        <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={CELL[slot.status]}>
          {SLOT_LABEL[slot.status]}
        </span>
        {slot.blocked && slot.boxes.length > 0 && <span className="text-xs font-semibold text-rose-700">ช่องนี้ปิดใช้แต่ยังมีของ</span>}
      </div>
      <div className="text-xs text-slate-500">{where}</div>
      {slot.boxes.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">
          {slot.status === 'blocked' ? 'ปิดใช้ (ชำรุด / ห้ามวาง) · เปิดคืนได้ที่ หลังบ้าน → ข้อมูลหลัก → ช่องเก็บ' : 'ว่าง · วางของได้ (สแกน PUT แล้วสแกนป้ายช่องนี้)'}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {slot.boxes.map((b) => (
            <BoxRow key={b.lpnNo} box={b} lit={lit.has(b.lpnNo)} onOpenLpn={onOpenLpn} />
          ))}
        </ul>
      )}
    </div>
  )
}

function BoxRow({ box, lit, showLocation, onOpenLpn }: { box: SlotBox; lit: boolean; showLocation?: boolean; onOpenLpn?: (lpnNo: string) => void }) {
  const open = 'ml-auto inline-flex min-h-[36px] shrink-0 items-center rounded-lg px-2.5 text-xs font-semibold text-sky-700 ring-1 ring-sky-200 hover:bg-sky-50'
  return (
    <li className={`rounded-lg bg-white p-2.5 ${lit ? 'ring-2 ring-rose-500' : 'ring-1 ring-slate-200'}`}>
      <div className="flex items-center gap-2">
        <i className="h-3 w-3 shrink-0 rounded-sm" style={{ background: modelColor(box.model) }} />
        <span className="truncate font-mono text-sm font-semibold text-slate-800">{box.lpnNo}</span>
        <span className="shrink-0 text-xs text-slate-500">{box.model}</span>
        <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums text-slate-800">{fmt(box.qty)} ชิ้น</span>
      </div>
      <ul className="mt-1 text-xs text-slate-600">
        {box.items.map((i) => (
          <li key={i.partNo} className="flex justify-between gap-2">
            <span className="truncate">
              <b className="font-mono">{i.partNo}</b> {i.name}
            </span>
            {box.items.length > 1 && <span className="shrink-0 tabular-nums">{fmt(i.qty)}</span>}
          </li>
        ))}
      </ul>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
        {box.hold && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">รอตรวจ MI3 · ห้ามเบิก</span>}
        {showLocation && <span className="font-mono">{box.location}</span>}
        {box.grnNo && <span>{box.grnNo}</span>}
        <span>รับเข้า {fmtTime(box.createdAt)}</span>
        {onOpenLpn ? (
          <button className={open} onClick={() => onOpenLpn(box.lpnNo)}>
            เปิดหน้าสแกน →
          </button>
        ) : (
          <a className={open} href={`/t/${encodeURIComponent(box.lpnNo)}`} title="เปิดกล่องนี้ในหน้าสแกน">
            เปิดหน้าสแกน →
          </a>
        )}
      </div>
    </li>
  )
}

/** แผงด้านข้างเมื่อยังไม่เลือกโซน: โซนในชั้นนี้ เรียงตามผัง พร้อมแถบความเต็ม */
function FloorSummary({
  floorName,
  list,
  unknown,
  litZones,
  onOpen,
}: {
  floorName: string
  list: { zone: Zone; zs: ZoneSlots }[]
  unknown: SlotBox[]
  litZones: Set<string>
  onOpen: (zoneId: string) => void
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="text-lg font-bold" style={{ color: BRAND.primary }}>
          {floorName}
        </h2>
        <p className="text-xs text-slate-500">เลือกโซนบนผังหรือในรายการเพื่อดูหน้า rack · ซูมเข้าเพื่อดูเลขที่วาง · แต่ละช่องบนผังแบ่งแถบตามชั้น (ซ้าย → ขวา = ชั้นล่าง → บน)</p>
      </div>
      {list.length === 0 && <p className="text-sm text-slate-500">ชั้นนี้ไม่มีพื้นที่เก็บของ</p>}
      <ul className="flex flex-col gap-1.5">
        {list.map(({ zone, zs }) => {
          const total = slotTotal(zs)
          return (
            <li key={zone.id}>
              <button
                className={`w-full rounded-lg p-2.5 text-left hover:bg-slate-50 ${litZones.has(zone.id) ? 'ring-2 ring-rose-500' : 'ring-1 ring-slate-200'}`}
                onClick={() => onOpen(zone.id)}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-semibold text-slate-800">
                    {zone.code} <span className="font-normal text-slate-500">{zone.name}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-600">{zs.boxes ? `${fmt(zs.boxes)} กล่อง` : 'ว่าง'}</span>
                </div>
                {total > 0 && (
                  <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                    {(['stock', 'hold', 'blocked'] as const).map((k) => (
                      <i key={k} style={{ width: `${(zs.counts[k] / total) * 100}%`, ...CELL[k] }} />
                    ))}
                  </div>
                )}
                <div className="mt-1 text-xs text-slate-500">
                  {total ? `มีของ ${fmt(zs.counts.stock + zs.counts.hold)}/${fmt(total)} ช่อง · ว่าง ${fmt(zs.counts.empty)}` : KIND_LABEL[zone.kind]}
                  {zs.holdBoxes > 0 && ` · รอ MI3 ${fmt(zs.holdBoxes)} กล่อง`}
                  {zs.counts.blocked > 0 && ` · ปิดใช้ ${fmt(zs.counts.blocked)}`}
                </div>
              </button>
            </li>
          )
        })}
      </ul>
      {unknown.length > 0 && (
        <Alert tone="warn">
          กล่อง {fmt(unknown.length)} กล่อง รหัสช่องไม่ตรงกับผัง: {unknown.slice(0, 4).map((b) => `${b.lpnNo} (${b.location})`).join(', ')}
          {unknown.length > 4 && ' …'} · สแกน MOVE ย้ายเข้าช่องที่มีในผัง
        </Alert>
      )}
    </div>
  )
}
