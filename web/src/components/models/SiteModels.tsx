import type { ThreeEvent } from '@react-three/fiber'
import { useMemo } from 'react'
import { DoubleSide, Shape, Vector2 } from 'three'
import { BRAND, MATERIAL } from '../../data/brand'
import { companySign, concreteSlab, corrugated, roadSurface, thaiFlag, tiled, windowBay } from './textures'

type Click = { onClick?: (e: ThreeEvent<MouseEvent>) => void }

const pointer = {
  onPointerOver: () => (document.body.style.cursor = 'pointer'),
  onPointerOut: () => (document.body.style.cursor = ''),
}

/** หลังคาจั่ว (ใช้กับโกดังและเต็นท์) วางตามแนวยาว z, กึ่งกลางอยู่ที่ (0, eave, 0) */
function GableRoof({ width, depth, rise, color }: { width: number; depth: number; rise: number; color: string }) {
  const angle = Math.atan(rise / (width / 2))
  const len = Math.hypot(width / 2, rise) + 0.6
  const map = useMemo(() => tiled(corrugated(color, false), 1, depth), [color, depth])
  return (
    <group>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[(side * width) / 4, rise / 2, 0]} rotation={[0, 0, -side * angle]} castShadow receiveShadow>
          <boxGeometry args={[len, 0.2, depth + 1]} />
          <meshStandardMaterial map={map} metalness={0.35} roughness={0.55} />
        </mesh>
      ))}
    </group>
  )
}

/** โกดังผนังเมทัลชีทสีฟ้า (อาคาร D) — x/z คือจุดกึ่งกลาง */
export function Warehouse({ width, depth, height }: { width: number; depth: number; height: number }) {
  const wallMap = useMemo(() => tiled(corrugated(BRAND.trimBlue), Math.max(width, depth)), [width, depth])
  return (
    <group>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial map={wallMap} metalness={0.3} roughness={0.6} />
      </mesh>
      <group position={[0, height, 0]}>
        <GableRoof width={width + 1} depth={depth} rise={2} color={MATERIAL.tentGrey} />
      </group>
    </group>
  )
}

