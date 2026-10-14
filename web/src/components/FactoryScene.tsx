import { Html, Line, OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Shape, Vector2 } from 'three'
import { ZONE_STYLE } from '../data/zoneStyle'
import { toRadians, toSite } from '../lib/geometry'
import type { RouteResult } from '../lib/pathfinding'
import type { FactoryLayout, Floor, Landmark, Site, Zone } from '../types/layout'

interface Props {
  layout: FactoryLayout
  /** ระยะห่างระหว่างชั้นที่ใช้แสดงผล (คูณกับความสูงจริง) เพื่อให้มองเห็นแต่ละชั้นได้ */
  explode: number
  hiddenFloors: Set<string>
  selectedZoneIds: string[]
  route: RouteResult | null
  onZoneClick: (zone: Zone) => void
  /** มองจากด้านบน (ใช้เทียบกับภาพดาวเทียม) */
  topView?: boolean
}

const PERSPECTIVE_CAMERA: [number, number, number] = [90, 130, 160]
const TOP_CAMERA: [number, number, number] = [0, 260, 0.01]

/** สลับมุมกล้องระหว่างมุมเอียงกับมุมมองด้านบน โดยไม่ต้องสร้างฉากใหม่ */
function CameraRig({ topView }: { topView: boolean }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { target: { set: (x: number, y: number, z: number) => void }; update: () => void } | null
  useEffect(() => {
    camera.position.set(...(topView ? TOP_CAMERA : PERSPECTIVE_CAMERA))
    controls?.target.set(0, topView ? 0 : 5, 0)
    controls?.update()
  }, [camera, controls, topView])
  return null
}

const LANDMARK_COLOR: Record<Landmark['kind'], string> = {
  office: '#e2e8f0',
  building: '#64748b',
  road: '#111827',
  area: '#475569',
}

export function FactoryScene({ layout, explode, hiddenFloors, selectedZoneIds, route, onZoneClick, topView }: Props) {
  const floorsById = new Map(layout.floors.map((f) => [f.id, f]))
  const floorY = (id: string) => (floorsById.get(id)?.elevation ?? 0) * explode

  // จัดกึ่งกลางฉากตามขอบที่ดิน (หรือขนาดชั้นถ้าไม่มีข้อมูล site)
  const outline = layout.site?.boundary ?? layout.floors.flatMap((f) => [toSite(f, 0, 0), toSite(f, f.width, f.depth)])
  const xs = outline.map((p) => p[0])
  const zs = outline.map((p) => p[1])
  const center = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2]

  return (
    <Canvas camera={{ position: PERSPECTIVE_CAMERA, fov: 45, far: 2000 }} shadows>
      <CameraRig topView={!!topView} />
      <color attach="background" args={['#0b1220']} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[80, 160, 60]} intensity={1.2} castShadow />
      <OrbitControls makeDefault target={[0, 5, 0]} maxPolarAngle={Math.PI / 2.05} maxDistance={600} />

      <group position={[-center[0], 0, -center[1]]}>
        {layout.site && <SiteGround site={layout.site} />}

        {layout.floors
          .filter((f) => !hiddenFloors.has(f.id))
          .map((floor) => (
            <group
              key={floor.id}
              position={[floor.x, floorY(floor.id), floor.z]}
              rotation={[0, -toRadians(floor.rotation), 0]}
            >
              {floor.area === 'building' && <FloorSlab floor={floor} />}
              {layout.zones
                .filter((z) => z.floorId === floor.id)
                .map((zone) => (
                  <ZoneBox
                    key={zone.id}
                    zone={zone}
                    selected={selectedZoneIds.includes(zone.id)}
                    onClick={() => onZoneClick(zone)}
                  />
                ))}
            </group>
          ))}

        {route && route.nodes.length > 1 && (
          <Line
            points={route.nodes.map((n) => {
              const [x, z] = toSite(floorsById.get(n.floorId)!, n.x, n.z)
              return [x, floorY(n.floorId) + 0.5, z] as [number, number, number]
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

function SiteGround({ site }: { site: Site }) {
  // Shape วาดบนระนาบ XY แล้วหมุนลงพื้น: (x, y) → (x, 0, -y) จึงต้องกลับเครื่องหมาย z
  const shape = useMemo(() => new Shape(site.boundary.map(([x, z]) => new Vector2(x, -z))), [site.boundary])
  const ring = [...site.boundary, site.boundary[0]].map(([x, z]) => [x, 0.1, z] as [number, number, number])
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.32, 0]} receiveShadow>
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      <Line points={ring} color="#ef4444" lineWidth={2} />
      {site.landmarks.map((l) => (
        <group key={l.id} position={[l.x, l.height / 2 - 0.35, l.z]} rotation={[0, -toRadians(l.rotation), 0]}>
          <mesh receiveShadow castShadow={l.height > 1}>
            <boxGeometry args={[l.width, l.height, l.depth]} />
            <meshStandardMaterial color={LANDMARK_COLOR[l.kind]} transparent opacity={l.kind === 'office' ? 0.6 : 0.9} />
          </mesh>
          <Html position={[0, l.height / 2 + 1, 0]} center className="pointer-events-none">
            <div className="whitespace-nowrap text-[11px] text-slate-400">{l.name}</div>
          </Html>
        </group>
      ))}
    </group>
  )
}

function FloorSlab({ floor }: { floor: Floor }) {
  return (
    <group>
      <mesh receiveShadow position={[floor.width / 2, -0.15, floor.depth / 2]}>
        <boxGeometry args={[floor.width, 0.3, floor.depth]} />
        <meshStandardMaterial color="#1e3a5f" transparent opacity={0.8} />
      </mesh>
      <Html position={[0, 0.5, 0]} className="pointer-events-none">
        <div className="whitespace-nowrap rounded bg-slate-900/80 px-2 py-0.5 text-xs font-semibold text-sky-300">
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
          opacity={zone.kind === 'tent' ? 0.45 : 0.8}
          emissive={selected ? '#f97316' : '#000000'}
          emissiveIntensity={selected ? 0.8 : 0}
        />
      </mesh>
      {showLabel && (
        <Html position={[0, style.height / 2 + 0.8, 0]} center className="pointer-events-none">
          <div className="whitespace-nowrap rounded bg-slate-900/70 px-1.5 text-[10px] text-slate-100">
            {zone.code}
            {zone.stores && <span className="text-slate-400"> · {zone.stores.join('/')}</span>}
          </div>
        </Html>
      )}
    </group>
  )
}
