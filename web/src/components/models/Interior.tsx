import { memo, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { Color, DoubleSide, type InstancedMesh, Object3D, type Texture } from 'three'
import { BRAND } from '../../data/brand'
import { modelColor } from '../../data/modelColors'
import { palletsFor, planRack, RACK } from '../../data/warehouse'
import type { ZoneContents } from '../../inventory/reports'
import { floorMarkings, hazardStripes, textLabel } from './textures'
import type { FloorPaint } from '../../lib/floorPlan'

// โมเดลภายในอาคาร A: พื้นตีเส้น, เสา, ชั้นวางพาเลท, ไลน์ประกอบวงล้อ, บันได/ลิฟต์ และยานพาหนะในคลัง
// ทุกชิ้นวาดในพิกัดภายในชั้น (เมตร) โดยมุมโซนอยู่ที่ (0, 0)

const STEEL = '#8b96a3'
const UPRIGHT = '#2c6cb8' // เสา rack สีน้ำเงิน
const BEAM = '#f28a2e' // คาน rack สีส้ม
const WOOD = '#b98d58'

export interface Box {
  p: [number, number, number]
  s: [number, number, number]
  c?: string
}

/** กล่องจำนวนมากใน draw call เดียว (เสา rack, คาน, พาเลท) */
export function InstancedBoxes({
  boxes,
  color = '#ffffff',
  roughness = 0.75,
  metalness = 0,
  map,
  castShadow = true,
  opacity = 1,
  userData,
  pickable = false,
}: {
  boxes: Box[]
  color?: string
  roughness?: number
  metalness?: number
  map?: Texture
  castShadow?: boolean
  /** < 1 = โปร่งแสง (ใช้ไฮไลต์) */
  opacity?: number
  userData?: Record<string, unknown>
  /** ให้ระบบคลิกตรวจเจอ (ผู้รับคลิกจริงคือกล่องครอบโซน ซึ่งอ่าน instanceId จาก intersections) */
  pickable?: boolean
}) {
  const ref = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const o = new Object3D()
    const c = new Color()
    boxes.forEach((b, i) => {
      o.position.set(...b.p)
      o.scale.set(...b.s)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
      if (b.c) mesh.setColorAt(i, c.set(b.c))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.computeBoundingBox()
  }, [boxes])
  if (!boxes.length) return null
  const tinted = boxes.some((b) => b.c)
  return (
    <instancedMesh
      key={`${boxes.length}-${tinted}`}
      ref={ref}
      args={[undefined, undefined, boxes.length]}
      castShadow={castShadow && opacity === 1}
      receiveShadow
      userData={userData}
      onClick={pickable ? () => undefined : undefined}
    >
      <boxGeometry />
      <meshStandardMaterial
        color={tinted ? '#ffffff' : color}
        roughness={roughness}
        metalness={metalness}
        map={map}
        transparent={opacity < 1}
        opacity={opacity}
        depthWrite={opacity === 1}
      />
    </instancedMesh>
  )
}

/** วาดตามแนวยาวของโซน: children ได้ (ความยาว L, ความกว้าง W) โดยแกน u = x ภายใน group */
export function Oriented({ width, depth, children }: { width: number; depth: number; children: (length: number, span: number) => ReactNode }) {
  if (width >= depth) return <group>{children(width, depth)}</group>
  // หมุน -90°: (u, v) → (width - v, u)
  return (
    <group position={[width, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
      {children(depth, width)}
    </group>
  )
}

/* ------------------------------------------------------------------ พื้น เสา ผนัง */

export function FloorPlate({ paint }: { paint: FloorPaint }) {
  const map = useMemo(() => floorMarkings(paint), [paint])
  useEffect(() => () => map.dispose(), [map])
  return (
    <group>
      <mesh receiveShadow position={[paint.width / 2, -0.16, paint.depth / 2]}>
        <boxGeometry args={[paint.width + 0.6, 0.3, paint.depth + 0.6]} />
        <meshStandardMaterial color="#9aa3ad" roughness={0.9} />
      </mesh>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[paint.width / 2, 0.005, paint.depth / 2]}>
        <planeGeometry args={[paint.width, paint.depth]} />
        <meshStandardMaterial map={map} roughness={0.32} metalness={0.05} />
      </mesh>
    </group>
  )
}

/** เสาคอนกรีตพร้อมแถบเหลือง-ดำกันชนที่ฐาน */
export function Columns({ points, height }: { points: [number, number][]; height: number }) {
  const shafts = useMemo<Box[]>(() => points.map(([x, z]) => ({ p: [x, height / 2, z], s: [0.5, height, 0.5] })), [points, height])
  const bands = useMemo<Box[]>(() => points.map(([x, z]) => ({ p: [x, 0.6, z], s: [0.54, 1.2, 0.54] })), [points])
  return (
    <group>
      <InstancedBoxes boxes={shafts} color="#e9ecef" roughness={0.85} />
      <InstancedBoxes boxes={bands} map={hazardStripes()} roughness={0.6} castShadow={false} />
    </group>
  )
}

/** ผนังรอบชั้นแบบตัดครึ่ง (สูง 1.2 ม.) ให้มองเห็นภายใน · gaps = ช่องประตูด้านหน้า [x เริ่ม, x จบ] */
export function CutawayWalls({ width, depth, gaps }: { width: number; depth: number; gaps: [number, number][] }) {
  const boxes = useMemo<Box[]>(() => {
    const h = 1.2
    const t = 0.2
    const list: Box[] = [
      { p: [width / 2, h / 2, -t / 2], s: [width + 2 * t, h, t] },
      { p: [-t / 2, h / 2, depth / 2], s: [t, h, depth] },
      { p: [width + t / 2, h / 2, depth / 2], s: [t, h, depth] },
    ]
    // ด้านหน้า: เว้นช่องประตู
    const sorted = [...gaps].sort((a, b) => a[0] - b[0])
    let from = -t
    for (const [a, b] of [...sorted, [width + t, width + t] as [number, number]]) {
      if (a - from > 0.1) list.push({ p: [(from + a) / 2, h / 2, depth + t / 2], s: [a - from, h, t] })
      from = Math.max(from, b)
    }
    return list
  }, [width, depth, gaps])
  const bases = useMemo<Box[]>(() => boxes.map((b) => ({ p: [b.p[0], 0.2, b.p[2]], s: [b.s[0] + 0.02, 0.4, b.s[2] + 0.02] })), [boxes])
  return (
    <group>
      <InstancedBoxes boxes={boxes} color={BRAND.siding} roughness={0.6} />
      <InstancedBoxes boxes={bases} color={BRAND.green} roughness={0.5} castShadow={false} />
    </group>
  )
}

/**
 * ขอบชั้นลอย: ราวกันตกสีเหลืองรอบพื้น (เว้นช่องหัวบันไดด้านหน้า) + เสาเหล็กรับพื้นลงไปถึงชั้นล่าง
 * drop = ระยะจากพื้นชั้นลอยลงไปถึงพื้นชั้นล่างในฉาก
 */
export function MezzanineEdge({ width, depth, drop, gaps }: { width: number; depth: number; drop: number; gaps: [number, number][] }) {
  const { rails, posts } = useMemo(() => {
    const rails: Box[] = []
    const posts: Box[] = []
    const run = (from: number, to: number, at: (u: number) => [number, number], alongX: boolean) => {
      const len = to - from
      if (len < 0.2) return
      const [cx, cz] = at((from + to) / 2)
      for (const y of [0.55, 1.1]) rails.push({ p: [cx, y, cz], s: alongX ? [len, 0.05, 0.05] : [0.05, 0.05, len] })
      const step = len / Math.ceil(len / 2)
      for (let u = from; u <= to + 1e-6; u += step) {
        const [x, z] = at(u)
        rails.push({ p: [x, 0.55, z], s: [0.05, 1.1, 0.05] })
      }
    }
    run(0, width, (u) => [u, 0.05], true)
    run(0, depth, (u) => [0.05, u], false)
    run(0, depth, (u) => [width - 0.05, u], false)
    let from = 0
    for (const [a, b] of [...[...gaps].sort((p, q) => p[0] - q[0]), [width, width] as [number, number]]) {
      run(from, a, (u) => [u, depth - 0.05], true)
      from = Math.max(from, b)
    }
    // เสารับพื้นทุก ~6 ม. ตามแนวขอบ + คานขอบใต้พื้น
    const n = Math.max(1, Math.round(width / 6))
    for (let i = 0; i <= n; i++) for (const z of [0.15, depth - 0.15]) posts.push({ p: [0.15 + ((width - 0.3) * i) / n, -drop / 2, z], s: [0.16, drop, 0.16] })
    for (const z of [0.08, depth - 0.08]) posts.push({ p: [width / 2, -0.15, z], s: [width, 0.3, 0.16] })
    return { rails, posts }
  }, [width, depth, drop, gaps])
  return (
    <group>
      <InstancedBoxes boxes={rails} color="#f2c200" metalness={0.2} roughness={0.5} castShadow={false} />
      <InstancedBoxes boxes={posts} color={STEEL} metalness={0.5} roughness={0.4} />
    </group>
  )
}

/** เส้นกรอบพื้นที่บนพื้น (สีตามมาตรฐาน 5S) */
export function ZoneOutline({ width, depth, color, thickness = 0.12, y = 0.02 }: { width: number; depth: number; color: string; thickness?: number; y?: number }) {
  const t = thickness
  const strips: [number, number, number, number][] = [
    [width / 2, t / 2, width, t],
    [width / 2, depth - t / 2, width, t],
    [t / 2, depth / 2, t, depth],
    [width - t / 2, depth / 2, t, depth],
  ]
  return (
    <group position={[0, y, 0]}>
      {strips.map(([x, z, w, d], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0, z]}>
          <planeGeometry args={[w, d]} />
          <meshBasicMaterial color={color} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      ))}
    </group>
  )
}

