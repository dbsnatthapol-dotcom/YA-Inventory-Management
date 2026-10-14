import { Html, Line, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { ZONE_STYLE } from '../data/zoneStyle'
import type { FactoryLayout, Floor, Zone } from '../types/layout'
import type { RouteResult } from '../lib/pathfinding'


interface Props {
  layout: FactoryLayout
  /** ระยะห่างระหว่างชั้นที่ใช้แสดงผล (คูณกับความสูงจริง) เพื่อให้มองเห็นแต่ละชั้นได้ */
  explode: number
  hiddenFloors: Set<string>
  selectedZoneIds: string[]
  route: RouteResult | null
  onZoneClick: (zone: Zone) => void
}

export function FactoryScene({ layout, explode, hiddenFloors, selectedZoneIds, route, onZoneClick }: Props) {
  const floorY = new Map(layout.floors.map((f) => [f.id, f.elevation * explode]))
  const maxX = Math.max(...layout.floors.map((f) => f.x + f.width))
  const maxZ = Math.max(...layout.floors.map((f) => f.z + f.depth))
  const visibleFloors = layout.floors.filter((f) => !hiddenFloors.has(f.id))

  return (
    <Canvas camera={{ position: [55, 60, 75], fov: 45 }} shadows>
      <color attach="background" args={['#0b1220']} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[40, 80, 30]} intensity={1.2} castShadow />
      <OrbitControls makeDefault target={[0, 8, 0]} maxPolarAngle={Math.PI / 2.05} />
      <gridHelper args={[200, 40, '#1e293b', '#1e293b']} />

      <group position={[-maxX / 2, 0, -maxZ / 2]}>
        {visibleFloors.map((floor) => (
          <FloorSlab key={floor.id} floor={floor} y={floorY.get(floor.id)!} />
        ))}
        {layout.zones
          .filter((z) => !hiddenFloors.has(z.floorId))
          .map((zone) => (
            <ZoneBox
              key={zone.id}
              zone={zone}
              y={floorY.get(zone.floorId)!}
              selected={selectedZoneIds.includes(zone.id)}
              onClick={() => onZoneClick(zone)}
            />
          ))}
        {route && route.nodes.length > 1 && (
          <Line
            points={route.nodes.map((n) => [n.x, floorY.get(n.floorId)! + 0.4, n.z] as [number, number, number])}
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

function FloorSlab({ floor, y }: { floor: Floor; y: number }) {
  const isYard = floor.area === 'yard'
  return (
    <group position={[floor.x + floor.width / 2, y, floor.z + floor.depth / 2]}>
      <mesh receiveShadow position={[0, -0.15, 0]}>
        <boxGeometry args={[floor.width, 0.3, floor.depth]} />
        <meshStandardMaterial color={isYard ? '#334155' : '#1e3a5f'} transparent opacity={0.85} />
      </mesh>
      <Html position={[-floor.width / 2, 0.5, -floor.depth / 2]} className="pointer-events-none">
        <div className="whitespace-nowrap rounded bg-slate-900/80 px-2 py-0.5 text-xs font-semibold text-sky-300">
          {floor.name}
        </div>
      </Html>
    </group>
  )
}

function ZoneBox({ zone, y, selected, onClick }: { zone: Zone; y: number; selected: boolean; onClick: () => void }) {
  const style = ZONE_STYLE[zone.kind]
  const showLabel = zone.kind !== 'stairs' && zone.kind !== 'lift'
  return (
    <group position={[zone.x + zone.width / 2, y + style.height / 2, zone.z + zone.depth / 2]}>
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
        <Html position={[0, style.height / 2 + 0.6, 0]} center className="pointer-events-none">
          <div className="whitespace-nowrap rounded bg-slate-900/70 px-1.5 text-[10px] text-slate-100">{zone.code}</div>
        </Html>
      )}
    </group>
  )
}
