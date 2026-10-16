import { Html, Line, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { type Group, type PerspectiveCamera, Plane, Raycaster, Shape, Vector2, Vector3 } from 'three'
import { BRAND, MATERIAL } from '../data/brand'
import { GATES_WITH_SHRINE, MAIN_BUILDING_FLOOR_ID, TENT_STYLE, TREE_POINTS, TRUCK_YARD } from '../data/siteAppearance'
import { palletsFor, storagePlan } from '../data/warehouse'
import { ZONE_STYLE } from '../data/zoneStyle'
import { buildingOf, toLocal, toRadians, toSite, zoneClearance } from '../lib/geometry'
import { floorPaint, type FloorPaint } from '../lib/floorPlan'
import { clampToFloor, isEditable, pointInRect, rectsOverlap, snap, type ZonePatch } from '../lib/layoutEdit'
import type { RouteResult } from '../lib/pathfinding'
import type { ZoneContents } from '../inventory/reports'
import type { FactoryLayout, Floor, Landmark, Zone } from '../types/layout'
import { BuildingA } from './models/BuildingA'
import {
  AssemblyLine,
  Columns,
  CutawayWalls,
  FloorPlate,
  Forklift,
  Lift,
  InspectionArea,
  MezzanineEdge,
  NgArea,
  PalletJack,
  PalletRack,
  ReceivingArea,
  Stairs,
  Truck,
  UtilityArea,
  YardWalkway,
  ZoneOutline,
} from './models/Interior'
import { ArchTent, Canteen, Carport, OfficeBuilding, PavedArea, Road, SiteGround, Trees, TruckGate, TruckYard, TwinGableTent, Warehouse } from './models/SiteModels'

export type ViewMode = 'exterior' | 'interior'

interface Props {
  layout: FactoryLayout
  /** exterior = โมเดลอาคารสมจริง, interior = เปิดดูผังภายในแต่ละชั้น */
  mode: ViewMode
  /** ระยะห่างระหว่างชั้นที่ใช้แสดงผลในโหมดภายใน (คูณกับความสูงจริง) */
  explode: number
  hiddenFloors: Set<string>
  selectedZoneIds: string[]
  route: RouteResult | null
  onZoneClick: (zone: Zone) => void
  /** คลิกอาคารหลักในโหมดภายนอก */
  onBuildingClick?: () => void
  /** มองจากด้านบน (ใช้เทียบกับภาพดาวเทียม) */
  topView?: boolean
  /** false = หน้าผังถูกซ่อนอยู่ หยุดวาดภาพเพื่อประหยัดเครื่อง */
  active?: boolean
  /** แสดงถนน ต้นไม้ และพื้นที่รอบโรงงาน (ปิดไว้เป็นค่าเริ่มต้นเพื่อให้ผังไม่รก) */
  showSurroundings?: boolean
  /** ของในแต่ละโซน — ใช้วางพาเลทบนชั้นวางตามยอดจริง สีตาม Model */
  zoneStock?: Map<string, ZoneContents>
  /** โหมดแก้ไขผัง: ลาก rack / ไลน์ประกอบ / จุดรับเข้า ไปวางตำแหน่งใหม่ */
  editMode?: boolean
  editZoneId?: string | null
  onZoneChange?: (zoneId: string, patch: ZonePatch) => void
  /** ไฮไลต์ทุกพาเลทของ lot ที่ค้นหาเจอ */
  highlightLot?: string | null
  /** พาเลทที่กำลังดูรายละเอียด */
  selectedPallet?: { zoneId: string; index: number } | null
  onPalletClick?: (zoneId: string, index: number) => void
  /** หมุดบนผัง (ผลค้นหา, lot รอคัด MI3) */
  pins?: MapPinSpec[]
  /** คำสั่งกล้องจากปุ่มบนจอ / ค้นหา (เปลี่ยน n เพื่อสั่งซ้ำ) */
  cameraCommand?: CameraCommand | null
  /** แผงลอยบังด้านขวาของจอกี่พิกเซล — เลื่อนจุดที่บินไปให้อยู่กลางพื้นที่ที่มองเห็น */
  focusShiftPx?: number
}

export type CameraCommand = { n: number } & (
  | { kind: 'zoomIn' | 'zoomOut' | 'rotateLeft' | 'rotateRight' | 'home' }
  | { kind: 'focus'; zoneId: string }
)

export interface MapPinSpec {
  zoneId: string
  tone: 'search' | 'qc'
}

/** ยกพื้นชั้นในโหมดภายในขึ้นเล็กน้อย ไม่ให้ซ้อนกับพื้นลาน */
const FLOOR_LIFT = 0.12

const CAMERA: Record<ViewMode | 'top', [number, number, number]> = {
  exterior: [28, 88, 150],
  interior: [90, 130, 160],
  top: [0, 260, 0.01],
}

/** สลับมุมกล้องโดยไม่ต้องสร้างฉากใหม่ */
function CameraRig({ view }: { view: keyof typeof CAMERA }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { target: { set: (x: number, y: number, z: number) => void }; update: () => void } | null
  useEffect(() => {
    camera.position.set(...CAMERA[view])
    controls?.target.set(0, view === 'top' ? 0 : 5, 0)
    controls?.update()
  }, [camera, controls, view])
  return null
}

type Orbit = { target: Vector3; update: () => void }

/** เลื่อนกล้องแบบนุ่มนวลตามคำสั่ง (ซูม หมุน กลับมุมเริ่มต้น บินไปหาโซน) */
function CameraAnimator({
  command,
  view,
  points,
  shiftPx,
}: {
  command: CameraCommand | null
  view: keyof typeof CAMERA
  points: Map<string, Vector3>
  shiftPx: number
}) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const size = useThree((s) => s.size)
  const get = useThree((s) => s.get)
  const anim = useRef<{ fromPos: Vector3; toPos: Vector3; fromT: Vector3; toT: Vector3; t0: number } | null>(null)
  const lastN = useRef(-1)
  const pointsRef = useRef(points)
  useEffect(() => {
    pointsRef.current = points
  }, [points])

  useEffect(() => {
    const controls = get().controls as unknown as Orbit | null
    if (!command || !controls || command.n === lastN.current) return
    lastN.current = command.n
    const fromT = controls.target.clone()
    const fromPos = camera.position.clone()
    const offset = fromPos.clone().sub(fromT)
    let toT = fromT.clone()
    let toPos: Vector3
    switch (command.kind) {
      case 'zoomIn':
        toPos = fromT.clone().add(offset.multiplyScalar(offset.length() * 0.6 < 10 ? 1 : 0.6))
        break
      case 'zoomOut':
        toPos = fromT.clone().add(offset.multiplyScalar(offset.length() * 1.6 > 600 ? 1 : 1.6))
        break
      case 'rotateLeft':
      case 'rotateRight':
        toPos = fromT.clone().add(offset.applyAxisAngle(new Vector3(0, 1, 0), command.kind === 'rotateLeft' ? Math.PI / 4 : -Math.PI / 4))
        break
      case 'home':
        toPos = new Vector3(...CAMERA[view])
        toT = new Vector3(0, view === 'top' ? 0 : 5, 0)
        break
      case 'focus': {
        const p = pointsRef.current.get(command.zoneId)
        if (!p) return
        const dir = offset.normalize()
        if (dir.y < 0.55) dir.setY(0.55).normalize()
        toT = p.clone()
        toPos = p.clone().add(dir.multiplyScalar(58))
        // เลื่อนกล้องไปทางขวา (วัตถุจะไปอยู่ซ้าย) เท่ากับครึ่งหนึ่งของพื้นที่ที่แผงลอยบัง
        if (shiftPx > 0 && size.width > 0) {
          const distance = toPos.distanceTo(toT)
          const halfWidth = distance * Math.tan((camera.fov * Math.PI) / 360) * (size.width / size.height)
          const forward = toT.clone().sub(toPos).normalize()
          const right = forward.cross(new Vector3(0, 1, 0)).normalize()
          const shift = right.multiplyScalar((shiftPx / (size.width / 2)) * halfWidth)
          toT.add(shift)
          toPos.add(shift)
        }
        break
      }
    }
    anim.current = { fromPos, toPos, fromT, toT, t0: performance.now() }
  }, [command, camera, get, view, shiftPx, size])

  useFrame(() => {
    const a = anim.current
    const controls = get().controls as unknown as Orbit | null
    if (!a || !controls) return
    const t = Math.min(1, (performance.now() - a.t0) / 700)
    const k = 1 - (1 - t) ** 3
    camera.position.lerpVectors(a.fromPos, a.toPos, k)
    controls.target.lerpVectors(a.fromT, a.toT, k)
    controls.update()
    if (t >= 1) anim.current = null
  })
  return null
}