/** ตัวอักษรพ่นบนพื้น */
export function FloorText({ text, position, width = 4, color = '#ffffff', rotation = 0 }: { text: string; position: [number, number, number]; width?: number; color?: string; rotation?: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, rotation]} position={position}>
      <planeGeometry args={[width, width / 4]} />
      <meshBasicMaterial map={textLabel(text, color)} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-3} />
    </mesh>
  )
}

/** ป้ายแขวน/ป้ายติดหัว rack (2 หน้า) */
function SignBoard({ text, position, width = 2.4, background = BRAND.primary }: { text: string; position: [number, number, number]; width?: number; background?: string }) {
  return (
    <mesh position={position}>
      <planeGeometry args={[width, width / 4]} />
      <meshBasicMaterial map={textLabel(text, '#ffffff', background)} side={DoubleSide} />
    </mesh>
  )
}

/* ------------------------------------------------------------------ ชั้นวางพาเลท */

/**
 * Selective pallet rack: เสาน้ำเงิน คานส้ม 3 ระดับ
 * พาเลทที่วางจริงคำนวณจากยอดคงคลังในโซน (สีตาม Model) — ถ้าเกินจำนวนช่องจะแสดงพาเลทล้นที่ทางเดิน
 */
/** กรอบไฮไลต์พาเลท: ค้นหาเจอ = ฟ้า, กำลังเลือก = ส้ม */
const HIGHLIGHT = { lot: '#1d8cf8', selected: '#f97316' }

