import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'
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