/** หมุดชี้ตำแหน่งลอยขึ้นลงเบา ๆ: ฟ้า = ผลค้นหา, ส้ม = lot รอคัด MI3 */
function MapPin({ position, tone }: { position: Vector3; tone: MapPinSpec['tone'] }) {
  const ref = useRef<Group>(null)
  const color = tone === 'search' ? '#1d6fe0' : '#f59e0b'
  const size = tone === 'search' ? 1.4 : 0.9
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = position.y + Math.sin(clock.elapsedTime * 2.4) * 0.35
  })
  return (
    <group ref={ref} position={position.toArray()} scale={size}>
      <mesh position={[0, 2.6, 0]} castShadow>
        <sphereGeometry args={[1, 28, 20]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.1} />
      </mesh>
      <mesh position={[0, 1.3, 0]} rotation={[Math.PI, 0, 0]} castShadow>
        <coneGeometry args={[0.86, 2, 28, 1, true]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.1} />
      </mesh>
      <mesh position={[0, 2.6, 0.62]}>
        <sphereGeometry args={[0.42, 20, 14]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  )
}

interface DragStart {
  zone: Zone
  floor: Floor
  /** ระยะจากมุมโซนถึงจุดที่กด (พิกัดชั้น) */
  dx: number
  dz: number
}

/** จุดที่เมาส์ชี้บนระนาบพื้นของชั้น (พิกัดภายในชั้น) */
function pointOnFloor(group: Group, ray: { intersectPlane: (p: Plane, t: Vector3) => Vector3 | null }): Vector3 | null {
  const y = group.getWorldPosition(new Vector3()).y
  const hit = ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -y), new Vector3())
  return hit ? group.worldToLocal(hit) : null
}

/** ลากโซนบนพื้น: ปิดการหมุนกล้องระหว่างลาก, ขยับทีละ 0.5 ม., ไม่ให้หลุดขอบชั้น */
function DragController({
  start,
  groups,
  onMove,
  onEnd,
}: {
  start: DragStart | null
  /** กลุ่มของแต่ละชั้น ใช้แปลงตำแหน่งเมาส์เป็นพิกัดชั้น */
  groups: RefObject<Map<string, Group>>
  onMove: (x: number, z: number) => void
  onEnd: (zoneId: string, x: number, z: number, moved: boolean) => void
}) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const get = useThree((s) => s.get)
  const last = useRef({ x: 0, z: 0 })

  useEffect(() => {
    if (start) last.current = { x: start.zone.x, z: start.zone.z }
  }, [start])

  useEffect(() => {
    const group = start && groups.current.get(start.floor.id)
    if (!start || !group) return
    const controls = get().controls as unknown as { enabled: boolean } | null
    if (controls) controls.enabled = false
    document.body.style.cursor = 'grabbing'
    const raycaster = new Raycaster()
    const ndc = new Vector2()
    const move = (e: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const local = pointOnFloor(group, raycaster.ray)
      if (!local) return
      const next = clampToFloor({ ...start.zone, x: snap(local.x - start.dx), z: snap(local.z - start.dz) }, start.floor)
      if (next.x !== last.current.x || next.z !== last.current.z) {
        last.current = { x: next.x, z: next.z }
        onMove(next.x, next.z)
      }
    }
    const up = () => onEnd(start.zone.id, last.current.x, last.current.z, last.current.x !== start.zone.x || last.current.z !== start.zone.z)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (controls) controls.enabled = true
      document.body.style.cursor = ''
    }
  }, [start, groups, camera, gl, get, onMove, onEnd])
  return null
}

