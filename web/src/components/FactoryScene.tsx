import { Html, Line, OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { BRAND, MATERIAL } from '../data/brand'
import { MAIN_BUILDING_FLOOR_ID, TENT_STYLE, TREE_POINTS } from '../data/siteAppearance'
import { ZONE_STYLE } from '../data/zoneStyle'
import { toRadians, toSite } from '../lib/geometry'
import type { RouteResult } from '../lib/pathfinding'
import type { FactoryLayout, Floor, Landmark, Zone } from '../types/layout'
import { BuildingA } from './models/BuildingA'
import { ArchTent, OfficeBuilding, PavedArea, Road, SiteGround, Trees, TwinGableTent, Warehouse } from './models/SiteModels'

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
}

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

export function FactoryScene(props: Props) {
  const { layout, mode, explode, hiddenFloors, selectedZoneIds, route, onZoneClick, onBuildingClick, topView } = props
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

  return (
    <Canvas camera={{ position: CAMERA.exterior, fov: 42, far: 2000 }} shadows="soft">
      <CameraRig view={topView ? 'top' : mode} />
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
      <OrbitControls makeDefault target={[0, 5, 0]} maxPolarAngle={Math.PI / 2.1} maxDistance={600} minDistance={15} />

      {/* พื้นหญ้ารอบที่ดิน */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
        <planeGeometry args={[1600, 1600]} />
        <meshStandardMaterial color={MATERIAL.grass} roughness={1} />
      </mesh>

      <group position={[-center[0], 0, -center[1]]}>
        {layout.site && (
          <>
            <SiteGround boundary={layout.site.boundary} />
            {layout.site.landmarks.map((l) => (
              <LandmarkModel key={l.id} landmark={l} />
            ))}
            <Trees points={TREE_POINTS} />
          </>
        )}

        {/* อาคารหลัก: โหมดภายนอกแสดงตัวอาคาร, โหมดภายในแสดงพื้นแต่ละชั้น + โซน */}
        {exterior && mainFloor && (
          <group position={[mainFloor.x, 0, mainFloor.z]} rotation={[0, -toRadians(mainFloor.rotation), 0]}>
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
          </group>
        )}
        {!exterior &&
          buildingFloors
            .filter((f) => !hiddenFloors.has(f.id))
            .map((floor) => (
              <group key={floor.id} position={[floor.x, floorY(floor.id), floor.z]} rotation={[0, -toRadians(floor.rotation), 0]}>
                <FloorSlab floor={floor} />
                {layout.zones
                  .filter((z) => z.floorId === floor.id)
                  .map((zone) => (
                    <ZoneBox key={zone.id} zone={zone} selected={selectedZoneIds.includes(zone.id)} onClick={() => onZoneClick(zone)} />
                  ))}
              </group>
            ))}

        {/* เต็นท์ลานนอก (แสดงทั้งสองโหมด) */}
        {yardZones.map((zone) => {
          const floor = floorsById.get(zone.floorId)!
          const [x, z] = toSite(floor, zone.x, zone.z)
          const select = (e: { stopPropagation: () => void }) => {
            e.stopPropagation()
            onZoneClick(zone)
          }
          const Model = zone.kind === 'tent' && TENT_STYLE[zone.id] === 'arch' ? ArchTent : TwinGableTent
          return (
            <group key={zone.id} position={[x, 0, z]} rotation={[0, -toRadians(floor.rotation), 0]}>
              {zone.kind === 'tent' ? (
                <Model width={zone.width} depth={zone.depth} onClick={select} />
              ) : (
                <ZoneBox zone={zone} selected={selectedZoneIds.includes(zone.id)} onClick={() => onZoneClick(zone)} />
              )}
              {selectedZoneIds.includes(zone.id) && <SelectionRing width={zone.width} depth={zone.depth} />}
              <Label position={[zone.width / 2, 10, zone.depth / 2]} title={zone.name} sub={zone.stores?.join(' / ')} />
            </group>
          )
        })}

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
        style={muted ? undefined : { color: BRAND.navy }}
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

function FloorSlab({ floor }: { floor: Floor }) {
  return (
    <group>
      <mesh receiveShadow position={[floor.width / 2, -0.15, floor.depth / 2]}>
        <boxGeometry args={[floor.width, 0.3, floor.depth]} />
        <meshStandardMaterial color="#c9d3df" transparent opacity={0.75} />
      </mesh>
      <Html position={[0, 0.5, 0]} className="pointer-events-none" zIndexRange={[10, 0]}>
        <div className="whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold text-white shadow" style={{ background: BRAND.navy }}>
          {floor.name}
        </div>
      </Html>
    </group>
  )
}

function ZoneBox({ zone, selected, onClick }: { zone: Zone; selected: boolean; onClick: () => void }) {
  const style = ZONE_STYLE[zone.kind]
  const showLabel = zone.kind !== 'stairs' && zone.kind !== 'lift'
  return (
    <group position={[zone.x + zone.width / 2, style.height / 2, zone.z + zone.depth / 2]}>
      <mesh
        castShadow
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
      >
        <boxGeometry args={[zone.width, style.height, zone.depth]} />
        <meshStandardMaterial
          color={style.color}
          transparent
          opacity={0.85}
          emissive={selected ? '#f97316' : '#000000'}
          emissiveIntensity={selected ? 0.8 : 0}
        />
      </mesh>
      {showLabel && (
        <Html position={[0, style.height / 2 + 0.8, 0]} center className="pointer-events-none" zIndexRange={[10, 0]}>
          <div className="whitespace-nowrap rounded bg-white/90 px-1.5 text-[10px] font-medium text-slate-700 shadow">
            {zone.code}
            {zone.stores && <span className="text-slate-400"> · {zone.stores.join('/')}</span>}
          </div>
        </Html>
      )}
    </group>
  )
}
