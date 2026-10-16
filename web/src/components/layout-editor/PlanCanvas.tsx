import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent } from 'react'
import { planRack, RACK } from '../../data/warehouse'
import { ZONE_STYLE } from '../../data/zoneStyle'
import type { ZoneContents } from '../../wms/mapStock'
import { AISLE_WIDTH, type FloorPaint } from '../../lib/floorPlan'
import { clampToFloor, distanceToRect, snap, type ZoneIssue, type ZonePatch } from '../../lib/layoutEdit'
import type { Floor, NavNode, Zone } from '../../types/layout'

type Rect = Pick<Zone, 'x' | 'z' | 'width' | 'depth'>
type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

interface View {
  x: number
  y: number
  w: number
  h: number
}

type Drag =
  | { kind: 'zone'; id: string; handle: Handle | 'move'; start: [number, number]; orig: Rect; moved: boolean }
  | { kind: 'pan'; startClient: [number, number]; orig: View; perPx: number; moved: boolean; tap?: string }
  | { kind: 'pinch'; dist: number; mid: [number, number]; orig: View }

interface Props {
  floor: Floor
  paint: FloorPaint
  zones: Zone[]
  nodes: NavNode[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onCommit: (id: string, patch: ZonePatch) => void
  issues: Map<string, ZoneIssue[]>
  stock: Map<string, ZoneContents>
  showAisles: boolean
  isEditable: (zone: Zone) => boolean
  /** เส้นทางนำทางบนชั้นนี้ (พิกัดภายในชั้น) */
  route?: [number, number][][]
  /** หมุดบนผัง เช่น จุดเริ่ม / ปลายทาง */
  marks?: { x: number; z: number; color: string; label: string }[]
}

const MIN_SIZE = 1
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const CURSOR: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' }

/** สีบนผัง 2D (ตามสีเส้นพื้น 5S) */
const PLAN: Record<Zone['kind'], { fill: string; stroke: string }> = {
  storage: { fill: '#e0edff', stroke: '#2c6cb8' },
  assembly: { fill: '#fff4cc', stroke: '#d4a400' },
  receiving: { fill: '#fff4cc', stroke: '#d4a400' },
  inspection: { fill: '#ffe8d6', stroke: '#e0701a' },
  ng: { fill: '#ffe1e1', stroke: '#d93a3a' },
  utility: { fill: '#eef1f5', stroke: '#64748b' },
  stairs: { fill: '#f1f5f9', stroke: '#94a3b8' },
  lift: { fill: '#f1f5f9', stroke: '#94a3b8' },
  tent: { fill: '#f1f5f9', stroke: '#94a3b8' },
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/** ย้าย (move) หรือขยับขอบตามจุดจับ แล้วบีบให้อยู่ในพื้นชั้น ขยับทีละ 0.5 ม. */
function resize(orig: Rect, handle: Handle | 'move', dx: number, dz: number, floor: Floor): Rect {
  if (handle === 'move') return clampToFloor({ ...orig, x: snap(orig.x + dx), z: snap(orig.z + dz) }, floor)
  let left = orig.x
  let top = orig.z
  let right = orig.x + orig.width
  let bottom = orig.z + orig.depth
  if (handle.includes('w')) left = clamp(snap(left + dx), 0, right - MIN_SIZE)
  if (handle.includes('e')) right = clamp(snap(right + dx), left + MIN_SIZE, floor.width)
  if (handle.includes('n')) top = clamp(snap(top + dz), 0, bottom - MIN_SIZE)
  if (handle.includes('s')) bottom = clamp(snap(bottom + dz), top + MIN_SIZE, floor.depth)
  return { x: left, z: top, width: right - left, depth: bottom - top }
}

/** ผังพื้นมุมบน: ลากโซนเพื่อย้าย ลากจุดมุม/ขอบเพื่อปรับขนาด ลากพื้นที่ว่างเพื่อเลื่อนผัง หมุนล้อเมาส์เพื่อซูม */
export function PlanCanvas({ floor, paint, zones, nodes, selectedId, onSelect, onCommit, issues, stock, showAisles, isEditable, route, marks }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  // นิ้วที่แตะจออยู่ (2 นิ้ว = ซูมแบบบีบ)
  const pointers = useRef(new Map<number, [number, number]>())
  const fit = useMemo<View>(() => ({ x: -7, y: -6, w: floor.width + 14, h: floor.depth + 13 }), [floor.width, floor.depth])
  const [view, setView] = useState<View>(fit)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [draft, setDraft] = useState<(Rect & { id: string }) | null>(null)
  const unit = view.w / 100 // ขนาดอ้างอิงของเส้น/ตัวอักษรตามระดับซูม

  const toPlan = (clientX: number, clientY: number): [number, number] => {
    const el = svg.current!
    const pt = el.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const p = pt.matrixTransform(el.getScreenCTM()!.inverse())
    return [p.x, p.y]
  }

  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    const [px, py] = toPlan(e.clientX, e.clientY)
    const f = e.deltaY > 0 ? 1.15 : 1 / 1.15
    setView((v) => {
      const w = Math.min(Math.max(v.w * f, 12), 320)
      const k = w / v.w
      return { x: px - (px - v.x) * k, y: py - (py - v.y) * k, w, h: v.h * k }
    })
  }

  const zoom = (f: number) =>
    setView((v) => {
      const w = Math.min(Math.max(v.w * f, 12), 320)
      const k = w / v.w
      const cx = v.x + v.w / 2
      const cy = v.y + v.h / 2
      return { x: cx - (v.w * k) / 2, y: cy - (v.h * k) / 2, w, h: v.h * k }
    })

  const startPan = (e: ReactPointerEvent, tap?: string) => {
    const el = svg.current!
    const box = el.getBoundingClientRect()
    el.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, [e.clientX, e.clientY])
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      setDrag({ kind: 'pinch', dist: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: toPlan((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), orig: view })
      return
    }
    setDrag({ kind: 'pan', startClient: [e.clientX, e.clientY], orig: view, perPx: Math.max(view.w / box.width, view.h / box.height), moved: false, tap })
  }