export function FactoryScene(props: Props) {
  const {
    layout,
    mode,
    explode,
    hiddenFloors,
    selectedZoneIds,
    route,
    onZoneClick,
    onBuildingClick,
    topView,
    active = true,
    showSurroundings = false,
    zoneStock,
    editMode = false,
    editZoneId,
    onZoneChange,
    highlightLot,
    selectedPallet,
    onPalletClick,
    pins = NO_PINS,
    cameraCommand = null,
    focusShiftPx = 0,
  } = props
  const exterior = mode === 'exterior'
  const floorsById = new Map(layout.floors.map((f) => [f.id, f]))
  const floorY = (id: string) => (floorsById.get(id)?.elevation ?? 0) * (exterior ? 1 : explode)

  const center = useMemo(() => siteCenter(layout), [layout])
  /** จุดกึ่งกลางพื้นของแต่ละโซนในพิกัดฉาก — ใช้บินกล้องไปหาและปักหมุด */
  const zonePoints = useMemo(() => {
    const floors = new Map(layout.floors.map((f) => [f.id, f]))
    return new Map(
      layout.zones.map((zone) => {
        const floor = floors.get(zone.floorId)!
        const [x, z] = toSite(floor, zone.x + zone.width / 2, zone.z + zone.depth / 2)
        const y = floor.area !== 'building' ? 0 : floor.elevation * (exterior ? 1 : explode) + FLOOR_LIFT
        return [zone.id, new Vector3(x - center[0], y, z - center[1])]
      }),
    )
  }, [layout, exterior, explode, center])

  const mainFloor = floorsById.get(MAIN_BUILDING_FLOOR_ID)
  const buildingFloors = layout.floors.filter((f) => f.area === 'building')
  /** จำนวนชั้นเต็ม (ไม่นับชั้นลอย) ของแต่ละอาคาร — ใช้วาดตัวอาคารภายนอก */
  const storeysOf = (building: string) => buildingFloors.filter((f) => !f.mezzanine && buildingOf(f) === building).length
  /** อาคารต่อ (เช่น อาคาร F) วาดภายนอกจากชั้นล่างสุด + ส่วนเชื่อมหลังคากับอาคารหลัก */
  const annexes = useMemo(() => annexBuildings(layout.floors, MAIN_BUILDING_FLOOR_ID), [layout.floors])
  /** ชั้นลอยที่อยู่เหนือแต่ละชั้น (ซ่อนเสาของชั้นล่างใต้ชั้นลอย — ชั้นลอยมีเสารับของตัวเอง) */
  const mezzAbove = useMemo(
    () =>
      new Map(
        layout.floors.map((f) => [
          f.id,
          layout.floors.filter((m) => m.mezzanine && buildingOf(m) === buildingOf(f) && m.elevation > f.elevation && m.elevation < f.elevation + storeyHeight(layout.floors, f)),
        ]),
      ),
    [layout.floors],
  )
  const yardZones = layout.zones.filter((z) => floorsById.get(z.floorId)?.area === 'yard')

  // ---- ลากย้ายโซน
  const floorRefs = useRef(new Map<string, Group>())
  const [drag, setDrag] = useState<DragStart | null>(null)
  const [dragPos, setDragPos] = useState<{ x: number; z: number } | null>(null)
  const moveDrag = useCallback((x: number, z: number) => setDragPos({ x, z }), [])
  const endDrag = useCallback(
    (zoneId: string, x: number, z: number, moved: boolean) => {
      setDrag(null)
      setDragPos(null)
      if (moved) onZoneChange?.(zoneId, { x, z })
    },
    [onZoneChange],
  )
  const startDrag = (zone: Zone, floor: Floor, e: ThreeEvent<PointerEvent>) => {
    const group = floorRefs.current.get(floor.id)
    const local = group && pointOnFloor(group, e.ray)
    if (!local) return
    setDrag({ zone, floor, dx: local.x - zone.x, dz: local.z - zone.z })
  }
  /** โซนแยกตามชั้น (ระหว่างลากใช้ตำแหน่งชั่วคราว) */
  const zonesByFloor = useMemo(() => {
    const map = new Map<string, Zone[]>()
    for (const zone of layout.zones) {
      const shown = drag && dragPos && drag.zone.id === zone.id ? { ...zone, ...dragPos } : zone
      map.set(zone.floorId, [...(map.get(zone.floorId) ?? []), shown])
    }
    return map
  }, [layout.zones, drag, dragPos])

  const paints = useMemo(() => new Map(layout.floors.filter((f) => f.area === 'building').map((f) => [f.id, floorPaint(layout, f)])), [layout])
  const walkways = useMemo(() => yardWalkways(layout), [layout])
  const dock = useMemo(() => {
    const ground = layout.floors.find((f) => f.id === MAIN_BUILDING_FLOOR_ID)
    return ground && dockPosition(layout, ground)
  }, [layout])

  return (
    <Canvas camera={{ position: CAMERA.exterior, fov: 42, far: 2000 }} shadows="soft" frameloop={active ? 'always' : 'never'}>
      {/* ป้าย Html ตัวแรกของฉากไม่ถูกวาดเนื้อหา (พฤติกรรมของ drei Html ตอน mount พร้อมกันหลายตัว) จึงวางตัวเปล่าไว้ก่อน */}
      <Html className="pointer-events-none">
        <span />
      </Html>
      <CameraRig view={topView ? 'top' : mode} />
      <CameraAnimator command={cameraCommand} view={topView ? 'top' : mode} points={zonePoints} shiftPx={focusShiftPx} />
      <DragController start={drag} groups={floorRefs} onMove={moveDrag} onEnd={endDrag} />
      <color attach="background" args={[MATERIAL.sky]} />
      <fog attach="fog" args={[MATERIAL.sky, 320, 900]} />
      <hemisphereLight args={['#ffffff', '#b9b3a8', 1.05]} />
      <directionalLight
        position={[-90, 160, 110]}
        intensity={1.9}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-170}
        shadow-camera-right={170}
        shadow-camera-top={170}
        shadow-camera-bottom={-170}
        shadow-camera-far={500}
        shadow-bias={-0.0005}
      />
      <OrbitControls makeDefault target={[0, 5, 0]} maxPolarAngle={Math.PI / 2.1} maxDistance={600} minDistance={8} />

      {/* พื้นรอบที่ดิน: หญ้าเมื่อแสดงสภาพแวดล้อม, สีเรียบเมื่อเน้นเฉพาะโรงงาน */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
        <planeGeometry args={[1600, 1600]} />
        <meshStandardMaterial color={showSurroundings ? MATERIAL.grass : '#e6ecf2'} roughness={1} />
      </mesh>

      <group position={[-center[0], 0, -center[1]]}>
        {layout.site && (
          <>
            <SiteGround boundary={layout.site.boundary} />
            <TruckYard polygon={TRUCK_YARD} />
            <Truck position={[36, 0, 86]} rotation={-0.07} />
            {layout.site.landmarks
              .filter((l) => showSurroundings || l.kind !== 'road')
              // อาคารที่มีชั้นในผังแล้ว (อาคาร F) วาดจากข้อมูลชั้นแทนกล่องอาคารเดิม
              .filter((l) => !(l.kind === 'building' && annexes.some((a) => a.id === l.id)))
              .map((l) => (
                <LandmarkModel key={l.id} landmark={l} />
              ))}
            {showSurroundings && <Trees points={TREE_POINTS} />}
          </>
        )}
        <YardWalkway segments={walkways} />

        {/* อาคารหลัก: โหมดภายนอกแสดงตัวอาคาร, โหมดภายในแสดงพื้นแต่ละชั้น + rack + ไลน์ประกอบ */}
        {mainFloor && (
          <group position={[mainFloor.x, 0, mainFloor.z]} rotation={[0, -toRadians(mainFloor.rotation), 0]}>
            {exterior && (
              <BuildingA
                width={mainFloor.width}
                depth={mainFloor.depth}
                floors={storeysOf(buildingOf(mainFloor))}
                floorHeight={storeyHeight(layout.floors, mainFloor)}
                onClick={(e) => {
                  e.stopPropagation()
                  onBuildingClick?.()
                }}
              />
            )}
            {dock && <Truck position={[dock.x, 0, mainFloor.depth + 2.8]} rotation={Math.PI} />}
          </group>
        )}
        {annexes.map((a) => {
          const [cx, cz] = toSite(a.ground, a.ground.width / 2, a.ground.depth / 2)
          const top = a.floors * a.storey
          return (
            <group key={a.id}>
              {exterior && (
                <>
                  {/* โมเดลอาคารวาดตามแกนยาว: หมุน 90° ให้สันหลังคาวิ่งตามความยาวอาคาร */}
                  <group position={[a.ground.x, 0, a.ground.z]} rotation={[0, -toRadians(a.ground.rotation), 0]}>
                    <group position={[0, 0, a.ground.depth]} rotation={[0, Math.PI / 2, 0]}>
                      <BuildingA
                        width={a.ground.depth}
                        depth={a.ground.width}
                        floors={a.floors}
                        floorHeight={a.storey}
                        frontage={false}
                        roofRise={Math.min(5, a.ground.depth * 0.2)}
                        onClick={(e) => {
                          e.stopPropagation()
                          onBuildingClick?.()
                        }}
                      />
                    </group>
                  </group>
                  {a.link && <LinkBlock polygon={a.link} height={top} />}
                  <Label position={[cx, top + a.ground.depth * 0.2 + 4, cz]} title={`อาคาร ${a.id} (${a.floors} ชั้น${a.mezzanine ? ' + ชั้นลอย' : ''})`} />
                </>
              )}
              {/* ภายใน: พื้นทางเชื่อมระหว่างอาคารในแต่ละชั้น */}
              {!exterior &&
                a.link &&
                buildingFloors
                  .filter((f) => buildingOf(f) === a.id && !f.mezzanine && !hiddenFloors.has(f.id))
                  .map((f) => <LinkFloor key={f.id} polygon={a.link!} y={floorY(f.id) + FLOOR_LIFT - 0.02} />)}
            </group>
          )
        })}
        {!exterior &&
          buildingFloors
            .filter((f) => !hiddenFloors.has(f.id))
            .map((floor) => {
              const floorZones = zonesByFloor.get(floor.id) ?? NO_ZONES
              const rise = storeyHeight(layout.floors, floor)
              // ชั้นลอย: ระยะลงไปถึงพื้นชั้นล่าง (เสารับพื้น) และช่องหัวบันไดในราวกันตก
              const below = buildingFloors.filter((f) => buildingOf(f) === buildingOf(floor) && f.elevation < floor.elevation).map((f) => f.elevation)
              const drop = floor.mezzanine && below.length ? (floor.elevation - Math.max(...below)) * explode : 0
              return (
                <group
                  key={floor.id}
                  ref={(g) => {
                    if (g) floorRefs.current.set(floor.id, g)
                  }}
                  position={[floor.x, floorY(floor.id) + FLOOR_LIFT, floor.z]}
                  rotation={[0, -toRadians(floor.rotation), 0]}
                >
                  <FloorShell
                    floor={floor}
                    paint={paints.get(floor.id)!}
                    zones={floorZones}
                    rise={rise}
                    isGround={floor.id === MAIN_BUILDING_FLOOR_ID}
                    dockX={dock?.gap}
                    drop={drop}
                    railGaps={floor.mezzanine ? stairGaps(layout, floor) : NO_GAPS}
                    mezzanines={mezzAbove.get(floor.id) ?? NO_FLOORS}
                  />
                  {floorZones.map((zone) => {
                    const editable = editMode && isEditable(zone, floor)
                    const clearance = zoneClearance(layout.floors, zone)
                    return (
                      <ZoneModel
                        key={zone.id}
                        zone={zone}
                        rise={Math.min(rise, clearance)}
                        clearance={clearance}
                        stock={zoneStock?.get(zone.id)}
                        selected={selectedZoneIds.includes(zone.id)}
                        editing={editMode && editZoneId === zone.id}
                        editable={editable}
                        overlapping={editMode && floorZones.some((o) => o.id !== zone.id && rectsOverlap(o, zone))}
                        onSelect={() => onZoneClick(zone)}
                        onGrab={editable ? (e) => startDrag(layout.zones.find((z) => z.id === zone.id)!, floor, e) : undefined}
                        highlightLot={highlightLot}
                        selectedPallet={selectedPallet?.zoneId === zone.id ? selectedPallet.index : null}
                        onPalletClick={onPalletClick && ((i) => onPalletClick(zone.id, i))}
                      />
                    )
                  })}
                </group>
              )
            })}

        {/* เต็นท์ลานนอก (แสดงทั้งสองโหมด) */}
        {yardZones.map((zone) => {
          const floor = floorsById.get(zone.floorId)!
          const [x, z] = toSite(floor, zone.x, zone.z)
          const select = (e: { stopPropagation: () => void }) => {
            e.stopPropagation()
            onZoneClick(zone)
          }
          const Model = zone.kind === 'tent' && TENT_STYLE[zone.id] === 'arch' ? ArchTent : TwinGableTent
          const stock = zoneStock?.get(zone.id)
          return (
            <group key={zone.id} position={[x, 0, z]} rotation={[0, -toRadians(floor.rotation), 0]}>
              {zone.kind === 'tent' ? (
                <Model width={zone.width} depth={zone.depth} contents={zone.stores?.includes('ยาง') ? 'tyres' : 'pallets'} onClick={select} />
              ) : (
                <ZoneBox zone={zone} onClick={() => onZoneClick(zone)} />
              )}
              {selectedZoneIds.includes(zone.id) && <SelectionRing width={zone.width} depth={zone.depth} />}
              <Label
                position={[zone.width / 2, 10, zone.depth / 2]}
                title={zone.name}
                sub={stock?.totalQty ? `${stock.totalQty.toLocaleString('th-TH')} ชิ้น · ${stock.models.map((m) => m.model).join(', ')}` : zone.stores?.join(' / ')}
              />
            </group>
          )
        })}
        {/* รถยกหน้าเต็นท์ C */}
        {yardZones.some((z) => z.id === 'TENT-C') && <Forklift position={[59.5, 0, 60]} rotation={Math.PI * 0.55} />}

        {route && route.nodes.length > 1 && (
          <Line
            points={route.nodes.map((n) => {
              const [x, z] = toSite(floorsById.get(n.floorId)!, n.x, n.z)
              return [x, floorY(n.floorId) + 0.6, z] as [number, number, number]
            })}
            color="#f97316"
            lineWidth={5}
            transparent
            depthTest={false}
            renderOrder={10}
          />
        )}
      </group>

      {pins.map((pin) => {
        const zone = layout.zones.find((z) => z.id === pin.zoneId)
        const base = zonePoints.get(pin.zoneId)
        const floor = zone && floorsById.get(zone.floorId)
        if (!zone || !base || !floor) return null
        if (floor.area === 'building' && !exterior && hiddenFloors.has(floor.id)) return null
        // ภายนอก: ปักบนหลังคาอาคาร · ภายใน: เหนือ rack · เต็นท์: เหนือหลังคาเต็นท์
        const lift =
          floor.area !== 'building'
            ? 10
            : exterior
              ? storeysOf(buildingOf(floor)) * storeyHeight(layout.floors, floor) + 1.5 - floor.elevation
              : zone.kind === 'storage'
                ? storagePlan(zone, zoneClearance(layout.floors, zone)).height + 1.2
                : 2.5
        return <MapPin key={`${pin.tone}-${pin.zoneId}`} position={base.clone().setY(base.y + lift)} tone={pin.tone} />
      })}
    </Canvas>
  )
}

