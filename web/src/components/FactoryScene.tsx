import { Html, Line, OrbitControls } from '@react-three/drei'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { type Group, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { BRAND, MATERIAL } from '../data/brand'
import { MAIN_BUILDING_FLOOR_ID, TENT_STYLE, TREE_POINTS } from '../data/siteAppearance'
import { RACK } from '../data/warehouse'
import { ZONE_STYLE } from '../data/zoneStyle'
import { toRadians, toSite } from '../lib/geometry'
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
import { ArchTent, OfficeBuilding, PavedArea, Road, SiteGround, Trees, TwinGableTent, Warehouse } from './models/SiteModels'
import { AISLE_WIDTH, type FloorPaint } from './models/textures'

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
}

/** ยกพื้นชั้นในโหมดภายในขึ้นเล็กน้อย ไม่ให้ซ้อนกับพื้นลาน */
const FLOOR_LIFT = 0.12

const CAMERA: Record<ViewMode | 'top', [number, number, number]> = {
  exterior: [-45, 55, 140],
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
  } = props
  const exterior = mode === 'exterior'
  const floorsById = new Map(layout.floors.map((f) => [f.id, f]))
  const floorY = (id: string) => (floorsById.get(id)?.elevation ?? 0) * (exterior ? 1 : explode)

  // จัดกึ่งกลางฉากตามขอบที่ดิน (หรือขนาดชั้นถ้าไม่มีข้อมูล site)
  const outline = layout.site?.boundary ?? layout.floors.flatMap((f) => [toSite(f, 0, 0), toSite(f, f.width, f.depth)])
  const xs = outline.map((p) => p[0])
  const zs = outline.map((p) => p[1])
  const center = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2]

  const mainFloor = floorsById.get(MAIN_BUILDING_FLOOR_ID)
  const buildingFloors = layout.floors.filter((f) => f.area === 'building')
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
      <CameraRig view={topView ? 'top' : mode} />
      <DragController start={drag} groups={floorRefs} onMove={moveDrag} onEnd={endDrag} />
      <color attach="background" args={[MATERIAL.sky]} />
      <fog attach="fog" args={[MATERIAL.sky, 320, 900]} />
      <hemisphereLight args={['#eef5fc', '#8d8577', 0.9]} />
      <directionalLight
        position={[-90, 160, 110]}
        intensity={2.2}
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
        <meshStandardMaterial color={showSurroundings ? MATERIAL.grass : '#dde3ea'} roughness={1} />
      </mesh>

      <group position={[-center[0], 0, -center[1]]}>
        {layout.site && (
          <>
            <SiteGround boundary={layout.site.boundary} />
            {layout.site.landmarks
              .filter((l) => showSurroundings || l.kind === 'office' || l.kind === 'building')
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
                floors={buildingFloors.length}
                floorHeight={buildingFloors[1] ? buildingFloors[1].elevation - buildingFloors[0].elevation : 4.5}
                onClick={(e) => {
                  e.stopPropagation()
                  onBuildingClick?.()
                }}
              />
            )}
            {dock && <Truck position={[dock.x, 0, mainFloor.depth + 2.8]} rotation={Math.PI} />}
          </group>
        )}
        {!exterior &&
          buildingFloors
            .filter((f) => !hiddenFloors.has(f.id))
            .map((floor) => {
              const floorZones = zonesByFloor.get(floor.id) ?? NO_ZONES
              const rise = buildingFloors[1] ? buildingFloors[1].elevation - buildingFloors[0].elevation : 4.5
              return (
                <group
                  key={floor.id}
                  ref={(g) => {
                    if (g) floorRefs.current.set(floor.id, g)
                  }}
                  position={[floor.x, floorY(floor.id) + FLOOR_LIFT, floor.z]}
                  rotation={[0, -toRadians(floor.rotation), 0]}
                >
                  <FloorShell floor={floor} paint={paints.get(floor.id)!} zones={floorZones} rise={rise} isGround={floor.id === MAIN_BUILDING_FLOOR_ID} dockX={dock?.gap} />
                  {floorZones.map((zone) => {
                    const editable = editMode && isEditable(zone, floor)
                    return (
                      <ZoneModel
                        key={zone.id}
                        zone={zone}
                        rise={rise}
                        stock={zoneStock?.get(zone.id)}
                        selected={selectedZoneIds.includes(zone.id)}
                        editing={editMode && editZoneId === zone.id}
                        editable={editable}
                        overlapping={editMode && floorZones.some((o) => o.id !== zone.id && rectsOverlap(o, zone))}
                        onSelect={() => onZoneClick(zone)}
                        onGrab={editable ? (e) => startDrag(layout.zones.find((z) => z.id === zone.id)!, floor, e) : undefined}
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
              {zone.kind === 'tent' ? <Model width={zone.width} depth={zone.depth} onClick={select} /> : <ZoneBox zone={zone} onClick={() => onZoneClick(zone)} />}
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
    </Canvas>
  )
}

/* ------------------------------------------------------------------ ชั้นอาคาร */

const NO_ZONES: Zone[] = []

/** พื้นตีเส้น + เสา + ผนังตัดครึ่ง + รถยก/รถลากพาเลทบนทางเดิน */
const FloorShell = memo(function FloorShell({
  floor,
  paint,
  zones,
  rise,
  isGround,
  dockX,
}: {
  floor: Floor
  paint: FloorPaint
  zones: Zone[]
  rise: number
  isGround: boolean
  dockX?: [number, number]
}) {
  // เสาทุกต้นที่ไม่ชนโซน (ขยับ rack ทับตำแหน่งเสาได้ เสาจะถูกซ่อน)
  const columns = useMemo(
    () => paint.columns.filter(([x, z]) => !zones.some((zone) => zone.kind !== 'stairs' && zone.kind !== 'lift' && pointInRect(x, z, zone, 0.3))),
    [paint.columns, zones],
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

  return (
    <group>
      <FloorPlate paint={paint} />
      <Columns points={columns} height={rise - 0.3} />
      <CutawayWalls width={floor.width} depth={floor.depth} gaps={gaps} />
      {vehicles.map((v, i) => (
        <Vehicle key={i} position={[v.x, 0, v.z]} rotation={v.rot} />
      ))}
      <Html position={[0, 1.6, 0]} className="pointer-events-none" zIndexRange={[10, 0]}>
        <div className="whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold text-white shadow" style={{ background: BRAND.primary }}>
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
  stock,
  selected,
  editing,
  editable,
  overlapping,
  onSelect,
  onGrab,
}: {
  zone: Zone
  rise: number
  stock?: ZoneContents
  selected: boolean
  editing: boolean
  editable: boolean
  overlapping: boolean
  onSelect: () => void
  onGrab?: (e: ThreeEvent<PointerEvent>) => void
}) {
  const { width, depth } = zone
  const height = zone.kind === 'storage' ? RACK.height : zone.kind === 'assembly' ? 2 : zone.kind === 'lift' ? 3.2 : zone.kind === 'stairs' ? rise : 1.2
  const outline = overlapping ? '#e34948' : editing ? '#2563eb' : selected ? '#f97316' : OUTLINE[zone.kind]
  const showLabel = zone.kind !== 'stairs' && zone.kind !== 'lift'
  const pallets = stock?.totalQty ?? 0

  return (
    <group position={[zone.x, 0, zone.z]}>
      {zone.kind === 'storage' && <PalletRack width={width} depth={depth} code={zone.code} stock={stock} />}
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
          if (!onGrab) onSelect()
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
          <div className={`whitespace-nowrap rounded px-1.5 text-[10px] font-medium shadow ${editing ? 'bg-blue-600 text-white' : 'bg-white/90 text-slate-700'}`}>
            {zone.code}
            {editing ? (
              <span> · {width} × {depth} ม.</span>
            ) : pallets > 0 ? (
              <span className="text-slate-500"> · {pallets.toLocaleString('th-TH')} ชิ้น</span>
            ) : (
              zone.stores && <span className="text-slate-400"> · ว่าง</span>
            )}
            {editable && !editing && <span className="text-blue-600"> ✥</span>}
          </div>
        </Html>
      )}
    </group>
  )
})

/* ------------------------------------------------------------------ คำนวณเส้นพื้น */

const GRID_NODE = /-r\d+c\d+$/

/** ข้อมูลตีเส้นพื้นของชั้น: ทางเดินจากกราฟทางเดิน (ที่ไม่ถูก rack ขวาง), จุดอันตราย, ทางม้าลาย, เสา */
function floorPaint(layout: FactoryLayout, floor: Floor): FloorPaint {
  const nodes = new Map(layout.nodes.map((n) => [n.id, n]))
  const aisles = layout.edges.flatMap((e): [number, number, number, number][] => {
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    return e.mode === 'walk' && a && b && a.floorId === floor.id && b.floorId === floor.id ? [[a.x, a.z, b.x, b.z]] : []
  })
  const zones = layout.zones.filter((z) => z.floorId === floor.id)
  const hazards = zones.filter((z) => z.kind === 'stairs' || z.kind === 'lift').map(({ x, z, width, depth }) => ({ x, z, width, depth }))
  const crossings = layout.nodes
    .filter((n) => n.floorId === floor.id && n.id.endsWith('-DOOR'))
    .map((n) => ({ x: n.x - AISLE_WIDTH, z: Math.max(n.z - 3.5, 0), width: AISLE_WIDTH * 2, depth: Math.min(3.5, n.z) }))

  // เสาโครงสร้าง: กึ่งกลางระหว่างทางเดินหลัก และแนวผนัง
  const grid = layout.nodes.filter((n) => n.floorId === floor.id && GRID_NODE.test(n.id))
  const lines = (values: number[], size: number) => {
    const sorted = [...new Set(values)].sort((a, b) => a - b)
    return [0.3, ...sorted.slice(1).map((v, i) => (v + sorted[i]) / 2), size - 0.3]
  }
  const nearAisle = (x: number, z: number) =>
    aisles.some(([ax, az, bx, bz]) => {
      const len2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1
      const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / len2))
      return Math.hypot(x - (ax + t * (bx - ax)), z - (az + t * (bz - az))) < AISLE_WIDTH / 2 + 0.4
    })
  const columns: [number, number][] = []
  if (grid.length)
    for (const x of lines(grid.map((n) => n.x), floor.width))
      for (const z of lines(grid.map((n) => n.z), floor.depth)) if (!nearAisle(x, z) && !hazards.some((h) => pointInRect(x, z, h, 0.5))) columns.push([x, z])

  return { width: floor.width, depth: floor.depth, aisles, hazards, crossings, columns }
}

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
      {l.kind === 'building' && <Warehouse width={l.width} depth={l.depth} height={Math.max(l.height, 6)} />}
      {l.kind === 'road' && <Road width={l.width} depth={l.depth} />}
      {l.kind === 'area' && <PavedArea width={l.width} depth={l.depth} />}
      {l.kind !== 'road' && l.kind !== 'area' && <Label position={[0, l.height + 5, 0]} title={l.name} />}
      {l.kind === 'road' && <Label position={[-l.width / 4, 1, 0]} title={l.name} muted />}
    </group>
  )
}

function Label({ position, title, sub, muted }: { position: [number, number, number]; title: string; sub?: string; muted?: boolean }) {
  return (
    <Html position={position} center className="pointer-events-none" zIndexRange={[10, 0]}>
      <div
        className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold shadow ${muted ? 'bg-white/60 text-slate-600' : 'bg-white/90'}`}
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
