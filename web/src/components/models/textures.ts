import { CanvasTexture, ClampToEdgeWrapping, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'
import logoUrl from '../../assets/uam-logo.png'
import { BRAND } from '../../data/brand'

// สร้าง texture ด้วย canvas เพื่อไม่ต้องโหลดไฟล์ภาพจากภายนอก
const cache = new Map<string, CanvasTexture>()

function make(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  let tex = cache.get(key)
  if (!tex) {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    draw(canvas.getContext('2d')!)
    tex = new CanvasTexture(canvas)
    tex.colorSpace = SRGBColorSpace
    tex.wrapS = tex.wrapT = RepeatWrapping
    tex.anisotropy = 4
    cache.set(key, tex)
  }
  return tex
}

/** คืน texture ที่ใช้ภาพเดียวกันแต่กำหนดจำนวนครั้งที่ปูซ้ำเองได้ */
export function tiled(tex: Texture, repeatX: number, repeatY = 1): Texture {
  const t = tex.clone()
  t.repeat.set(repeatX, repeatY)
  t.needsUpdate = true
  return t
}

/** แผ่นเมทัลชีทลอนตั้ง (1 ช่อง = 1 ม.) */
export function corrugated(color: string, vertical = true) {
  return make(`corr-${color}-${vertical}`, 64, 64, (g) => {
    g.fillStyle = color
    g.fillRect(0, 0, 64, 64)
    for (let i = 0; i < 64; i += 8) {
      const grad = vertical ? g.createLinearGradient(i, 0, i + 8, 0) : g.createLinearGradient(0, i, 0, i + 8)
      grad.addColorStop(0, 'rgba(0,0,0,0.16)')
      grad.addColorStop(0.5, 'rgba(255,255,255,0.14)')
      grad.addColorStop(1, 'rgba(0,0,0,0.16)')
      g.fillStyle = grad
      if (vertical) g.fillRect(i, 0, 8, 64)
      else g.fillRect(0, i, 64, 8)
    }
  })
}

/** ผนัง 1 ชั้น (สูง 4.5 ม.) ช่วงละ 6 ม.: เมทัลชีทสีขาวลอนแนวนอน + หน้าต่างกรอบดำบานเลื่อน (ตามภาพหน้าโรงงาน) */
export function windowBay(wall: string = BRAND.siding) {
  return make(`bay-${wall}`, 192, 144, (g) => {
    g.fillStyle = wall
    g.fillRect(0, 0, 192, 144)
    // ลอนแนวนอน: เงาบาง ๆ ทุก 6 px
    for (let y = 0; y < 144; y += 6) {
      g.fillStyle = 'rgba(40,60,80,0.08)'
      g.fillRect(0, y, 192, 2)
      g.fillStyle = 'rgba(255,255,255,0.5)'
      g.fillRect(0, y + 2, 192, 1)
    }
    // หน้าต่าง: กรอบดำ แบ่ง 4 บาน กระจกสะท้อนฟ้า
    g.fillStyle = '#2b2f36'
    g.fillRect(20, 40, 152, 62)
    const glass = g.createLinearGradient(0, 44, 0, 98)
    glass.addColorStop(0, '#8fb4d6')
    glass.addColorStop(0.45, '#45627f')
    glass.addColorStop(1, '#1f2d3d')
    g.fillStyle = glass
    g.fillRect(24, 44, 144, 54)
    g.fillStyle = '#2b2f36'
    for (let x = 24 + 36; x < 168; x += 36) g.fillRect(x - 2, 44, 4, 54)
    g.fillRect(24, 69, 144, 3)
    // คราบฝนใต้หน้าต่าง
    const streak = g.createLinearGradient(0, 102, 0, 140)
    streak.addColorStop(0, 'rgba(90,90,80,0.12)')
    streak.addColorStop(1, 'rgba(90,90,80,0)')
    g.fillStyle = streak
    g.fillRect(24, 102, 144, 38)
  })
}

/** ชั้นล่าง: ผนังขาว + แถบเขียวด้านล่าง + ประตูม้วนเหล็ก (ตามภาพหน้าโรงงาน) */
export function groundBay() {
  return make('ground-bay', 192, 144, (g) => {
    g.fillStyle = BRAND.white
    g.fillRect(0, 0, 192, 144)
    g.fillStyle = BRAND.green
    g.fillRect(0, 112, 192, 32)
    g.fillStyle = '#9aa0a6' // ประตูม้วนเหล็ก
    g.fillRect(36, 30, 120, 114)
    for (let y = 30; y < 144; y += 4) {
      g.fillStyle = 'rgba(0,0,0,0.14)'
      g.fillRect(36, y, 120, 1)
    }
    g.fillStyle = '#6b7178'
    g.fillRect(32, 24, 128, 8) // กล่องม้วนประตู
  })
}

let logoImage: HTMLImageElement | null = null
const logoWaiters: (() => void)[] = []

/** โหลดโลโก้ครั้งเดียว แล้ววาดลง texture ที่รออยู่ */
function withLogo(draw: (img: HTMLImageElement) => void) {
  if (logoImage?.complete && logoImage.naturalWidth) return draw(logoImage)
  logoWaiters.push(() => draw(logoImage!))
  if (!logoImage) {
    logoImage = new Image()
    logoImage.onload = () => logoWaiters.splice(0).forEach((fn) => fn())
    logoImage.src = logoUrl
  }
}

/** ป้ายชื่อบริษัท: โลโก้ UAM + ชื่อบริษัทสีน้ำเงินบนผนังขาว */
export function companySign(text: string = BRAND.companyName) {
  const tex = make(`sign-${text}`, 2048, 256, (g) => {
    g.fillStyle = BRAND.siding
    g.fillRect(0, 0, 2048, 256)
    g.fillStyle = BRAND.signBlue
    g.font = 'bold 118px "Arial Black", Arial, sans-serif'
    g.textBaseline = 'middle'
    g.fillText(text, 280, 136, 1740)
  })
  if (!tex.userData.logo) {
    tex.userData.logo = true
    withLogo((img) => {
      const g = (tex.image as HTMLCanvasElement).getContext('2d')!
      const h = 210
      const w = (img.naturalWidth / img.naturalHeight) * h
      g.drawImage(img, 30 + (230 - w) / 2, 23, w, h)
      tex.needsUpdate = true
    })
  }
  return tex
}

/** พื้นถนนยางมะตอยพร้อมเส้นแบ่งช่องจราจร (ความกว้างถนน = ความสูง texture) */
export function roadSurface(lanes: number) {
  return make(`road-${lanes}`, 256, 512, (g) => {
    g.fillStyle = '#3a3d43'
    g.fillRect(0, 0, 256, 512)
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`
      g.fillRect(Math.random() * 256, Math.random() * 512, 2, 2)
    }
    g.fillStyle = '#f2f2ee'
    const lane = 512 / lanes
    for (let i = 1; i < lanes; i++) {
      const y = i * lane
      if (i === lanes / 2) {
        g.fillStyle = '#e8c547'
        g.fillRect(0, y - 4, 256, 8)
        g.fillStyle = '#f2f2ee'
      } else {
        g.fillRect(0, y - 2, 128, 4)
      }
    }
    g.fillRect(0, 6, 256, 4)
    g.fillRect(0, 502, 256, 4)
  })
}

/** ลานคอนกรีตมีรอยต่อ (1 แผ่น = 4 ม.) */
export function concreteSlab() {
  return make('concrete', 128, 128, (g) => {
    g.fillStyle = '#bdb6aa'
    g.fillRect(0, 0, 128, 128)
    for (let i = 0; i < 1500; i++) {
      const v = Math.random() < 0.5 ? 0 : 255
      g.fillStyle = `rgba(${v},${v},${v},0.05)`
      g.fillRect(Math.random() * 128, Math.random() * 128, 3, 3)
    }
    g.fillStyle = 'rgba(80,70,60,0.25)'
    g.fillRect(0, 0, 128, 1)
    g.fillRect(0, 0, 1, 128)
  })
}

/** ธงชาติไทย */
export function thaiFlag() {
  return make('flag-th', 90, 60, (g) => {
    const stripes = ['#a51931', '#f4f5f8', '#2d2a4a', '#2d2a4a', '#f4f5f8', '#a51931']
    stripes.forEach((c, i) => {
      g.fillStyle = c
      g.fillRect(0, i * 10, 90, 10)
    })
  })
}

/** แถบเตือนอันตรายเหลือง-ดำ (ทแยง 45°) ใช้ที่ฐานเสา บันได ลิฟต์ */
export function hazardStripes() {
  return make('hazard', 64, 64, (g) => {
    g.fillStyle = '#f2c200'
    g.fillRect(0, 0, 64, 64)
    g.fillStyle = '#1d1d1f'
    for (let i = -64; i < 128; i += 32) {
      g.beginPath()
      g.moveTo(i, 0)
      g.lineTo(i + 16, 0)
      g.lineTo(i + 16 + 64, 64)
      g.lineTo(i + 64, 64)
      g.fill()
    }
  })
}

/** ตัวอักษรพ่น/ป้ายชื่อ บนพื้นโปร่งใส หรือบนแผ่นป้าย */
export function textLabel(text: string, color = '#ffffff', background?: string) {
  const w = 512
  const h = 128
  const tex = make(`text-${text}-${color}-${background}`, w, h, (g) => {
    if (background) {
      g.fillStyle = background
      g.fillRect(0, 0, w, h)
    }
    g.fillStyle = color
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    let size = 92
    do {
      g.font = `bold ${size}px "Noto Sans Thai", "Sarabun", Tahoma, sans-serif`
      size -= 4
    } while (g.measureText(text).width > w - 24 && size > 20)
    g.fillText(text, w / 2, h / 2 + 4)
  })
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping
  return tex
}

export interface FloorPaint {
  width: number
  depth: number
  /** ทางเดินรถยก/คน (เส้นกึ่งกลาง) พิกัดภายในชั้น */
  aisles: [number, number, number, number][]
  /** พื้นที่ห้ามวางของ ลายเหลือง-ดำ */
  hazards: { x: number; z: number; width: number; depth: number }[]
  /** ทางม้าลายหน้าประตู */
  crossings: { x: number; z: number; width: number; depth: number }[]
  columns: [number, number][]
}

const PX = 16 // พิกเซลต่อเมตร
export const AISLE_WIDTH = 3

/**
 * พื้น epoxy สีเขียว ตีเส้นตามมาตรฐาน 5S:
 * เส้นเหลือง = ขอบทางเดินรถยก/คน, เส้นประขาว = เส้นแบ่งช่องทาง, ลายเหลือง-ดำ = จุดอันตราย
 * สร้างใหม่ทุกครั้งที่ผังเปลี่ยน (ผู้เรียกต้อง dispose texture เดิม)
 */
export function floorMarkings(paint: FloorPaint): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(paint.width * PX)
  canvas.height = Math.round(paint.depth * PX)
  const g = canvas.getContext('2d')!
  const m = (v: number) => v * PX

  // พื้น epoxy + รอยต่อแผ่นพื้นทุก 6 ม.
  g.fillStyle = '#93c2a8'
  g.fillRect(0, 0, canvas.width, canvas.height)
  let seed = 7
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280), seed / 233280)
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(255,255,255,${0.01 + rand() * 0.02})`
    g.beginPath()
    g.ellipse(rand() * canvas.width, rand() * canvas.height, 20 + rand() * 90, 10 + rand() * 50, rand() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
  g.strokeStyle = 'rgba(30,70,50,0.10)'
  g.lineWidth = 1
  for (let x = 6; x < paint.width; x += 6) line(g, m(x), 0, m(x), canvas.height)
  for (let z = 6; z < paint.depth; z += 6) line(g, 0, m(z), canvas.width, m(z))

  // ทางเดิน: วาดแถบเหลืองกว้างกว่า แล้วทับด้วยพื้นทางเดิน ⇒ ได้ขอบเหลืองรอบทางเดินทั้งหมด รวมทั้งทางแยก
  g.lineCap = 'square'
  g.strokeStyle = '#f2c200'
  g.lineWidth = m(AISLE_WIDTH + 0.24)
  for (const [ax, az, bx, bz] of paint.aisles) line(g, m(ax), m(az), m(bx), m(bz))
  g.strokeStyle = '#80b598'
  g.lineWidth = m(AISLE_WIDTH)
  for (const [ax, az, bx, bz] of paint.aisles) line(g, m(ax), m(az), m(bx), m(bz))
  g.lineCap = 'butt'
  g.strokeStyle = 'rgba(255,255,255,0.9)'
  g.lineWidth = m(0.1)
  g.setLineDash([m(1), m(1)])
  for (const [ax, az, bx, bz] of paint.aisles) line(g, m(ax), m(az), m(bx), m(bz))
  g.setLineDash([])

  // ทางม้าลาย
  g.fillStyle = 'rgba(255,255,255,0.9)'
  for (const c of paint.crossings) {
    const across = c.width >= c.depth
    for (let s = 0.25; s < (across ? c.width : c.depth); s += 0.9)
      if (across) g.fillRect(m(c.x + s), m(c.z), m(0.5), m(c.depth))
      else g.fillRect(m(c.x), m(c.z + s), m(c.width), m(0.5))
  }

  // พื้นที่อันตราย
  for (const h of paint.hazards) hatch(g, m(h.x), m(h.z), m(h.width), m(h.depth))
  // กรอบรอบฐานเสา
  for (const [x, z] of paint.columns) hatch(g, m(x - 0.6), m(z - 0.6), m(1.2), m(1.2))

  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function line(g: CanvasRenderingContext2D, ax: number, az: number, bx: number, bz: number) {
  g.beginPath()
  g.moveTo(ax, az)
  g.lineTo(bx, bz)
  g.stroke()
}

function hatch(g: CanvasRenderingContext2D, x: number, z: number, w: number, h: number) {
  g.save()
  g.beginPath()
  g.rect(x, z, w, h)
  g.clip()
  g.fillStyle = '#f2c200'
  g.fillRect(x, z, w, h)
  g.strokeStyle = '#1d1d1f'
  g.lineWidth = 6
  for (let i = -h; i < w; i += 16) line(g, x + i, z + h, x + i + h, z)
  g.restore()
  g.strokeStyle = '#f2c200'
  g.lineWidth = 2
  g.strokeRect(x, z, w, h)
}