/* ------------------------------------------------------------------ ชั้นอาคาร */

const NO_ZONES: Zone[] = []
const NO_PINS: MapPinSpec[] = []
const NO_GAPS: [number, number][] = []
const NO_FLOORS: Floor[] = []
const DEFAULT_STOREY = 4.5

/** ความสูงชั้น: ระยะถึงพื้นชั้นเต็มถัดไปของอาคารเดียวกัน (ชั้นบนสุด = ค่ามาตรฐาน) */
function storeyHeight(floors: Floor[], floor: Floor): number {
  const above = floors
    .filter((f) => f.area === 'building' && !f.mezzanine && buildingOf(f) === buildingOf(floor) && f.elevation > floor.elevation + 1e-6)
    .map((f) => f.elevation - floor.elevation)
  return above.length ? Math.min(...above) : DEFAULT_STOREY
}

interface Annex {
  id: string
  /** ชั้นล่างสุดของอาคาร (ใช้ตำแหน่ง/ขนาดวาดตัวอาคาร) */
  ground: Floor
  floors: number
  storey: number
  mezzanine: boolean
  /** ช่องว่างระหว่างผนังหน้าอาคารต่อกับผนังหลังอาคารหลัก (พิกัด site) — วาดเป็นส่วนเชื่อมหลังคาต่อกัน */
  link: [number, number][] | null
}

