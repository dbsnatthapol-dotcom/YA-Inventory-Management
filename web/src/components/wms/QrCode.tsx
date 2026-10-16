import QRCode from 'qrcode'
import { useMemo } from 'react'

/** QR เป็น SVG (สร้างทันที ไม่ต้องรอ) — คมชัดทั้งบนจอและตอนพิมพ์ */
export function QrCode({ text, size = '100%', title }: { text: string; size?: string | number; title?: string }) {
  const { path, n } = useMemo(() => {
    const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
    const count = qr.modules.size
    let d = ''
    for (let y = 0; y < count; y++)
      for (let x = 0; x < count; x++) if (qr.modules.get(x, y)) d += `M${x} ${y}h1v1h-1z`
    return { path: d, n: count }
  }, [text])
  return (
    <svg viewBox={`-2 -2 ${n + 4} ${n + 4}`} width={size} height={size} role="img" aria-label={title ?? text} shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={n + 4} height={n + 4} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  )
}
