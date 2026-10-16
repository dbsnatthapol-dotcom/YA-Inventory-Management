import { Html, Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group, Mesh } from 'three'
import { BRAND } from '../../data/brand'
import { alongPingPong } from '../../lib/guidePaths'

/** ข้อมูลที่ไกด์ประจำจุดสรุปให้เมื่อคลิก */
export interface GuideInfo {
  title: string
  /** หัวหน้าโซน (จากระบบ) หรือบทบาทประจำจุด */
  who: string
  lines: string[]
  tone?: 'ok' | 'warn' | 'bad'
}

const SKIN = '#e9c39f'
const PANTS = '#25324a'
const VEST = '#d8f04a'

/**
 * พนักงาน UAM แบบ low-poly: เสื้อสีน้ำเงินองค์กร เสื้อกั๊กสะท้อนแสง หมวกแก๊ป
 * swing = มุมแกว่งแขนขา (เรเดียน) ตอนเดิน
 */
function StaffFigure({ legL, legR, armL, armR }: { legL: React.RefObject<Group | null>; legR: React.RefObject<Group | null>; armL: React.RefObject<Group | null>; armR: React.RefObject<Group | null> }) {
  return (
    <group>
      {/* ขา (หมุนที่สะโพก) */}
      {([
        [legL, -0.11],
        [legR, 0.11],
      ] as const).map(([ref, x], i) => (
        <group key={i} ref={ref} position={[x, 0.86, 0]}>
          <mesh position={[0, -0.42, 0]} castShadow>
            <boxGeometry args={[0.15, 0.84, 0.17]} />
            <meshStandardMaterial color={PANTS} roughness={0.8} />
          </mesh>
          <mesh position={[0, -0.82, 0.05]}>
            <boxGeometry args={[0.16, 0.09, 0.27]} />
            <meshStandardMaterial color="#1f2328" />
          </mesh>
        </group>
      ))}
      {/* ลำตัว: เสื้อองค์กร + เสื้อกั๊ก */}
      <mesh position={[0, 1.18, 0]} castShadow>
        <boxGeometry args={[0.46, 0.64, 0.26]} />
        <meshStandardMaterial color={BRAND.primary} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.15, 0.001]}>
        <boxGeometry args={[0.48, 0.42, 0.27]} />
        <meshStandardMaterial color={VEST} roughness={0.6} emissive={VEST} emissiveIntensity={0.08} />
      </mesh>
      {/* แถบสะท้อนแสง */}
      <mesh position={[0, 1.05, 0.002]}>
        <boxGeometry args={[0.49, 0.05, 0.275]} />
        <meshStandardMaterial color="#e8eef5" metalness={0.6} roughness={0.25} />
      </mesh>
      {/* แขน (หมุนที่ไหล่) */}
      {([
        [armL, -0.3],
        [armR, 0.3],
      ] as const).map(([ref, x], i) => (
        <group key={i} ref={ref} position={[x, 1.46, 0]}>
          <mesh position={[0, -0.3, 0]} castShadow>
            <boxGeometry args={[0.12, 0.6, 0.14]} />
            <meshStandardMaterial color={BRAND.primary} roughness={0.7} />
          </mesh>
          <mesh position={[0, -0.64, 0]}>
            <boxGeometry args={[0.1, 0.1, 0.11]} />
            <meshStandardMaterial color={SKIN} />
          </mesh>
        </group>
      ))}
      {/* หัว + หมวก */}
      <mesh position={[0, 1.66, 0]} castShadow>
        <sphereGeometry args={[0.15, 16, 12]} />
        <meshStandardMaterial color={SKIN} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.75, 0]}>
        <sphereGeometry args={[0.155, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={BRAND.primary} roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.75, 0.13]} rotation={[0.15, 0, 0]}>
        <boxGeometry args={[0.24, 0.02, 0.14]} />
        <meshStandardMaterial color={BRAND.primary} />
      </mesh>
    </group>
  )
}

/**
 * ไกด์ประจำจุด: เดินตรวจไป-กลับตามทางเดินข้างโซน มีป้ายเพชรลอยเหนือหัว คลิกแล้วหยุดเดินและสรุปข้อมูลของจุดนั้น
 * path = พิกัดในกลุ่มที่วางอยู่ (ภายในชั้น หรือ site สำหรับลานนอก)
 */