function annexBuildings(floors: Floor[], mainId: string): Annex[] {
  const main = floors.find((f) => f.id === mainId)
  const groups = new Map<string, Floor[]>()
  for (const f of floors) if (f.area === 'building') groups.set(buildingOf(f), [...(groups.get(buildingOf(f)) ?? []), f])
  return [...groups]
    .filter(([id]) => !main || id !== buildingOf(main))
    .map(([id, list]) => {
      const full = list.filter((f) => !f.mezzanine).sort((a, b) => a.elevation - b.elevation)
      const ground = full[0] ?? list[0]
      return { id, ground, floors: Math.max(1, full.length), storey: storeyHeight(floors, ground), mezzanine: list.some((f) => f.mezzanine), link: main ? linkPolygon(main, ground) : null }
    })
}

/** ผนังหน้าอาคารต่อ (z = depth) ส่วนที่อยู่หลังอาคารหลักไม่เกิน 12 ม. + จุดตั้งฉากบนผนังหลังอาคารหลัก */
function linkPolygon(main: Floor, annex: Floor): [number, number][] | null {
  const front: [number, number][] = []
  const back: [number, number][] = []
  const steps = Math.ceil(annex.width)
  for (let i = 0; i <= steps; i++) {
    const p = toSite(annex, (annex.width * i) / steps, annex.depth)
    const [mx, mz] = toLocal(main, ...p)
    if (mx < 0 || mx > main.width || mz > 0.05 || mz < -12) continue
    front.push(p)
    back.push(toSite(main, mx, 0))
  }
  return front.length >= 2 ? [...front, ...back.reverse()] : null
}