  const startZone = (e: ReactPointerEvent, zone: Zone, handle: Handle | 'move') => {
    e.stopPropagation()
    // โซนที่แก้ไม่ได้: ลากเพื่อเลื่อนผังได้ แตะเฉย ๆ = เลือก
    if (!isEditable(zone)) return startPan(e, zone.id)
    onSelect(zone.id)
    svg.current!.setPointerCapture(e.pointerId)
    setDrag({ kind: 'zone', id: zone.id, handle, start: toPlan(e.clientX, e.clientY), orig: { x: zone.x, z: zone.z, width: zone.width, depth: zone.depth }, moved: false })
  }

  const onMove = (e: ReactPointerEvent) => {
    if (!drag) return
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, [e.clientX, e.clientY])
    if (drag.kind === 'pinch') {
      if (pointers.current.size < 2) return
      const [a, b] = [...pointers.current.values()]
      const d = Math.hypot(a[0] - b[0], a[1] - b[1])
      if (d < 1) return
      const o = drag.orig
      const w = Math.min(Math.max((o.w * drag.dist) / d, 12), 320)
      const k = w / o.w
      const [px, py] = drag.mid
      setView({ x: px - (px - o.x) * k, y: py - (py - o.y) * k, w, h: o.h * k })
      return
    }
    if (drag.kind === 'pan') {
      const dx = (e.clientX - drag.startClient[0]) * drag.perPx
      const dy = (e.clientY - drag.startClient[1]) * drag.perPx
      if (Math.abs(dx) + Math.abs(dy) > drag.perPx * 3 && !drag.moved) setDrag({ ...drag, moved: true })
      setView({ ...drag.orig, x: drag.orig.x - dx, y: drag.orig.y - dy })
      return
    }
    const [px, pz] = toPlan(e.clientX, e.clientY)
    const next = resize(drag.orig, drag.handle, px - drag.start[0], pz - drag.start[1], floor)
    if (!drag.moved) setDrag({ ...drag, moved: true })
    setDraft({ id: drag.id, ...next })
  }

  const onUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (drag?.kind === 'pinch') {
      // ยกนิ้วหนึ่งออก: จบการซูม (ไม่เลื่อนผังต่อ)
      if (pointers.current.size === 0) setDrag(null)
      return
    }
    if (drag?.kind === 'pan' && !drag.moved) onSelect(drag.tap ?? null)
    if (drag?.kind === 'zone' && draft && draft.id === drag.id) {
      const o = drag.orig
      if (draft.x !== o.x || draft.z !== o.z || draft.width !== o.width || draft.depth !== o.depth)
        onCommit(drag.id, { x: draft.x, z: draft.z, width: draft.width, depth: draft.depth })
    }
    setDrag(null)
    setDraft(null)
  }

  const shown = zones.map((z) => (draft && draft.id === z.id ? { ...z, ...draft } : z))
  const selected = shown.find((z) => z.id === selectedId)
  const ordered = [...shown.filter((z) => z.id !== selectedId), ...(selected ? [selected] : [])]

  // เส้นกริด 1 ม. / 6 ม.
  const grid = useMemo(() => {
    const minor: ReactNode[] = []
    const major: ReactNode[] = []
    for (let x = 0; x <= floor.width; x++) (x % 6 ? minor : major).push(<line key={`x${x}`} x1={x} y1={0} x2={x} y2={floor.depth} />)
    for (let z = 0; z <= floor.depth; z++) (z % 6 ? minor : major).push(<line key={`z${z}`} x1={0} y1={z} x2={floor.width} y2={z} />)
    return { minor, major }
  }, [floor.width, floor.depth])

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-200">
      <svg
        ref={svg}
        className="h-full w-full touch-none select-none"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel}
        onPointerDown={(e) => startPan(e)}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{ cursor: drag?.kind === 'pan' ? 'grabbing' : 'grab' }}
      >
        <defs>
          <pattern id="hazard" width="1" height="1" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="1" height="1" fill="#f2c200" />
            <rect width="0.5" height="1" fill="#1d1d1f" />
          </pattern>
          <pattern id="locked" width="0.8" height="0.8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="0.8" height="0.8" fill="#f1f5f9" />
            <rect width="0.12" height="0.8" fill="#cbd5e1" />
          </pattern>
        </defs>

        {/* พื้นชั้น + ผนัง */}
        <rect x={-0.3} y={-0.3} width={floor.width + 0.6} height={floor.depth + 0.6} fill="#475569" rx={0.2} />
        <rect x={0} y={0} width={floor.width} height={floor.depth} fill="#eef6f1" />
        <g stroke="#dbe7df" strokeWidth={0.04}>{grid.minor}</g>
        <g stroke="#c4d6ca" strokeWidth={0.08}>{grid.major}</g>

        {/* ทางเดิน */}
        {showAisles && (
          <g strokeLinecap="square">
            {paint.aisles.map(([ax, az, bx, bz], i) => (
              <line key={`a${i}`} x1={ax} y1={az} x2={bx} y2={bz} stroke="#f2c200" strokeWidth={AISLE_WIDTH + 0.2} />
            ))}
            {paint.aisles.map(([ax, az, bx, bz], i) => (
              <line key={`b${i}`} x1={ax} y1={az} x2={bx} y2={bz} stroke="#fdf6d8" strokeWidth={AISLE_WIDTH} />
            ))}
            {paint.aisles.map(([ax, az, bx, bz], i) => (
              <line key={`c${i}`} x1={ax} y1={az} x2={bx} y2={bz} stroke="#e0b100" strokeWidth={0.1} strokeDasharray="1 1" strokeLinecap="butt" />
            ))}
          </g>
        )}
        {paint.hazards.map((h, i) => (
          <rect key={`h${i}`} x={h.x} y={h.z} width={h.width} height={h.depth} fill="url(#hazard)" opacity={0.85} />
        ))}
        {paint.columns.map(([x, z]) => (
          <rect key={`${x}-${z}`} x={x - 0.25} y={z - 0.25} width={0.5} height={0.5} fill="#64748b" />
        ))}

        {/* โซน */}
        {ordered.map((zone) => (
          <PlanZone
            key={zone.id}
            zone={zone}
            selected={zone.id === selectedId}
            editable={isEditable(zone)}
            issues={issues.get(zone.id) ?? []}
            stock={stock.get(zone.id)}
            onDown={(e) => startZone(e, zone, 'move')}
          />
        ))}

        {/* จุดหยิบของ + ขนาด + จุดจับปรับขนาดของโซนที่เลือก */}
        {selected && (
          <SelectionOverlay
            zone={selected}
            access={nodes.find((n) => n.id === selected.accessNodeId)}
            unit={unit}
            editable={isEditable(selected)}
            onHandle={(e, h) => startZone(e, selected, h)}
          />
        )}

        {/* เส้นทางนำทาง */}
        {route?.map((pts, i) => (
          <g key={`r${i}`} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <polyline points={pts.map((p) => p.join(',')).join(' ')} stroke="#ffffff" strokeWidth={unit * 2.4} />
            <polyline points={pts.map((p) => p.join(',')).join(' ')} stroke="#2563eb" strokeWidth={unit * 1.4} />
          </g>
        ))}
        {marks?.map((m) => (
          <g key={m.label} transform={`translate(${m.x}, ${m.z})`}>
            <circle r={unit * 2.6} fill={m.color} stroke="#fff" strokeWidth={unit * 0.6} />
            <text y={unit * 0.9} textAnchor="middle" fontSize={unit * 2.6} fontWeight={700} fill="#fff">
              {m.label}
            </text>
          </g>
        ))}

        {/* ทิศทาง */}
        <text x={floor.width / 2} y={floor.depth + 3.2} textAnchor="middle" fontSize={1.4} fill="#475569" fontWeight={600}>
          {(floor.building ?? 'A') === 'A' ? 'ด้านหน้าอาคาร (ฝั่งถนน) ▼' : 'ด้านหน้า (ฝั่งอาคาร A) ▼'}
        </text>
        <text x={floor.width / 2} y={-2.2} textAnchor="middle" fontSize={1.2} fill="#94a3b8">
          {(floor.building ?? 'A') === 'A' ? 'ด้านหลังอาคาร' : 'ด้านหลัง (แนวรั้ว)'}
        </text>
        {/* มาตราส่วน 10 ม. */}
        <g transform={`translate(${floor.width - 10}, ${floor.depth + 2})`}>
          <rect width={10} height={0.4} fill="#475569" />
          <rect width={5} height={0.4} fill="#cbd5e1" />
          <text x={5} y={1.9} textAnchor="middle" fontSize={1.1} fill="#475569">
            10 ม.
          </text>
        </g>
      </svg>

      <div className="absolute bottom-3 right-3 flex overflow-hidden rounded-lg bg-white shadow ring-1 ring-slate-200">
        {(
          [
            ['−', () => zoom(1.25), 'ซูมออก'],
            ['+', () => zoom(0.8), 'ซูมเข้า'],
            ['⤢', () => setView(fit), 'เห็นทั้งชั้น'],
          ] as const
        ).map(([label, fn, title]) => (
          <button key={title} onClick={fn} title={title} className="h-9 w-9 border-l border-slate-100 text-lg text-slate-600 first:border-l-0 hover:bg-slate-50">
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function PlanZone({
  zone,
  selected,
  editable,
  issues,
  stock,
  onDown,
}: {
  zone: Zone
  selected: boolean
  editable: boolean
  issues: ZoneIssue[]
  stock?: ZoneContents
  onDown: (e: ReactPointerEvent) => void
}) {
  const style = PLAN[zone.kind]
  const error = issues.some((i) => i.level === 'error')
  const locked = !editable
  const label = Math.min(1.6, zone.width / 5, zone.depth / 2.2)
  const qty = stock?.totalQty ?? 0

  // รายละเอียดภายใน: แถว rack / สายพานไลน์ประกอบ
  const inner = useMemo(() => {
    if (zone.kind === 'storage') {
      const plan = planRack(zone.width, zone.depth)
      const alongX = zone.width >= zone.depth
      return plan.rows.map((row, i) => {
        const span = row.units * RACK.singleDepth
        const len = plan.bays * RACK.bayLength
        return alongX ? (
          <rect key={i} x={zone.x + plan.start} y={zone.z + row.offset} width={len} height={span} fill="#bcd6f7" stroke="#2c6cb8" strokeWidth={0.06} />
        ) : (
          <rect key={i} x={zone.x + row.offset} y={zone.z + plan.start} width={span} height={len} fill="#bcd6f7" stroke="#2c6cb8" strokeWidth={0.06} />
        )
      })
    }
    if (zone.kind === 'assembly') {
      const alongX = zone.width >= zone.depth
      return alongX ? (
        <rect x={zone.x + 1.5} y={zone.z + zone.depth / 2 - 0.4} width={zone.width - 3} height={0.8} fill="#334155" rx={0.2} />
      ) : (
        <rect x={zone.x + zone.width / 2 - 0.4} y={zone.z + 1.5} width={0.8} height={zone.depth - 3} fill="#334155" rx={0.2} />
      )
    }
    return null
  }, [zone.kind, zone.x, zone.z, zone.width, zone.depth])

  return (
    <g onPointerDown={onDown} style={{ cursor: editable ? 'move' : 'pointer' }}>
      <rect
        x={zone.x}
        y={zone.z}
        width={zone.width}
        height={zone.depth}
        fill={locked ? 'url(#locked)' : style.fill}
        stroke={error ? '#dc2626' : selected ? '#1d4ed8' : style.stroke}
        strokeWidth={selected || error ? 0.28 : 0.16}
        strokeDasharray={error ? '0.8 0.4' : undefined}
        opacity={0.95}
      />
      {inner}
      <text
        x={zone.x + zone.width / 2}
        y={zone.z + zone.depth / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={label}
        fontWeight={700}
        fill="#0f172a"
        stroke="#ffffff"
        strokeWidth={label * 0.22}
        paintOrder="stroke"
      >
        {zone.code}
      </text>
      {zone.depth > 3 && zone.width > 5 && (
        <text
          x={zone.x + zone.width / 2}
          y={zone.z + zone.depth / 2 + label * 1.05}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={label * 0.6}
          fill="#475569"
          stroke="#ffffff"
          strokeWidth={label * 0.15}
          paintOrder="stroke"
        >
          {qty > 0 ? `${qty.toLocaleString('th-TH')} ชิ้น` : ZONE_STYLE[zone.kind].label}
        </text>
      )}
    </g>
  )
}

function SelectionOverlay({
  zone,
  access,
  unit,
  editable,
  onHandle,
}: {
  zone: Zone
  access?: NavNode
  unit: number
  editable: boolean
  onHandle: (e: ReactPointerEvent, h: Handle) => void
}) {
  const hs = Math.max(0.5, unit * 1.1)
  const pos: Record<Handle, [number, number]> = {
    nw: [zone.x, zone.z],
    n: [zone.x + zone.width / 2, zone.z],
    ne: [zone.x + zone.width, zone.z],
    e: [zone.x + zone.width, zone.z + zone.depth / 2],
    se: [zone.x + zone.width, zone.z + zone.depth],
    s: [zone.x + zone.width / 2, zone.z + zone.depth],
    sw: [zone.x, zone.z + zone.depth],
    w: [zone.x, zone.z + zone.depth / 2],
  }
  // จุดบนขอบโซนที่ใกล้จุดหยิบของที่สุด
  const edge: [number, number] | null = access
    ? [Math.min(Math.max(access.x, zone.x), zone.x + zone.width), Math.min(Math.max(access.z, zone.z), zone.z + zone.depth)]
    : null
  const font = Math.max(0.9, unit * 1.3)
  return (
    <g>
      {access && edge && distanceToRect(access.x, access.z, zone) > 0.05 && (
        <line x1={edge[0]} y1={edge[1]} x2={access.x} y2={access.z} stroke="#16a34a" strokeWidth={0.18} strokeDasharray="0.5 0.35" />
      )}
      {access && (
        <g>
          <circle cx={access.x} cy={access.z} r={Math.max(0.6, unit * 0.8)} fill="#16a34a" stroke="#ffffff" strokeWidth={0.2} />
          <text x={access.x} y={access.z - Math.max(1, unit * 1.4)} textAnchor="middle" fontSize={font * 0.85} fill="#15803d" fontWeight={600} stroke="#ffffff" strokeWidth={0.25} paintOrder="stroke">
            จุดหยิบของ
          </text>
        </g>
      )}
      {/* ขนาด */}
      <text x={zone.x + zone.width / 2} y={zone.z - font * 0.6} textAnchor="middle" fontSize={font} fill="#1d4ed8" fontWeight={700} stroke="#ffffff" strokeWidth={0.3} paintOrder="stroke">
        {zone.width} ม.
      </text>
      <text
        x={zone.x - font * 0.6}
        y={zone.z + zone.depth / 2}
        textAnchor="middle"
        fontSize={font}
        fill="#1d4ed8"
        fontWeight={700}
        stroke="#ffffff"
        strokeWidth={0.3}
        paintOrder="stroke"
        transform={`rotate(-90 ${zone.x - font * 0.6} ${zone.z + zone.depth / 2})`}
      >
        {zone.depth} ม.
      </text>
      {editable &&
        HANDLES.map((h) => (
          <rect
            key={h}
            x={pos[h][0] - hs / 2}
            y={pos[h][1] - hs / 2}
            width={hs}
            height={hs}
            rx={hs * 0.2}
            fill="#ffffff"
            stroke="#1d4ed8"
            strokeWidth={0.15}
            style={{ cursor: CURSOR[h] }}
            onPointerDown={(e) => onHandle(e, h)}
          />
        ))}
    </g>
  )
}