export function WalkingGuide({
  path,
  info,
  open,
  onToggle,
  phase = 0,
}: {
  path: [number, number][]
  info: GuideInfo
  open: boolean
  onToggle: () => void
  phase?: number
}) {
  const root = useRef<Group>(null)
  const body = useRef<Group>(null)
  const marker = useRef<Mesh>(null)
  const legL = useRef<Group>(null)
  const legR = useRef<Group>(null)
  const armL = useRef<Group>(null)
  const armR = useRef<Group>(null)
  const walked = useRef(phase * 7)

  useFrame((state, delta) => {
    if (!root.current || !body.current) return
    const dt = Math.min(delta, 0.1)
    // เดิน 1.1 ม./วินาที หยุดเมื่อเปิดดูข้อมูล
    if (!open) walked.current += dt * 1.1
    const p = alongPingPong(path, walked.current)
    root.current.position.set(p.x, 0, p.z)
    body.current.rotation.y = p.heading
    const swing = open ? 0 : Math.sin(walked.current * 5.2) * 0.45
    if (legL.current) legL.current.rotation.x = swing
    if (legR.current) legR.current.rotation.x = -swing
    if (armL.current) armL.current.rotation.x = -swing * 0.8
    if (armR.current) armR.current.rotation.x = open ? -1.9 : swing * 0.8 // เปิดข้อมูล = ยกมือ
    if (marker.current) {
      marker.current.position.y = 2.25 + Math.sin(state.clock.elapsedTime * 2.2 + phase) * 0.08
      marker.current.rotation.y += dt * 1.6
    }
  })

  const color = info.tone === 'bad' ? '#dc2626' : info.tone === 'warn' ? '#f59e0b' : BRAND.primary
  return (
    <group ref={root}>
      <group
        ref={body}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <StaffFigure legL={legL} legR={legR} armL={armL} armR={armR} />
        {/* กล่องรับคลิกให้คลิกง่ายเมื่อมองไกล */}
        <mesh position={[0, 1.1, 0]}>
          <boxGeometry args={[1.1, 2.6, 1.1]} />
          <meshBasicMaterial colorWrite={false} depthWrite={false} />
        </mesh>
      </group>
      <mesh
        ref={marker}
        position={[0, 2.25, 0]}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
      >
        <octahedronGeometry args={[0.2]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.55} />
      </mesh>
      {open && (
        <Html position={[0, 2.7, 0]} center zIndexRange={[40, 30]}>
          <div className="w-64 rounded-2xl bg-white/95 p-3 text-left text-xs text-slate-700 shadow-[0_12px_40px_-12px_rgba(15,40,80,0.55)] ring-1 ring-slate-200 backdrop-blur">
            <div className="flex items-start gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold text-white" style={{ background: BRAND.primary }}>
                👷
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold" style={{ color: BRAND.primary }}>
                  {info.title}
                </div>
                <div className="truncate text-[11px] text-slate-500">{info.who}</div>
              </div>
              <button
                className="rounded-md px-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggle()
                }}
                aria-label="ปิด"
              >
                ✕
              </button>
            </div>
            <ul className="mt-2 space-y-1">
              {info.lines.map((l) => (
                <li key={l} className="flex gap-1.5">
                  <span style={{ color }}>•</span>
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          </div>
        </Html>
      )}
    </group>
  )
}

/** พาเลทเรืองแสงวิ่งตามเส้นทางจริง (Live flow) วนซ้ำทุก period วินาที */
export function FlowToken({ points, delay, color, label }: { points: [number, number, number][]; delay: number; color: string; label: string }) {
  const ref = useRef<Group>(null)
  const lens = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1], p[2] - points[i][2]))
  const total = lens.reduce((a, b) => a + b, 0)
  // ความเร็วคงที่ ~14 ม./วินาที (เร่งให้เห็นการไหล) + พัก 2 วินาที
  const duration = Math.max(3, total / 14)
  const period = duration + 2

  useFrame(({ clock }) => {
    const g = ref.current
    if (!g) return
    const t = (clock.elapsedTime - delay) % period
    if (clock.elapsedTime < delay || t > duration) {
      g.visible = false
      return
    }
    g.visible = true
    let d = (t / duration) * total
    for (let i = 0; i < lens.length; i++) {
      if (d <= lens[i] || i === lens.length - 1) {
        const k = lens[i] ? Math.min(1, d / lens[i]) : 0
        const a = points[i]
        const b = points[i + 1]
        g.position.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k)
        return
      }
      d -= lens[i]
    }
  })

  if (points.length < 2) return null
  return (
    <>
      <Line points={points} color={color} lineWidth={2} dashed dashSize={1.2} gapSize={0.8} transparent opacity={0.55} depthTest={false} renderOrder={9} />
      <group ref={ref} visible={false}>
        <mesh position={[0, 0.45, 0]} renderOrder={11}>
          <boxGeometry args={[1.1, 0.8, 1.1]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} transparent opacity={0.92} depthTest={false} />
        </mesh>
        <Html position={[0, 1.6, 0]} center className="pointer-events-none" zIndexRange={[20, 10]}>
          <div className="whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold text-white shadow" style={{ background: color }}>
            {label}
          </div>
        </Html>
      </group>
    </>
  )
}
