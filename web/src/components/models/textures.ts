import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'
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

/** ผนัง 1 ชั้น (สูง 4.5 ม.) ช่วงละ 6 ม.: ผนังลอนสีครีม + หน้าต่างกระจกบานยาว */
export function windowBay(wall: string = BRAND.cream) {
  return make(`bay-${wall}`, 192, 144, (g) => {
    g.fillStyle = wall
    g.fillRect(0, 0, 192, 144)
    for (let x = 0; x < 192; x += 6) {
      g.fillStyle = 'rgba(0,0,0,0.07)'
      g.fillRect(x, 0, 2, 144)
    }
    // หน้าต่าง: กรอบอะลูมิเนียม + กระจกสะท้อนฟ้า
    g.fillStyle = '#c9ccd0'
    g.fillRect(24, 44, 144, 58)
    const glass = g.createLinearGradient(0, 48, 0, 98)
    glass.addColorStop(0, '#5d7896')
    glass.addColorStop(1, '#22344a')
    g.fillStyle = glass
    g.fillRect(28, 48, 136, 50)
    g.fillStyle = '#c9ccd0'
    for (let x = 28 + 34; x < 164; x += 34) g.fillRect(x, 48, 3, 50)
    // ขอบล่างเปื้อนฝุ่นเล็กน้อย
    const dirt = g.createLinearGradient(0, 120, 0, 144)
    dirt.addColorStop(0, 'rgba(0,0,0,0)')
    dirt.addColorStop(1, 'rgba(60,50,40,0.18)')
    g.fillStyle = dirt
    g.fillRect(0, 120, 192, 24)
  })
}

/** ชั้นล่าง: ผนังปูนสีขาว + ประตูม้วน/ประตูทางเข้า */
export function groundBay() {
  return make('ground-bay', 192, 144, (g) => {
    g.fillStyle = BRAND.white
    g.fillRect(0, 0, 192, 144)
    g.fillStyle = 'rgba(0,0,0,0.05)'
    for (let y = 0; y < 144; y += 12) g.fillRect(0, y, 192, 1)
    g.fillStyle = '#a7adb5' // ประตูม้วนเหล็ก
    g.fillRect(40, 40, 112, 104)
    g.fillStyle = 'rgba(0,0,0,0.12)'
    for (let y = 40; y < 144; y += 5) g.fillRect(40, y, 112, 1)
    g.fillStyle = BRAND.cladBlue
    g.fillRect(0, 0, 192, 10)
  })
}

/** ป้ายชื่อบริษัทพร้อมโลโก้ */
export function companySign(text: string = BRAND.companyName) {
  return make(`sign-${text}`, 2048, 256, (g) => {
    g.fillStyle = BRAND.cream
    g.fillRect(0, 0, 2048, 256)
    // โลโก้ (ใกล้เคียง): กรอบสี่เหลี่ยมกรมท่า ตัว U สีขาว
    g.fillStyle = BRAND.navy
    g.beginPath()
    g.roundRect(40, 38, 180, 180, 24)
    g.fill()
    g.strokeStyle = '#ffffff'
    g.lineWidth = 26
    g.beginPath()
    g.moveTo(88, 70)
    g.lineTo(88, 140)
    g.arc(130, 140, 42, Math.PI, 0, true)
    g.lineTo(172, 70)
    g.stroke()
    g.fillStyle = BRAND.navy
    g.font = 'bold 120px "Arial Black", Arial, sans-serif'
    g.textBaseline = 'middle'
    g.fillText(text, 270, 136, 1740)
  })
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