export const PalletRack = memo(function PalletRack({
  zoneId,
  width,
  depth,
  code,
  stock,
  highlightLot,
  selectedIndex,
  levels = RACK.levels,
  height = RACK.height,
}: {
  zoneId: string
  width: number
  depth: number
  code: string
  /** ระดับชั้นวาง/ความสูง rack (ใต้หรือบนชั้นลอยเตี้ยกว่าปกติ) */
  levels?: readonly number[]
  height?: number
  stock?: ZoneContents
  /** lot ที่ค้นหาเจอ — ไฮไลต์ทุกพาเลทของ lot นี้ */
  highlightLot?: string | null
  /** พาเลทที่กำลังดูรายละเอียด (ลำดับใน palletsFor) */
  selectedIndex?: number | null
}) {
  const plan = useMemo(() => planRack(width, depth, levels), [width, depth, levels])
  const pallets = useMemo(() => palletsFor(stock), [stock])
  const { frame, beams, guards, bases, loads } = useMemo(() => {
    const frame: Box[] = []
    const beams: Box[] = []
    const guards: Box[] = []
    const bays = plan.bays
    for (const row of plan.rows) {
      const rowDepth = row.units * RACK.singleDepth
      const faces = [row.offset + 0.05, row.offset + rowDepth - 0.05]
      for (let b = 0; b <= bays; b++) {
        const u = plan.start + b * RACK.bayLength
        for (const v of faces) frame.push({ p: [u, height / 2, v], s: [0.09, height, 0.09] })
        if (row.units === 2) frame.push({ p: [u, height / 2, row.offset + rowDepth / 2], s: [0.09, height, 0.09] })
        // ค้ำยันแนวลึก
        for (const y of [0.4, 2.0, 3.6].filter((y) => y < height - 0.2)) frame.push({ p: [u, y, row.offset + rowDepth / 2], s: [0.05, 0.05, rowDepth - 0.1] })
      }
      for (let b = 0; b < bays; b++) {
        const u = plan.start + (b + 0.5) * RACK.bayLength
        for (const y of [...levels.slice(1).map((l) => l - 0.07), height - 0.1])
          for (const v of faces) beams.push({ p: [u, y, v], s: [RACK.bayLength - 0.1, 0.12, 0.06] })
      }
      // กันชนสีเหลืองที่หัว-ท้ายแถว
      for (const u of [plan.start - 0.25, plan.start + bays * RACK.bayLength + 0.25]) guards.push({ p: [u, 0.25, row.offset + rowDepth / 2], s: [0.15, 0.5, rowDepth] })
    }

    const bases: Box[] = []
    const loads: Box[] = []
    const slots = plan.slots
    pallets.forEach((p, i) => {
      const color = modelColor(p.model)
      if (i < slots.length) {
        const s = slots[i]
        bases.push({ p: [s.u, s.y + 0.08, s.v], s: [1.1, 0.14, 1.0] })
        const h = RACK.palletLoadHeight - ((i * 7) % 4) * 0.08
        loads.push({ p: [s.u, s.y + 0.15 + h / 2, s.v], s: [1.02, h, 0.92], c: color })
      } else {
        // ล้นชั้นวาง: วางพักที่ทางเดินในโซน
        const k = i - slots.length
        const u = plan.start + 0.7 + (k % 10) * 1.3
        const v = (plan.rows[0]?.offset ?? 0) + RACK.singleDepth + 0.8 + Math.floor(k / 10) * 1.2
        bases.push({ p: [u, 0.08, v], s: [1.1, 0.14, 1.0] })
        loads.push({ p: [u, 0.65, v], s: [1.02, 1.0, 0.92], c: color })
      }
    })
    return { frame, beams, guards, bases, loads }
  }, [plan, pallets, height, levels])

  const marks = useMemo(() => {
    const lot: Box[] = []
    const selected: Box[] = []
    pallets.forEach((p, i) => {
      const load = loads[i]
      if (!load) return
      const box: Box = { p: [load.p[0], load.p[1], load.p[2]], s: [load.s[0] + 0.16, load.s[1] + 0.16, load.s[2] + 0.16] }
      if (i === selectedIndex) selected.push(box)
      else if (highlightLot && p.lotId === highlightLot) lot.push(box)
    })
    return { lot, selected }
  }, [pallets, loads, highlightLot, selectedIndex])

  return (
    <Oriented width={width} depth={depth}>
      {(length, span) => (
        <group>
          <InstancedBoxes boxes={frame} color={UPRIGHT} metalness={0.3} roughness={0.5} />
          <InstancedBoxes boxes={beams} color={BEAM} metalness={0.2} roughness={0.5} />
          <InstancedBoxes boxes={guards} color="#f2c200" castShadow={false} />
          <InstancedBoxes boxes={bases} color={WOOD} roughness={0.95} />
          <InstancedBoxes boxes={loads} roughness={0.7} pickable userData={{ palletZone: zoneId }} />
          <InstancedBoxes boxes={marks.lot} color={HIGHLIGHT.lot} opacity={0.45} castShadow={false} />
          <InstancedBoxes boxes={marks.selected} color={HIGHLIGHT.selected} opacity={0.55} castShadow={false} />
          {plan.rows.map((row, i) => (
            <SignBoard
              key={i}
              text={`${code}-${i + 1}`}
              width={1.6}
              position={[plan.start - 0.05, height < RACK.height ? height - 0.3 : height + 0.35, row.offset + (row.units * RACK.singleDepth) / 2]}
              background={UPRIGHT}
            />
          ))}
          {/* ชื่อโซนพ่นบนทางเดินในโซน */}
          {plan.rows.length > 1 && (
            <FloorText text={code} width={Math.min(4, length / 3)} position={[length / 2, 0.03, plan.rows[0].offset + RACK.singleDepth + RACK.aisle / 2]} />
          )}
          {plan.rows.length <= 1 && <FloorText text={code} width={Math.min(3, length / 3)} position={[length / 2, 0.03, Math.min(span - 0.5, 2)]} />}
        </group>
      )}
    </Oriented>
  )
})