/** รูปหลายเหลี่ยมบนพื้น (พิกัด site) → Shape สำหรับวาดด้วยการหมุน -90° รอบแกน x */
const groundShape = (polygon: [number, number][]) => new Shape(polygon.map(([x, z]) => new Vector2(x, -z)))

/** ส่วนเชื่อมหลังคาต่อกันระหว่างอาคาร (ภายนอก): ผนังสีเดียวกับอาคาร หลังคาสีน้ำเงิน */
function LinkBlock({ polygon, height }: { polygon: [number, number][]; height: number }) {
  const shape = useMemo(() => groundShape(polygon), [polygon])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
      <extrudeGeometry args={[shape, { depth: height, bevelEnabled: false }]} />
      <meshStandardMaterial attach="material-0" color={BRAND.roofBlue} roughness={0.6} metalness={0.3} />
      <meshStandardMaterial attach="material-1" color={BRAND.siding} roughness={0.7} />
    </mesh>
  )
}

/** พื้นทางเชื่อมระหว่างอาคาร (ภายใน) */
function LinkFloor({ polygon, y }: { polygon: [number, number][]; y: number }) {
  const shape = useMemo(() => groundShape(polygon), [polygon])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color={MATERIAL.epoxyGreen} roughness={0.5} />
    </mesh>
  )
}

/** ช่องหัวบันไดบนขอบหน้าชั้นลอย (ไม่ต้องมีราวกันตก) จากโหนดหัวบันได *-ST ของชั้น */
function stairGaps(layout: FactoryLayout, floor: Floor): [number, number][] {
  return layout.nodes.filter((n) => n.floorId === floor.id && n.id.endsWith('-ST')).map((n) => [n.x - 1.9, n.x + 1.9])
}

function siteCenter(layout: FactoryLayout): [number, number] {
  // จัดกึ่งกลางฉากตามขอบที่ดิน (หรือขนาดชั้นถ้าไม่มีข้อมูล site)
  const outline = layout.site?.boundary ?? layout.floors.flatMap((f) => [toSite(f, 0, 0), toSite(f, f.width, f.depth)])
  const xs = outline.map((p) => p[0])
  const zs = outline.map((p) => p[1])
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2]
}

/** พื้นตีเส้น + เสา + ผนังตัดครึ่ง + รถยก/รถลากพาเลทบนทางเดิน */
const FloorShell = memo(function FloorShell({
  floor,
  paint,
  zones,
  rise,
  isGround,
  dockX,
  drop = 0,
  railGaps = NO_GAPS,
  mezzanines = NO_FLOORS,
}: {
  floor: Floor
  paint: FloorPaint
  zones: Zone[]
  rise: number
  isGround: boolean
  dockX?: [number, number]
  /** ชั้นลอย: ความสูงเสารับพื้นลงไปถึงชั้นล่าง */
  drop?: number
  railGaps?: [number, number][]
  /** ชั้นลอยเหนือชั้นนี้ */
  mezzanines?: Floor[]
}) {
  // เสาทุกต้นที่ไม่ชนโซน (ขยับ rack ทับตำแหน่งเสาได้ เสาจะถูกซ่อน)
  const columns = useMemo(
    () =>
      paint.columns.filter(
        ([x, z]) =>
          !zones.some((zone) => zone.kind !== 'stairs' && zone.kind !== 'lift' && pointInRect(x, z, zone, 0.3)) &&
          !mezzanines.some((m) => {
            const [mx, mz] = toLocal(m, ...toSite(floor, x, z))
            return mx > -0.5 && mx < m.width + 0.5 && mz > -0.5 && mz < m.depth + 0.5
          }),
      ),
    [paint.columns, zones, mezzanines, floor],
  )
  const gaps = useMemo<[number, number][]>(() => {
    if (!isGround) return []
    const list: [number, number][] = paint.crossings.map((c) => [c.x - 0.5, c.x + c.width + 0.5])
    if (dockX) list.push(dockX)
    return list
  }, [isGround, paint.crossings, dockX])
  const vehicles = useMemo(() => {
    const long = paint.aisles.filter(([ax, az, bx, bz]) => Math.hypot(bx - ax, bz - az) >= 10)
    return [long[3], long[Math.floor(long.length * 0.7)]].filter(Boolean).map(([ax, az, bx, bz], i) => {
      const angle = Math.atan2(bz - az, bx - ax)
      // ชิดซ้ายของช่องทาง 0.8 ม.
      const side = i % 2 ? 0.8 : -0.8
      return { x: (ax + bx) / 2 - Math.sin(angle) * side, z: (az + bz) / 2 + Math.cos(angle) * side, rot: -angle + (i % 2 ? Math.PI : 0) }
    })
  }, [paint.aisles])
  const Vehicle = isGround ? Forklift : PalletJack

  if (floor.mezzanine)
    return (
      <group>
        <FloorPlate paint={paint} />
        <MezzanineEdge width={floor.width} depth={floor.depth} drop={drop} gaps={railGaps} />
        <Html position={[0, 1.6, 0]} className="pointer-events-none" zIndexRange={[10, 0]}>
          <div className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white shadow-sm" style={{ background: BRAND.primary }}>
            {floor.name}
          </div>
        </Html>
      </group>
    )

  return (
    <group>
      <FloorPlate paint={paint} />
      <Columns points={columns} height={rise - 0.3} />
      <CutawayWalls width={floor.width} depth={floor.depth} gaps={gaps} />
      {vehicles.map((v, i) => (
        <Vehicle key={i} position={[v.x, 0, v.z]} rotation={v.rot} />
      ))}
      <Html position={[0, 1.6, 0]} className="pointer-events-none" zIndexRange={[10, 0]}>
        <div className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white shadow-sm" style={{ background: BRAND.primary }}>
          {floor.name}
        </div>
      </Html>
    </group>
  )
})

