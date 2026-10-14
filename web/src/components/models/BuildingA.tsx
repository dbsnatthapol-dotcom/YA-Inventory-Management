import type { ThreeEvent } from '@react-three/fiber'
import { useMemo } from 'react'
import { DoubleSide, Shape } from 'three'
import { BRAND, MATERIAL } from '../../data/brand'
import { companySign, corrugated, groundBay, tiled, windowBay } from './textures'

interface Props {
  width: number
  depth: number
  floors: number
  floorHeight: number
  onClick?: (e: ThreeEvent<MouseEvent>) => void
}

const BAY = 6 // ความกว้างช่วงผนัง/หน้าต่าง (ม.)
const ROOF_RISE = 5
const OVERHANG = 1.2

/**
 * อาคารหลัก A (ภายนอก): ผนังเมทัลชีทสีครีม + หน้าต่างบานยาว, แถบสีฟ้าเหล็กคั่นแต่ละชั้น,
 * ชั้นล่างผนังปูนสีขาว, หลังคาจั่วสีน้ำตาลสนิมพร้อมแนวแผ่นโปร่งแสง, ป้ายชื่อบริษัทด้านหน้า (ฝั่งถนน)
 * พิกัดภายใน: x = 0..width, z = 0..depth, ด้านหน้าอยู่ที่ z = depth
 */