/** เต็นท์โครงเหล็กหลังคาจั่วคู่ ด้านข้างเปิดโล่ง (เต็นท์ B) — มุมซ้ายบนที่ (0,0) */
export function TwinGableTent({ width, depth, onClick }: { width: number; depth: number } & Click) {
  const bays = 2
  const bayW = width / bays
  const eave = 6
  const posts = useMemo(() => {
    const list: [number, number][] = []
    for (let b = 0; b <= bays; b++) for (let z = 0; z <= depth; z += 6) list.push([b * bayW, Math.min(z, depth)])
    return list
  }, [bayW, depth])
  return (
    <group onClick={onClick} {...pointer}>
      {posts.map(([x, z], i) => (
        <mesh key={i} position={[x, eave / 2, z]} castShadow>
          <boxGeometry args={[0.3, eave, 0.3]} />
          <meshStandardMaterial color="#7d8590" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      {Array.from({ length: bays }, (_, b) => (
        <group key={b} position={[b * bayW + bayW / 2, eave, depth / 2]}>
          <GableRoof width={bayW} depth={depth} rise={2.5} color={MATERIAL.tentGrey} />
        </group>
      ))}
      {/* พื้นที่วางสินค้า (พาเลท) ใต้เต็นท์ */}
      <mesh position={[width / 2, 0.02, depth / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width - 1, depth - 1]} />
        <meshStandardMaterial color="#a39c90" />
      </mesh>
      <Pallets width={width} depth={depth} />
    </group>
  )
}

/** เต็นท์ผ้าใบทรงโค้ง (เต็นท์ C) — มุมซ้ายบนที่ (0,0) */
export function ArchTent({ width, depth, onClick }: { width: number; depth: number } & Click) {
  const r = width / 2
  const height = 8.5
  return (
    <group onClick={onClick} {...pointer}>
      <mesh position={[r, 1.2, depth / 2]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, (height - 1.2) / r]} castShadow receiveShadow>
        <cylinderGeometry args={[r, r, depth, 40, 1, true, Math.PI / 2, Math.PI]} />
        <meshStandardMaterial color={MATERIAL.tentDark} side={DoubleSide} roughness={0.85} />
      </mesh>
      {/* ผนังฐานเตี้ย */}
      {[0.15, width - 0.15].map((x) => (
        <mesh key={x} position={[x, 0.6, depth / 2]} castShadow>
          <boxGeometry args={[0.3, 1.2, depth]} />
          <meshStandardMaterial color="#8a8f99" />
        </mesh>
      ))}
      <Pallets width={width} depth={depth} />
    </group>
  )
}

/** ตัวสุ่มที่ให้ผลเหมือนเดิมทุกครั้ง เพื่อให้ฉากไม่เปลี่ยนเมื่อ render ใหม่ */
function seededRandom(seed: number) {
  let state = seed
  return () => {
    state = (state * 9301 + 49297) % 233280
    return state / 233280
  }
}

/** กองพาเลทสินค้าแบบสุ่มคงที่ เพื่อให้เห็นว่าเป็นพื้นที่เก็บของ */
function Pallets({ width, depth }: { width: number; depth: number }) {
  const stacks = useMemo(() => {
    const list: { x: number; z: number; h: number; c: string }[] = []
    const colors = ['#c9a46b', '#b88f58', '#8fa3b8', '#d1c3a5']
    const rand = seededRandom(Math.round(width * 31 + depth * 17))
    for (let x = 3; x < width - 2; x += 3.2)
      for (let z = 3; z < depth - 2; z += 3.2) if (rand() > 0.35) list.push({ x, z, h: 0.8 + rand() * 1.6, c: colors[Math.floor(rand() * colors.length)] })
    return list
  }, [width, depth])
  return (
    <group>
      {stacks.map((s, i) => (
        <mesh key={i} position={[s.x, s.h / 2, s.z]} castShadow receiveShadow>
          <boxGeometry args={[2.2, s.h, 2.2]} />
          <meshStandardMaterial color={s.c} roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}

/** สำนักงานใหญ่ 2 ชั้น: ชั้นล่างกระจก, ชั้นบนผนังขาว, หลังคาปั้นหยาสีฟ้าเหล็ก, ป้ายบริษัท และเสาธง — x/z คือจุดกึ่งกลาง ด้านหน้า = +z */
export function OfficeBuilding({ width, depth }: { width: number; depth: number }) {
  const floorH = 4
  const upperMap = useMemo(() => tiled(windowBay(BRAND.white), width / 6), [width])
  return (
    <group>
      {/* ชั้นล่าง: กระจก + เสาขาว */}
      <mesh position={[0, floorH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width - 1, floorH, depth - 1]} />
        <meshStandardMaterial color={MATERIAL.glass} metalness={0.6} roughness={0.15} />
      </mesh>
      {Array.from({ length: Math.floor(width / 5) + 1 }, (_, i) => -width / 2 + i * 5).map((x) => (
        <mesh key={x} position={[x, floorH / 2, depth / 2 - 0.4]} castShadow>
          <boxGeometry args={[0.6, floorH, 0.6]} />
          <meshStandardMaterial color={BRAND.white} />
        </mesh>
      ))}
      {/* ชั้นบน */}
      <mesh position={[0, floorH * 1.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, floorH, depth]} />
        <meshStandardMaterial map={upperMap} roughness={0.7} />
      </mesh>
      <mesh position={[0, floorH, 0]}>
        <boxGeometry args={[width + 0.6, 0.4, depth + 0.6]} />
        <meshStandardMaterial color={BRAND.trimBlue} />
      </mesh>
      {/* หลังคาปั้นหยา */}
      <group position={[0, floorH * 2 + 1.2, 0]} scale={[(width + 2) / Math.SQRT2, 1, (depth + 2) / Math.SQRT2]}>
        <mesh rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[1, 2.4, 4]} />
          <meshStandardMaterial color={BRAND.roofBlue} metalness={0.35} roughness={0.5} flatShading />
        </mesh>
      </group>
      {/* ป้ายบริษัท */}
      <mesh position={[0, floorH + 1, depth / 2 + 0.05]}>
        <planeGeometry args={[18, 2.25]} />
        <meshStandardMaterial map={companySign()} />
      </mesh>
      {/* เสาธง */}
      {[-4, 0, 4].map((x) => (
        <group key={x} position={[x, 0, depth / 2 + 5]}>
          <mesh position={[0, 5, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.09, 10, 8]} />
            <meshStandardMaterial color="#d9dce1" metalness={0.8} roughness={0.25} />
          </mesh>
          <mesh position={[0.95, 9.2, 0]}>
            <planeGeometry args={[1.8, 1.2]} />
            <meshStandardMaterial map={thaiFlag()} side={DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** ถนน (x/z คือจุดกึ่งกลาง) */
export function Road({ width, depth }: { width: number; depth: number }) {
  const map = useMemo(() => tiled(roadSurface(8), width / 20, 1), [width])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
      <planeGeometry args={[width, depth]} />
      <meshStandardMaterial map={map} roughness={0.95} />
    </mesh>
  )
}

/** พื้นลานคอนกรีต / พื้นที่โล่ง (x/z คือจุดกึ่งกลาง) */
export function PavedArea({ width, depth }: { width: number; depth: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} receiveShadow>
      <planeGeometry args={[width, depth]} />
      <meshStandardMaterial color="#a9a294" roughness={0.95} />
    </mesh>
  )
}

/** พื้นภายในที่ดิน + รั้วเมทัลชีทสีเขียวตามแนวเขต */
export function SiteGround({ boundary }: { boundary: [number, number][] }) {
  // Shape วาดบนระนาบ XY แล้วหมุนลงพื้น: (x, y) → (x, 0, -y) จึงต้องกลับเครื่องหมาย z
  const shape = useMemo(() => new Shape(boundary.map(([x, z]) => new Vector2(x, -z))), [boundary])
  const slab = useMemo(() => tiled(concreteSlab(), 0.25, 0.25), [])
  const fenceMap = corrugated(MATERIAL.fenceGreen)
  const fences = useMemo(
    () =>
      boundary.map(([x1, z1], i) => {
        const [x2, z2] = boundary[(i + 1) % boundary.length]
        const len = Math.hypot(x2 - x1, z2 - z1)
        return { x: (x1 + x2) / 2, z: (z1 + z2) / 2, len, rot: -Math.atan2(z2 - z1, x2 - x1), map: tiled(fenceMap, len / 2) }
      }),
    [boundary, fenceMap],
  )
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial map={slab} roughness={0.95} />
      </mesh>
      {fences.map((f, i) => (
        <mesh key={i} position={[f.x, 1.2, f.z]} rotation={[0, f.rot, 0]} castShadow>
          <planeGeometry args={[f.len, 2.4]} />
          <meshStandardMaterial map={f.map} side={DoubleSide} metalness={0.2} roughness={0.7} />
        </mesh>
      ))}
    </group>
  )
}

/** ต้นไม้แบบเรียบง่าย */
export function Trees({ points }: { points: [number, number][] }) {
  return (
    <group>
      {points.map(([x, z], i) => {
        const s = 0.8 + ((i * 37) % 10) / 20
        return (
          <group key={i} position={[x, 0, z]} scale={s}>
            <mesh position={[0, 1.6, 0]} castShadow>
              <cylinderGeometry args={[0.25, 0.35, 3.2, 6]} />
              <meshStandardMaterial color={MATERIAL.trunk} />
            </mesh>
            <mesh position={[0, 4.6, 0]} castShadow>
              <icosahedronGeometry args={[2.6, 0]} />
              <meshStandardMaterial color={MATERIAL.foliage} flatShading roughness={0.9} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

/**
 * โรงอาหาร (canteen) ชั้นเดียว: ผนังขาว หน้าต่างยาว หลังคาเมทัลชีทสีเทาอ่อนลาดต่ำ
 * ตั้งใจให้เตี้ยและสีอ่อน ไม่บังอาคารโรงงานด้านหลัง — x/z คือจุดกึ่งกลาง, ความยาวตามแกน x
 */
export function Canteen({ width, depth, height = 3.6 }: { width: number; depth: number; height?: number }) {
  const wallMap = useMemo(() => tiled(windowBay(BRAND.white), width / 6, 0.8), [width])
  return (
    <group>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial map={wallMap} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[width + 0.1, 0.6, depth + 0.1]} />
        <meshStandardMaterial color={BRAND.green} roughness={0.6} />
      </mesh>
      {/* หลังคาจั่วต่ำ สันหลังคาตามแนวยาว */}
      <group position={[0, height, 0]} rotation={[0, Math.PI / 2, 0]}>
        <GableRoof width={depth + 1.2} depth={width + 1.2} rise={1.4} color="#d5dbe2" />
      </group>
    </group>
  )
}

/**
 * ทางเข้ารถขนส่ง: เสาประตู 2 ต้น + ไม้กั้นเหลือง-ดำ + ถนนภายในยาว depth (แกน +z = เข้าสู่โรงงาน)
 * x/z ของ landmark = กึ่งกลางแนวประตู
 */
export function TruckGate({ width, depth }: { width: number; depth: number }) {
  const lane = useMemo(() => tiled(roadSurface(2), 1, Math.max(1, depth / 12)), [depth])
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07, depth / 2]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial map={lane} roughness={0.9} polygonOffset polygonOffsetFactor={-3} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side} position={[(side * (width + 0.8)) / 2, 0, 0]}>
          <mesh position={[0, 1.2, 0]} castShadow>
            <boxGeometry args={[0.5, 2.4, 0.5]} />
            <meshStandardMaterial color="#e9edf1" roughness={0.6} />
          </mesh>
          <mesh position={[0, 2.5, 0]}>
            <boxGeometry args={[0.6, 0.2, 0.6]} />
            <meshStandardMaterial color={BRAND.trimBlue} />
          </mesh>
        </group>
      ))}
      {/* ไม้กั้นยกขึ้นครึ่งหนึ่ง (ประตูเปิด) */}
      <group position={[-(width + 0.8) / 2, 1.1, 0.4]} rotation={[0, 0, 0.5]}>
        <mesh position={[width * 0.42, 0, 0]}>
          <boxGeometry args={[width * 0.84, 0.12, 0.12]} />
          <meshStandardMaterial color="#f2c200" />
        </mesh>
      </group>
      {/* ป้อมยาม */}
      <group position={[-(width + 0.8) / 2 - 1.8, 0, 1.6]}>
        <mesh position={[0, 1.3, 0]} castShadow>
          <boxGeometry args={[2, 2.6, 2]} />
          <meshStandardMaterial color="#f4f6f8" roughness={0.6} />
        </mesh>
        <mesh position={[0, 2.7, 0]} castShadow>
          <boxGeometry args={[2.4, 0.2, 2.4]} />
          <meshStandardMaterial color={BRAND.roofBlue} />
        </mesh>
      </group>
    </group>
  )
}