/* ------------------------------------------------------------------ ไลน์ประกอบวงล้อ */

/** สายพาน + ล้อบนสายพาน + โต๊ะงานสองฝั่ง + พนักงาน + Andon */
export const AssemblyLine = memo(function AssemblyLine({ width, depth, title }: { width: number; depth: number; title: string }) {
  return (
    <Oriented width={width} depth={depth}>
      {(length, span) => <LineBody length={length} span={span} title={title} />}
    </Oriented>
  )
})

function LineBody({ length, span, title }: { length: number; span: number; title: string }) {
  const mid = span / 2
  const beltLen = Math.max(length - 3, 2)
  const u0 = 1.5
  const { frame, tables, bins, stations } = useMemo(() => {
    const frame: Box[] = [
      { p: [u0 + beltLen / 2, 0.82, mid - 0.42], s: [beltLen, 0.14, 0.06] },
      { p: [u0 + beltLen / 2, 0.82, mid + 0.42], s: [beltLen, 0.14, 0.06] },
    ]
    for (let u = u0 + 0.3; u <= u0 + beltLen; u += 2) for (const dv of [-0.4, 0.4]) frame.push({ p: [u, 0.4, mid + dv], s: [0.06, 0.8, 0.06] })
    const tables: Box[] = []
    const bins: Box[] = []
    const stations: [number, number][] = []
    // กล่องใส่ part สีเทา-น้ำเงิน (ไม่ใช้สีเดียวกับสี Model บนพาเลท)
    const binColors = ['#3d5a80', '#56708c', '#6b7f95']
    for (let u = u0 + 1.2, k = 0; u < u0 + beltLen - 0.6; u += 3, k++)
      for (const side of [-1, 1]) {
        const v = mid + side * 1.35
        if (v < 0.4 || v > span - 0.4) continue
        tables.push({ p: [u, 0.85, v], s: [1.5, 0.05, 0.7] })
        for (const du of [-0.68, 0.68]) for (const dv of [-0.3, 0.3]) tables.push({ p: [u + du, 0.42, v + dv], s: [0.05, 0.84, 0.05] })
        for (let b = 0; b < 3; b++) bins.push({ p: [u - 0.45 + b * 0.45, 0.95, v + side * 0.18], s: [0.36, 0.16, 0.26], c: binColors[(b + k) % binColors.length] })
        stations.push([u, mid + side * 2.05])
      }
    return { frame, tables, bins, stations }
  }, [beltLen, mid, span])
  const wheels = useMemo(() => {
    const list: number[] = []
    for (let u = u0 + 0.8; u < u0 + beltLen - 0.4; u += 1.6) list.push(u)
    return list
  }, [beltLen])

  return (
    <group>
      {/* สายพาน */}
      <mesh position={[u0 + beltLen / 2, 0.86, mid]} receiveShadow castShadow>
        <boxGeometry args={[beltLen, 0.05, 0.78]} />
        <meshStandardMaterial color="#2b2f36" roughness={0.9} />
      </mesh>
      <InstancedBoxes boxes={frame} color={STEEL} metalness={0.5} roughness={0.4} />
      <InstancedBoxes boxes={tables} color="#7d8b99" metalness={0.3} roughness={0.5} />
      <InstancedBoxes boxes={bins} roughness={0.6} castShadow={false} />
      {wheels.map((u) => (
        <Wheel key={u} position={[u, 1.2, mid]} />
      ))}
      {stations.map(([u, v], i) => (
        <Worker key={i} position={[u, 0, v]} facing={v > mid ? Math.PI : 0} />
      ))}
      {/* Andon ปลายไลน์ */}
      <group position={[u0 + beltLen + 0.6, 0, mid + 0.8]}>
        <mesh position={[0, 1.1, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 2.2, 8]} />
          <meshStandardMaterial color={STEEL} metalness={0.6} />
        </mesh>
        {[
          ['#e34948', 0],
          ['#eda100', 0],
          ['#2bd67b', 1.4],
        ].map(([c, glow], i) => (
          <mesh key={i} position={[0, 2.25 + i * 0.14, 0]}>
            <cylinderGeometry args={[0.07, 0.07, 0.12, 12]} />
            <meshStandardMaterial color={c as string} emissive={c as string} emissiveIntensity={glow as number} />
          </mesh>
        ))}
      </group>
      {/* รถเข็นวางล้อที่ประกอบเสร็จ ปลายไลน์ */}
      {span >= 4 && (
        <group position={[length - 0.9, 0, Math.max(mid - 2.2, 0.6)]}>
          <InstancedBoxes
            boxes={[
              { p: [0, 0.2, 0], s: [1.2, 0.05, 0.7] },
              { p: [-0.58, 0.85, 0], s: [0.04, 1.3, 0.04] },
              { p: [0.58, 0.85, 0], s: [0.04, 1.3, 0.04] },
              { p: [0, 1.5, 0], s: [1.2, 0.04, 0.04] },
            ]}
            color={STEEL}
            metalness={0.5}
          />
          {[-0.35, 0, 0.35].map((dx) => (
            <group key={dx} position={[dx, 0.85, 0]} rotation={[0, Math.PI / 2, 0]}>
              <Wheel position={[0, 0, 0]} />
            </group>
          ))}
        </group>
      )}
      {/* ป้ายชื่อไลน์แขวน */}
      <SignBoard text={title} width={Math.min(5, length * 0.4)} position={[length / 2, 3.4, mid]} />
      {[-1, 1].map((s) => (
        <mesh key={s} position={[length / 2 + (s * Math.min(5, length * 0.4)) / 2.4, 3.95, mid]}>
          <cylinderGeometry args={[0.01, 0.01, 0.8, 4]} />
          <meshBasicMaterial color="#555" />
        </mesh>
      ))}
    </group>
  )
}