export function BuildingA({ width: W, depth: D, floors, floorHeight: H, onClick }: Props) {
  const top = floors * H
  const slopeAngle = Math.atan(ROOF_RISE / (W / 2))
  const slopeLen = Math.hypot(W / 2 + OVERHANG, ROOF_RISE + OVERHANG * Math.tan(slopeAngle))

  const walls = useMemo(() => {
    const sides = [
      { len: W, pos: [W / 2, 0, D] as const, rot: 0 },
      { len: W, pos: [W / 2, 0, 0] as const, rot: Math.PI },
      { len: D, pos: [0, 0, D / 2] as const, rot: -Math.PI / 2 },
      { len: D, pos: [W, 0, D / 2] as const, rot: Math.PI / 2 },
    ]
    return Array.from({ length: floors }, (_, level) =>
      sides.map((s) => ({
        ...s,
        y: level * H + H / 2,
        map: tiled(level === 0 ? groundBay() : windowBay(), s.len / BAY),
      })),
    ).flat()
  }, [W, D, floors, H])

  const gable = useMemo(() => {
    const s = new Shape()
    s.moveTo(0, 0)
    s.lineTo(W, 0)
    s.lineTo(W / 2, ROOF_RISE)
    s.closePath()
    return s
  }, [W])
  const gableMap = useMemo(() => tiled(corrugated(BRAND.siding), W, ROOF_RISE), [W])
  const roofMap = useMemo(() => tiled(corrugated(BRAND.roofBlue, false), 1, D), [D])

  return (
    <group onClick={onClick} onPointerOver={() => (document.body.style.cursor = 'pointer')} onPointerOut={() => (document.body.style.cursor = '')}>
      {walls.map((w, i) => (
        <mesh key={i} position={[w.pos[0], w.y, w.pos[2]]} rotation={[0, w.rot, 0]} castShadow receiveShadow>
          <planeGeometry args={[w.len, H]} />
          <meshStandardMaterial map={w.map} roughness={0.7} metalness={0.15} />
        </mesh>
      ))}
      {/* ปิดทึบภายในเพื่อไม่ให้มองทะลุช่องว่างระหว่างผนัง */}
      <mesh position={[W / 2, top / 2, D / 2]}>
        <boxGeometry args={[W - 0.2, top - 0.1, D - 0.2]} />
        <meshStandardMaterial color="#565c66" />
      </mesh>

      {/* แถบสีฟ้าเหล็กคั่นชั้น และชายคาด้านบน */}
      {Array.from({ length: floors }, (_, i) => (
        <mesh key={i} position={[W / 2, (i + 1) * H - 0.15, D / 2]} castShadow>
          <boxGeometry args={[W + 0.7, i === floors - 1 ? 0.9 : 0.5, D + 0.7]} />
          <meshStandardMaterial color={i === floors - 1 ? BRAND.roofBlue : BRAND.trimBlue} roughness={0.5} metalness={0.3} />
        </mesh>
      ))}

      {/* กันสาดหน้าอาคารชั้นล่าง + เสาสีขาว (ตามภาพหน้าโรงงาน) */}
      <mesh position={[W / 2, 3.3, D + 1.6]} castShadow>
        <boxGeometry args={[W, 0.25, 3.2]} />
        <meshStandardMaterial color={BRAND.roofBlue} metalness={0.3} roughness={0.5} />
      </mesh>
      {Array.from({ length: Math.floor(W / 10) + 1 }, (_, i) => i * (W / Math.floor(W / 10))).map((x) => (
        <group key={x} position={[x, 0, D + 3]}>
          <mesh position={[0, 1.6, 0]} castShadow>
            <cylinderGeometry args={[0.32, 0.32, 3.2, 16]} />
            <meshStandardMaterial color={BRAND.white} roughness={0.6} />
          </mesh>
          <mesh position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.36, 0.36, 0.6, 16]} />
            <meshStandardMaterial color={BRAND.green} />
          </mesh>
        </group>
      ))}

      {/* พื้น epoxy หน้าอาคาร: เขียว พร้อมทางเดินสีเหลือง */}
      <mesh position={[W / 2, 0.03, D + 3]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W, 6]} />
        <meshStandardMaterial color={MATERIAL.epoxyGreen} roughness={0.35} />
      </mesh>
      <mesh position={[W / 2, 0.04, D + 5.2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W, 1.6]} />
        <meshStandardMaterial color={BRAND.safetyYellow} roughness={0.35} />
      </mesh>

      {/* หน้าจั่ว */}
      {[0, D].map((z) => (
        <mesh key={z} position={[0, top, z]}>
          <shapeGeometry args={[gable]} />
          <meshStandardMaterial map={gableMap} side={DoubleSide} roughness={0.7} />
        </mesh>
      ))}

      {/* หลังคาจั่ว 2 ฝั่ง */}
      {[-1, 1].map((side) => (
        <group
          key={side}
          position={[W / 2 + (side * (W / 2 + OVERHANG)) / 2, top + ROOF_RISE / 2 - (OVERHANG * Math.tan(slopeAngle)) / 2, D / 2]}
          rotation={[0, 0, -side * slopeAngle]}
        >
          <mesh castShadow receiveShadow>
            <boxGeometry args={[slopeLen, 0.25, D + OVERHANG * 2]} />
            <meshStandardMaterial map={roofMap} roughness={0.6} metalness={0.35} />
          </mesh>
          {/* แนวแผ่นหลังคาโปร่งแสง (เห็นในภาพดาวเทียม) */}
          <mesh position={[side * -slopeLen * 0.12, 0.14, 0]}>
            <boxGeometry args={[2.2, 0.04, D]} />
            <meshStandardMaterial color={MATERIAL.roofSkylight} roughness={0.3} />
          </mesh>
          {/* ชายคาสีฟ้าเหล็ก */}
          <mesh position={[(side * slopeLen) / 2, -0.1, 0]}>
            <boxGeometry args={[0.35, 0.55, D + OVERHANG * 2]} />
            <meshStandardMaterial color={BRAND.roofBlue} metalness={0.3} roughness={0.5} />
          </mesh>
        </group>
      ))}
      {/* สันหลังคา */}
      <mesh position={[W / 2, top + ROOF_RISE + 0.1, D / 2]}>
        <boxGeometry args={[1, 0.3, D + OVERHANG * 2]} />
        <meshStandardMaterial color={BRAND.roofBlue} />
      </mesh>

      {/* ป้ายชื่อบริษัท ชั้นบนสุดด้านหน้า */}
      <mesh position={[W / 2, top - H / 2 - 0.2, D + 0.06]}>
        <planeGeometry args={[34, 4.25]} />
        <meshStandardMaterial map={companySign()} roughness={0.6} />
      </mesh>
    </group>
  )
}