/** สีเส้นกรอบพื้นที่ (5S): ขาว = ตำแหน่งวางของ/อุปกรณ์, เหลือง = พื้นที่ทำงาน, ส้ม = รอตรวจ, แดง = ของเสีย */
const OUTLINE: Record<Zone['kind'], string> = {
  storage: '#ffffff',
  assembly: '#f2c200',
  receiving: '#f2c200',
  tent: '#ffffff',
  stairs: '#f2c200',
  lift: '#f2c200',
  inspection: '#f07c1b',
  ng: '#e34948',
  utility: '#ffffff',
}

const ZoneModel = memo(function ZoneModel({
  zone,
  rise,
  clearance,
  stock,
  selected,
  editing,
  editable,
  overlapping,
  onSelect,
  onGrab,
  highlightLot,
  selectedPallet,
  onPalletClick,
}: {
  zone: Zone
  rise: number
  /** ระยะถึงพื้นชั้นที่อยู่เหนือโซน — rack ใต้/บนชั้นลอยจะเตี้ยลง */
  clearance: number
  stock?: ZoneContents
  selected: boolean
  editing: boolean
  editable: boolean
  overlapping: boolean
  onSelect: () => void
  onGrab?: (e: ThreeEvent<PointerEvent>) => void
  highlightLot?: string | null
  selectedPallet: number | null
  onPalletClick?: (index: number) => void
}) {
  const { width, depth } = zone
  const { storage, levels, slotsPerLevel } = zone
  const plan = useMemo(() => storagePlan({ width, depth, storage, levels, slotsPerLevel }, clearance), [width, depth, storage, levels, slotsPerLevel, clearance])
  const height = zone.kind === 'storage' ? plan.height : zone.kind === 'assembly' ? 2 : zone.kind === 'lift' ? 3.2 : zone.kind === 'stairs' ? rise : 1.2
  const outline = overlapping ? '#e34948' : editing ? '#2563eb' : selected ? '#f97316' : OUTLINE[zone.kind]
  const showLabel = zone.kind !== 'stairs' && zone.kind !== 'lift'
  const pieces = stock?.totalQty ?? 0
  // ความจุ rack ที่ใช้อยู่ (%)
  const usage = useMemo(() => {
    if (zone.kind !== 'storage') return null
    const slots = plan.slots.length
    return slots ? Math.round((Math.min(palletsFor(stock).length, slots) / slots) * 100) : 0
  }, [zone.kind, stock, plan])

  return (
    <group position={[zone.x, 0, zone.z]}>
      {zone.kind === 'storage' && (
        <PalletRack
          zoneId={zone.id}
          width={width}
          depth={depth}
          code={zone.code}
          stock={stock}
          highlightLot={highlightLot}
          selectedIndex={selectedPallet}
          plan={plan}
        />
      )}
      {zone.kind === 'assembly' && <AssemblyLine width={width} depth={depth} title={`${zone.code} · ${zone.name}`} />}
      {zone.kind === 'receiving' && <ReceivingArea width={width} depth={depth} />}
      {zone.kind === 'stairs' && <Stairs width={width} depth={depth} rise={rise} />}
      {zone.kind === 'lift' && <Lift width={width} depth={depth} height={3.2} />}
      {zone.kind === 'inspection' && <InspectionArea width={width} depth={depth} />}
      {zone.kind === 'ng' && <NgArea width={width} depth={depth} />}
      {zone.kind === 'utility' && <UtilityArea width={width} depth={depth} />}
      <ZoneOutline width={width} depth={depth} color={outline} thickness={selected || editing || overlapping ? 0.25 : 0.12} />
      {(selected || editing) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[width / 2, 0.025, depth / 2]}>
          <planeGeometry args={[width, depth]} />
          <meshBasicMaterial color={outline} transparent opacity={0.16} depthWrite={false} />
        </mesh>
      )}

      {/* กล่องรับการคลิก/ลาก ครอบทั้งโซน (มองไม่เห็น) */}
      <mesh
        position={[width / 2, height / 2, depth / 2]}
        onClick={(e) => {
          e.stopPropagation()
          if (onGrab) return
          onSelect()
          // คลิกโดนพาเลทในโซนนี้ ⇒ เปิดรายละเอียดพาเลท (กล่องครอบโซนรับคลิกก่อนเพราะอยู่ใกล้กล้องกว่า)
          const hit = e.intersections.find((i) => i.object.userData?.palletZone === zone.id && i.instanceId !== undefined)
          if (hit && onPalletClick) onPalletClick(hit.instanceId!)
        }}
        onPointerDown={
          onGrab &&
          ((e) => {
            e.stopPropagation()
            onSelect()
            onGrab(e)
          })
        }
        onPointerOver={() => (document.body.style.cursor = onGrab ? 'grab' : 'pointer')}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <boxGeometry args={[width, height, depth]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>

      {showLabel && (
        <Html position={[width / 2, height + 1, depth / 2]} center className="pointer-events-none" zIndexRange={[10, 0]}>
          <div
            className={`flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] shadow-sm ring-1 ${
              editing ? 'bg-blue-600 text-white ring-blue-700' : 'bg-white/95 text-slate-600 ring-slate-200'
            }`}
          >
            <i className="h-1.5 w-1.5 rounded-full" style={{ background: OUTLINE[zone.kind] === '#ffffff' ? BRAND.primary : OUTLINE[zone.kind] }} />
            <b className={editing ? '' : 'text-slate-800'}>{zone.code}</b>
            {editing ? (
              <span>
                · {width} × {depth} ม.
              </span>
            ) : pieces > 0 ? (
              <span>· {pieces.toLocaleString('th-TH')} ชิ้น</span>
            ) : (
              zone.stores && <span className="text-slate-400">· ว่าง</span>
            )}
            {usage !== null && !editing && <span className={usage >= 90 ? 'font-semibold text-red-600' : 'text-slate-400'}>· {usage}%</span>}
            {editable && !editing && <span className="text-blue-600">✥</span>}
          </div>
        </Html>
      )}
    </group>
  )
})