/** วงล้อซี่ลวด: ขอบล้อ + ดุม + ซี่ */
function Wheel({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow>
        <torusGeometry args={[0.31, 0.025, 8, 28]} />
        <meshStandardMaterial color="#c9ced4" metalness={0.85} roughness={0.25} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.16, 12]} />
        <meshStandardMaterial color="#3d4248" metalness={0.6} roughness={0.4} />
      </mesh>
      {[0, 1, 2, 3].map((k) => (
        <mesh key={k} rotation={[0, 0, (k * Math.PI) / 4]}>
          <boxGeometry args={[0.6, 0.008, 0.008]} />
          <meshStandardMaterial color="#d7dbe0" metalness={0.9} roughness={0.3} />
        </mesh>
      ))}
    </group>
  )
}

/** พนักงานแบบเรียบง่าย: เสื้อช็อปน้ำเงิน หมวกขาว */
export function Worker({ position, facing = 0, vest = BRAND.primary }: { position: [number, number, number]; facing?: number; vest?: string }) {
  return (
    <group position={position} rotation={[0, facing, 0]}>
      <mesh position={[0, 0.42, 0]} castShadow>
        <boxGeometry args={[0.32, 0.84, 0.2]} />
        <meshStandardMaterial color="#2f3540" />
      </mesh>
      <mesh position={[0, 1.18, 0]} castShadow>
        <capsuleGeometry args={[0.2, 0.36, 4, 8]} />
        <meshStandardMaterial color={vest} />
      </mesh>
      <mesh position={[0, 1.65, 0]}>
        <sphereGeometry args={[0.13, 12, 10]} />
        <meshStandardMaterial color="#c99f7e" />
      </mesh>
      <mesh position={[0, 1.74, 0]}>
        <sphereGeometry args={[0.14, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#f4f6f8" />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ บันได ลิฟต์ จุดรับเข้า */

export function Stairs({ width, depth, rise }: { width: number; depth: number; rise: number }) {
  const steps = useMemo<Box[]>(() => {
    const n = 18
    const run = (depth - 1.2) / n
    return Array.from({ length: n }, (_, i) => ({ p: [width / 2, ((i + 1) * rise) / n / 2, depth - 1.2 - (i + 0.5) * run], s: [width - 0.4, ((i + 1) * rise) / n, run] }))
  }, [width, depth, rise])
  return (
    <group>
      <InstancedBoxes boxes={steps} color="#b9c0c8" roughness={0.9} />
      {[0.2, width - 0.2].map((x) => (
        <mesh key={x} position={[x, rise / 2 + 0.5, (depth - 1.2) / 2]} rotation={[Math.atan2(rise, depth - 1.2), 0, 0]}>
          <boxGeometry args={[0.06, 0.06, Math.hypot(rise, depth - 1.2)]} />
          <meshStandardMaterial color="#f2c200" />
        </mesh>
      ))}
    </group>
  )
}

export function Lift({ width, depth, height }: { width: number; depth: number; height: number }) {
  const posts = useMemo<Box[]>(
    () =>
      [
        [0.1, 0.1],
        [width - 0.1, 0.1],
        [0.1, depth - 0.1],
        [width - 0.1, depth - 0.1],
      ].map(([x, z]) => ({ p: [x, height / 2, z], s: [0.14, height, 0.14] })),
    [width, depth, height],
  )
  return (
    <group>
      <InstancedBoxes boxes={posts} color={STEEL} metalness={0.5} />
      <mesh position={[width / 2, height / 2, depth / 2]}>
        <boxGeometry args={[width - 0.1, height, depth - 0.1]} />
        <meshStandardMaterial color="#9fb3c8" transparent opacity={0.25} metalness={0.3} depthWrite={false} />
      </mesh>
      <mesh position={[width / 2, 0.08, depth / 2]} receiveShadow>
        <boxGeometry args={[width - 0.3, 0.16, depth - 0.3]} />
        <meshStandardMaterial color="#6c7480" metalness={0.4} />
      </mesh>
      {/* กรอบประตูเหลือง-ดำด้านทางเดิน */}
      <mesh position={[0.02, 1.25, depth / 2]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[depth - 0.6, 2.5]} />
        <meshStandardMaterial map={hazardStripes()} side={DoubleSide} transparent opacity={0.9} />
      </mesh>
      <SignBoard text="LIFT" width={1.4} position={[width / 2, height + 0.3, depth / 2]} />
    </group>
  )
}

/** จุดรับเข้า: พื้นที่พักสินค้า + พาเลทกล่องที่รอนับ */
export const ReceivingArea = memo(function ReceivingArea({ width, depth }: { width: number; depth: number }) {
  const { bases, loads } = useMemo(() => {
    const bases: Box[] = []
    const loads: Box[] = []
    let k = 0
    for (let x = 1; x + 1.1 <= width - 1; x += 1.6)
      for (let z = 0.8; z + 1 <= depth; z += 1.4) {
        if ((k++ * 5) % 7 > 3) continue
        bases.push({ p: [x + 0.55, 0.08, z + 0.5], s: [1.1, 0.14, 1.0] })
        const h = 0.6 + ((k * 3) % 5) * 0.12
        loads.push({ p: [x + 0.55, 0.15 + h / 2, z + 0.5], s: [1.0, h, 0.9] })
      }
    return { bases, loads }
  }, [width, depth])
  return (
    <group>
      <InstancedBoxes boxes={bases} color={WOOD} />
      <InstancedBoxes boxes={loads} color="#c49a6c" roughness={0.9} />
      <FloorText text="RECEIVING" color="#f2c200" width={Math.min(5, width / 2.5)} position={[width / 2, 0.03, depth - 0.45]} />
    </group>
  )
})

/** พื้นที่ตรวจ MI3: โต๊ะตรวจ + พนักงาน QC + พาเลทรอตรวจ (เส้นส้ม = รอตรวจ/กักกัน ตาม 5S) */
export const InspectionArea = memo(function InspectionArea({ width, depth }: { width: number; depth: number }) {
  const { tables, waiting } = useMemo(() => {
    const tables: Box[] = []
    const waiting: Box[] = []
    const n = Math.max(1, Math.floor((width - 1) / 2.6))
    for (let i = 0; i < n; i++) {
      const x = 1.3 + i * 2.6
      tables.push({ p: [x, 0.88, 1.4], s: [1.8, 0.06, 0.9] })
      for (const dx of [-0.8, 0.8]) for (const dz of [-0.35, 0.35]) tables.push({ p: [x + dx, 0.43, 1.4 + dz], s: [0.06, 0.86, 0.06] })
      waiting.push({ p: [x, 0.08, depth - 1.2], s: [1.1, 0.14, 1.0] })
    }
    return { tables, waiting, n }
  }, [width, depth])
  return (
    <group>
      <InstancedBoxes boxes={tables} color="#cfd6de" metalness={0.3} roughness={0.4} />
      <InstancedBoxes boxes={waiting} color={WOOD} />
      <InstancedBoxes boxes={waiting.map((b) => ({ p: [b.p[0], 0.6, b.p[2]], s: [1.0, 0.9, 0.9] }))} color="#c49a6c" roughness={0.9} />
      {tables.filter((_, i) => i % 5 === 0).map((t, i) => (
        <Worker key={i} position={[t.p[0], 0, 2.35]} facing={Math.PI} vest="#f07c1b" />
      ))}
      <FloorText text="MI3 QC" color="#f07c1b" width={Math.min(3.5, width / 2.5)} position={[width / 2, 0.03, depth / 2 + 0.6]} />
    </group>
  )
})

/** พื้นที่กัก NG: กรงตาข่าย + พาเลทติดป้ายแดง (เส้นแดง = ของเสีย/กักกัน ตาม 5S) */
export const NgArea = memo(function NgArea({ width, depth }: { width: number; depth: number }) {
  const { posts, pallets } = useMemo(() => {
    const posts: Box[] = []
    for (let x = 0.1; x <= width - 0.05; x += Math.max((width - 0.2) / Math.ceil(width / 2), 0.5))
      for (const z of [0.1, depth - 0.1]) posts.push({ p: [x, 0.9, z], s: [0.06, 1.8, 0.06] })
    for (let z = 0.1; z <= depth - 0.05; z += Math.max((depth - 0.2) / Math.ceil(depth / 2), 0.5))
      for (const x of [0.1, width - 0.1]) posts.push({ p: [x, 0.9, z], s: [0.06, 1.8, 0.06] })
    const pallets: Box[] = []
    for (let x = 1; x + 1.1 <= width - 0.6; x += 1.6) pallets.push({ p: [x + 0.55, 0.5, depth / 2], s: [1.0, 0.75, 0.9] })
    return { posts, pallets }
  }, [width, depth])
  return (
    <group>
      <InstancedBoxes boxes={posts} color="#4a4f57" metalness={0.5} />
      {[
        [width / 2, 0.15, width],
        [width / 2, depth - 0.15, width],
      ].map(([x, z, len], i) => (
        <mesh key={i} position={[x, 1.0, z]}>
          <planeGeometry args={[len - 0.2, 1.6]} />
          <meshStandardMaterial color="#9aa3ad" transparent opacity={0.35} side={DoubleSide} depthWrite={false} />
        </mesh>
      ))}
      <InstancedBoxes boxes={pallets} color="#e34948" roughness={0.8} />
      <SignBoard text="NG HOLD" width={2} position={[width / 2, 2.2, 0.1]} background="#c62828" />
    </group>
  )
})

/** ที่ชาร์จรถยกและกองพาเลทเปล่า */
export const UtilityArea = memo(function UtilityArea({ width, depth }: { width: number; depth: number }) {
  const stacks = useMemo<Box[]>(() => {
    const list: Box[] = []
    for (let x = width / 2 + 0.8; x + 1.1 <= width - 0.3; x += 1.4) for (let k = 0; k < 8; k++) list.push({ p: [x + 0.55, 0.08 + k * 0.15, depth - 1.0], s: [1.1, 0.13, 1.0] })
    return list
  }, [width, depth])
  return (
    <group>
      {[1.2, 3.0].filter((x) => x < width / 2).map((x) => (
        <group key={x}>
          <mesh position={[x, 0.7, 0.4]} castShadow>
            <boxGeometry args={[0.8, 1.4, 0.5]} />
            <meshStandardMaterial color="#d9dee4" metalness={0.3} />
          </mesh>
          <mesh position={[x, 1.1, 0.66]}>
            <planeGeometry args={[0.3, 0.12]} />
            <meshBasicMaterial color="#2bd67b" />
          </mesh>
          <Forklift position={[x, 0, 2.6]} rotation={Math.PI / 2} />
        </group>
      ))}
      <InstancedBoxes boxes={stacks} color={WOOD} roughness={0.95} />
      <FloorText text="CHARGING" color="#f2c200" width={Math.min(3, width / 3)} position={[width / 4, 0.03, depth - 0.5]} />
    </group>
  )
})

/* ------------------------------------------------------------------ ยานพาหนะ */

/** รถยก (forklift) สีเหลือง วางหันตามแกน +x */
export function Forklift({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[1.6, 0.7, 1.05]} />
        <meshStandardMaterial color="#f2b705" roughness={0.5} />
      </mesh>
      <mesh position={[-0.55, 0.75, 0]} castShadow>
        <boxGeometry args={[0.5, 0.6, 1.0]} />
        <meshStandardMaterial color="#3a3f47" />
      </mesh>
      {/* หลังคาป้องกันผู้ขับ */}
      {[
        [-0.5, -0.45],
        [-0.5, 0.45],
        [0.35, -0.45],
        [0.35, 0.45],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 1.45, z]}>
          <boxGeometry args={[0.06, 1.1, 0.06]} />
          <meshStandardMaterial color="#2b2f36" />
        </mesh>
      ))}
      <mesh position={[-0.07, 2.0, 0]}>
        <boxGeometry args={[0.95, 0.06, 1.0]} />
        <meshStandardMaterial color="#2b2f36" />
      </mesh>
      {/* เสายกและงา */}
      <mesh position={[0.9, 1.15, 0]} castShadow>
        <boxGeometry args={[0.1, 2.3, 0.8]} />
        <meshStandardMaterial color="#4a4f57" metalness={0.5} />
      </mesh>
      {[-0.28, 0.28].map((z) => (
        <mesh key={z} position={[1.5, 0.12, z]}>
          <boxGeometry args={[1.1, 0.05, 0.12]} />
          <meshStandardMaterial color="#2b2f36" metalness={0.6} />
        </mesh>
      ))}
      {[
        [0.5, 0.55],
        [0.5, -0.55],
        [-0.55, 0.55],
        [-0.55, -0.55],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.25, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.25, 0.25, 0.2, 14]} />
          <meshStandardMaterial color="#1d1f22" />
        </mesh>
      ))}
    </group>
  )
}

