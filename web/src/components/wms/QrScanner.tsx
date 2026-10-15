import jsQR from 'jsqr'
import { useEffect, useRef, useState } from 'react'

/**
 * สแกน QR ด้วยกล้องหลังของ Tablet/มือถือ (ต้องเปิดผ่าน https และอนุญาตกล้อง)
 * เจอแล้วเรียก onCode ครั้งเดียวต่อรหัส แล้วสแกนต่อได้ทันที (โหมดค้าง)
 */
export function QrScanner({ onCode, onClose }: { onCode: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onCodeRef = useRef(onCode)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    onCodeRef.current = onCode
  }, [onCode])

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let last = ''
    let lastAt = 0
    let stopped = false
    const video = videoRef.current!
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!

    const tick = () => {
      if (stopped) return
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const w = video.videoWidth
        const h = video.videoHeight
        const scale = Math.min(1, 720 / Math.max(w, h))
        canvas.width = Math.round(w * scale)
        canvas.height = Math.round(h * scale)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
        const now = Date.now()
        if (code?.data && (code.data !== last || now - lastAt > 2500)) {
          last = code.data
          lastAt = now
          navigator.vibrate?.(60)
          onCodeRef.current(code.data)
        }
      }
      raf = requestAnimationFrame(tick)
    }

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        video.srcObject = s
        void video.play()
        raf = requestAnimationFrame(tick)
      })
      .catch((e: Error) => setError(e.name === 'NotAllowedError' ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง · กดอนุญาตในเบราว์เซอร์ หรือพิมพ์เลขป้ายแทน' : `เปิดกล้องไม่ได้: ${e.message}`))
    if (!navigator.mediaDevices) queueMicrotask(() => setError('เบราว์เซอร์นี้ไม่รองรับกล้อง · พิมพ์เลขป้ายแทน'))

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div className="relative overflow-hidden rounded-xl bg-black">
      <video ref={videoRef} className="aspect-[4/3] w-full object-cover" playsInline muted />
      <canvas ref={canvasRef} className="hidden" />
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="h-1/2 w-1/2 rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
      </div>
      {error && <div className="absolute inset-x-3 bottom-14 rounded-lg bg-rose-600 px-3 py-2 text-sm text-white">{error}</div>}
      <button onClick={onClose} className="absolute bottom-3 right-3 rounded-lg bg-white/90 px-4 py-2 text-sm font-semibold text-slate-800">
        ปิดกล้อง
      </button>
    </div>
  )
}