/* ------------------------------------------------------------------ คำนวณเส้นพื้น */

/** ทางเดินลานนอก (พิกัด site) จากกราฟทางเดินที่มีโหนดอยู่บนลาน */
function yardWalkways(layout: FactoryLayout): [number, number, number, number][] {
  const floors = new Map(layout.floors.map((f) => [f.id, f]))
  const nodes = new Map(layout.nodes.map((n) => [n.id, n]))
  return layout.edges.flatMap((e): [number, number, number, number][] => {
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    if (!a || !b || e.mode !== 'walk') return []
    if (floors.get(a.floorId)?.area !== 'yard' && floors.get(b.floorId)?.area !== 'yard') return []
    return [[...toSite(floors.get(a.floorId)!, a.x, a.z), ...toSite(floors.get(b.floorId)!, b.x, b.z)]]
  })
}

/** ประตูรับสินค้า: จุดรับเข้าที่ชิดผนังด้านหน้าชั้นล่าง ⇒ รถบรรทุกจอดหน้าประตู */
function dockPosition(layout: FactoryLayout, ground: Floor) {
  const rcv = layout.zones.find((z) => z.floorId === ground.id && z.kind === 'receiving' && z.z + z.depth >= ground.depth - 1.5)
  if (!rcv) return undefined
  return { x: rcv.x + rcv.width / 2, gap: [rcv.x + 1, rcv.x + rcv.width - 1] as [number, number] }
}

/* ------------------------------------------------------------------ ลานนอกและส่วนประกอบ */

function LandmarkModel({ landmark: l }: { landmark: Landmark }) {
  return (
    <group position={[l.x, 0, l.z]} rotation={[0, -toRadians(l.rotation), 0]}>
      {l.kind === 'office' && <OfficeBuilding width={l.width} depth={l.depth} />}
      {l.kind === 'canteen' && (
        <>
          <Label position={[0, l.height + 3, 0]} title={l.name} muted />
          <Canteen width={l.width} depth={l.depth} height={l.height} />
        </>
      )}
      {l.kind === 'gate' && <TruckGate width={l.width} depth={l.depth} shrine={GATES_WITH_SHRINE.has(l.id)} />}
      {l.kind === 'carport' && <Carport width={l.width} depth={l.depth} height={l.height} />}
      {l.kind === 'building' && <Warehouse width={l.width} depth={l.depth} height={Math.max(l.height, 6)} />}
      {l.kind === 'road' && <Road width={l.width} depth={l.depth} />}
      {l.kind === 'area' && <PavedArea width={l.width} depth={l.depth} />}
      {(l.kind === 'office' || l.kind === 'building') && <Label position={[0, l.height + 5, 0]} title={l.name} />}
      {l.kind === 'gate' && <Label position={[0, 4, 0]} title={l.name} />}
      {l.kind === 'parking' && <Label position={[0, 1.5, 0]} title={l.name} muted />}
      {l.kind === 'road' && <Label position={[-l.width / 4, 1, 0]} title={l.name} muted />}
    </group>
  )
}

function Label({ position, title, sub, muted }: { position: [number, number, number]; title: string; sub?: string; muted?: boolean }) {
  return (
    <Html position={position} center className="pointer-events-none" zIndexRange={[10, 0]}>
      <div
        className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold shadow-sm ring-1 ring-slate-200 ${muted ? 'bg-white/60 text-slate-600' : 'bg-white/95'}`}
        style={muted ? undefined : { color: BRAND.primary }}
      >
        {title}
        {sub && <span className="ml-1 font-normal text-slate-500">· {sub}</span>}
      </div>
    </Html>
  )
}

function SelectionRing({ width, depth }: { width: number; depth: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[width / 2, 0.08, depth / 2]}>
      <planeGeometry args={[width + 2, depth + 2]} />
      <meshBasicMaterial color="#f97316" transparent opacity={0.35} />
    </mesh>
  )
}

/** โซนบนลานที่ไม่ใช่เต็นท์ (กล่องสีตามประเภท) */
function ZoneBox({ zone, onClick }: { zone: Zone; onClick: () => void }) {
  const style = ZONE_STYLE[zone.kind]
  return (
    <mesh
      position={[zone.width / 2, style.height / 2, zone.depth / 2]}
      castShadow
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <boxGeometry args={[zone.width, style.height, zone.depth]} />
      <meshStandardMaterial color={style.color} transparent opacity={0.85} />
    </mesh>
  )
}