/** รถบรรทุก 6 ล้อส่งของ หันหน้าไปทาง +x */
export function Truck({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[-0.8, 1.75, 0]} castShadow receiveShadow>
        <boxGeometry args={[4.8, 2.4, 2.3]} />
        <meshStandardMaterial color="#f4f6f8" roughness={0.5} />
      </mesh>
      <mesh position={[-0.8, 1.0, 1.16]}>
        <planeGeometry args={[4.8, 0.25]} />
        <meshBasicMaterial color={BRAND.roofBlue} />
      </mesh>
      <mesh position={[2.45, 1.3, 0]} castShadow>
        <boxGeometry args={[1.5, 1.9, 2.2]} />
        <meshStandardMaterial color={BRAND.trimBlue} roughness={0.4} />
      </mesh>
      <mesh position={[3.21, 1.65, 0]}>
        <boxGeometry args={[0.02, 0.8, 1.9]} />
        <meshStandardMaterial color="#25364a" metalness={0.6} roughness={0.15} />
      </mesh>
      {[-2.4, -1.3, 2.4].map((x) =>
        [-1.05, 1.05].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.45, z]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.45, 0.45, 0.3, 16]} />
            <meshStandardMaterial color="#1d1f22" />
          </mesh>
        )),
      )}
    </group>
  )
}

