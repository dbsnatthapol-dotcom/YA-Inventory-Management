/**
 * เสียง + สั่น ตอนสแกน: รู้ผลโดยไม่ต้องก้มดูจอ
 * scan = เจอป้าย · ok = บันทึกสำเร็จ · warn = นับไม่ตรง / ต้องตรวจเพิ่ม · bad = ไม่พบ / ผิดพลาด
 * สั่นได้เฉพาะมือถือที่รองรับ (Android) · iPhone มีแต่เสียง · ปิดเสียงได้ต่อเครื่อง
 */
export type Cue = 'scan' | 'ok' | 'warn' | 'bad'

const KEY = 'uam-scan-sound'

/** [ความถี่ Hz, มิลลิวินาที] ต่อเสียง · เว้น 60 มิลลิวินาทีระหว่างเสียง */
export const TONES: Record<Cue, { wave: OscillatorType; notes: [number, number][]; vibrate: number[] }> = {
  scan: { wave: 'sine', notes: [[1760, 70]], vibrate: [30] },
  ok: { wave: 'sine', notes: [[880, 90], [1320, 120]], vibrate: [40, 40, 40] },
  warn: { wave: 'triangle', notes: [[660, 140], [660, 140]], vibrate: [90, 70, 90] },
  bad: { wave: 'square', notes: [[220, 320]], vibrate: [220, 90, 220] },
}

export function soundOn() {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // ไม่มีที่เก็บ: ใช้ค่าเริ่มต้น (เปิด)
  }
}

let ctx: AudioContext | null = null
const audio = () => {
  if (ctx) return ctx
  const Ctor = typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  ctx = Ctor ? new Ctor() : null
  return ctx
}

/** เบราว์เซอร์ให้เล่นเสียงหลังผู้ใช้แตะจอครั้งแรกเท่านั้น: ปลดล็อกไว้ก่อน เสียงจากกล้องสแกนจะได้ดังทันที */
export function unlockSound() {
  if (typeof window === 'undefined') return
  const unlock = () => {
    const c = audio()
    if (c?.state === 'suspended') void c.resume()
  }
  window.addEventListener('pointerdown', unlock, { once: true, capture: true })
  window.addEventListener('keydown', unlock, { once: true, capture: true })
}

export function cue(kind: Cue) {
  if (!soundOn()) return
  const tone = TONES[kind]
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(tone.vibrate)
  } catch {
    // บางเครื่องห้ามสั่นจากหน้าเว็บ
  }
  const c = audio()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  let t = c.currentTime + 0.01
  for (const [freq, ms] of tone.notes) {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = tone.wave
    osc.frequency.value = freq
    // เปิด-ปิดเสียงนุ่ม ๆ ไม่ให้มีเสียงคลิก
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000)
    osc.connect(gain).connect(c.destination)
    osc.start(t)
    osc.stop(t + ms / 1000 + 0.02)
    t += ms / 1000 + 0.06
  }
}