/** รถลากพาเลทมือ (hand pallet truck) ใช้บนชั้น 2-3 */
export function PalletJack({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[-0.27, 0.27].map((z) => (
        <mesh key={z} position={[0.55, 0.06, z]}>
          <boxGeometry args={[1.15, 0.08, 0.16]} />
          <meshStandardMaterial color="#e34948" metalness={0.3} />
        </mesh>
      ))}
      <mesh position={[-0.1, 0.35, 0]}>
        <boxGeometry args={[0.2, 0.5, 0.5]} />
        <meshStandardMaterial color="#e34948" metalness={0.3} />
      </mesh>
      <mesh position={[-0.35, 0.8, 0]} rotation={[0, 0, 0.35]}>
        <boxGeometry args={[0.04, 1.1, 0.04]} />
        <meshStandardMaterial color="#2b2f36" />
      </mesh>
    </group>
  )
}

/** ทางเดินลานนอก: แถบเขียวขอบขาว (พิกัด site) — วาดขอบขาวทั้งหมดก่อนแล้วทับด้วยสีเขียว รอยต่อจึงเรียบ */
export function YardWalkway({ segments, width = 2 }: { segments: [number, number, number, number][]; width?: number }) {
  const strips = segments.map(([ax, az, bx, bz]) => ({
    x: (ax + bx) / 2,
    z: (az + bz) / 2,
    len: Math.hypot(bx - ax, bz - az),
    rot: -Math.atan2(bz - az, bx - ax),
  }))
  return (
    <group>
      {[
        { color: '#f4f6f8', grow: 0.3, y: 0.04, offset: -1 },
        { color: BRAND.green, grow: 0, y: 0.05, offset: -2 },
      ].map((layer) =>
        strips.map((s, i) => (
          <mesh key={`${layer.color}-${i}`} position={[s.x, layer.y, s.z]} rotation={[-Math.PI / 2, 0, s.rot]} receiveShadow>
            <planeGeometry args={[s.len + width + layer.grow, width + layer.grow]} />
            <meshStandardMaterial color={layer.color} roughness={0.5} polygonOffset polygonOffsetFactor={layer.offset} />
          </mesh>
        )),
      )}
    </group>
  )
}
