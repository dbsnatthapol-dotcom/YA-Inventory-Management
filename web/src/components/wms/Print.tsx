import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PrintFormat } from '../../wms/labels'
import { Alert, BigButton, Field, inputCls } from './ui'

const PAGE_CSS: Record<PrintFormat, string> = {
  label: '@page { size: 100mm 150mm; margin: 0 }',
  sheet: '@page { size: A4; margin: 0 }',
  a4: '@page { size: A4; margin: 0 }',
}

/**
 * หน้าตัวอย่างก่อนพิมพ์ (เต็มจอ) → กด "พิมพ์" ปุ่มเดียว
 * ตอนพิมพ์ใส่เนื้อหาไว้ใน #uam-print นอกแอป แล้วซ่อนส่วนอื่นด้วย CSS (ดู index.css)
 */
export function PrintDialog({
  open,
  onClose,
  format,
  title,
  subtitle,
  printLabel,
  onPrinted,
  notice,
  initialCopies = 1,
  children,
}: {
  open: boolean
  onClose: () => void
  format: PrintFormat
  title: string
  subtitle: string
  printLabel: string
  /** หลังพิมพ์ออกครบ (ใช้ปิดงานในคิวพิมพ์) · ถามคนพิมพ์ก่อน เพราะกดยกเลิกหน้าต่างพิมพ์ก็นับว่าหน้าต่างปิด */
  onPrinted?: () => void
  /** ข้อความเตือนเหนือตัวอย่าง (เช่น จำนวนป้ายไม่ตรงงานในคิว) */
  notice?: string | null
  initialCopies?: number
  children: ReactNode
}) {
  const [printing, setPrinting] = useState(false)
  const [asking, setAsking] = useState(false)
  const [copies, setCopies] = useState(initialCopies)
  const ask = !!onPrinted
  // ย่อตัวอย่างให้พอดีจอแคบ: กว้างหน้า (มม. × 3.78 px) + ขอบของหน้าต่างนี้
  const fit = typeof window === 'undefined' ? 1 : Math.min(1, (window.innerWidth - 88) / ((format === 'label' ? 100 : 210) * 3.78))

  useEffect(() => {
    if (!printing) return
    const done = () => {
      setPrinting(false)
      if (ask) setAsking(true)
    }
    window.addEventListener('afterprint', done)
    // รอให้ portal วาดเสร็จก่อนเปิดหน้าต่างพิมพ์ของเครื่อง
    const t = window.setTimeout(() => window.print(), 80)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('afterprint', done)
    }
  }, [printing, ask])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-[60] flex justify-center bg-slate-900/60 p-3" role="dialog" aria-modal="true" aria-labelledby="print-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
            <div>
              <h2 id="print-title" className="text-lg font-bold text-slate-800">
                {title}
              </h2>
              <p className="text-sm text-slate-500">{subtitle}</p>
            </div>
            <BigButton tone="secondary" onClick={onClose}>
              ปิด
            </BigButton>
          </div>
          <div className="flex flex-wrap items-end gap-3 px-5 pt-3">
            <div className="w-28">
              <Field label="จำนวนชุด">
                <input id="print-copies" type="number" min={1} max={10} inputMode="numeric" className={inputCls} value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(10, Math.floor(Number(e.target.value) || 1))))} />
              </Field>
            </div>
            <p className="pb-2 text-xs text-slate-500">
              หน้าต่างพิมพ์ของเครื่องจะเปิดขึ้น · เลือกเครื่องพิมพ์ {format === 'label' ? 'ฉลาก (กระดาษ 100×150 มม.)' : 'A4'} แล้วกดพิมพ์
            </p>
          </div>
          {notice && (
            <div className="mx-5 mt-3">
              <Alert tone="warn">{notice}</Alert>
            </div>
          )}
          <div className="m-5 mt-3 min-h-0 flex-1 overflow-auto rounded-xl bg-slate-100 p-4">
            {/* safe center: หน้า A4 กว้างกว่าจอมือถือต้องเลื่อนดูได้ทั้งสองข้าง · จอแคบย่อให้พอดีความกว้าง (ตอนพิมพ์ใช้ขนาดจริง) */}
            <div className="flex flex-wrap gap-4 [justify-content:safe_center]" style={fit < 1 ? { zoom: fit } : undefined}>
              {children}
            </div>
          </div>
          {asking ? (
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 bg-amber-50 px-5 py-3">
              <span className="mr-auto text-sm font-semibold text-amber-900">พิมพ์ออกจากเครื่องครบแล้วหรือยัง? (ถ้ากดยกเลิกในหน้าต่างพิมพ์ = ยังไม่ได้พิมพ์)</span>
              <BigButton tone="secondary" onClick={() => setAsking(false)}>
                ยังไม่ออก · พิมพ์ใหม่
              </BigButton>
              <BigButton
                className="!py-3 text-base"
                onClick={() => {
                  setAsking(false)
                  onPrinted?.()
                }}
              >
                ออกครบแล้ว · ปิดงาน
              </BigButton>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-3">
              <BigButton className="min-w-[180px] !py-3 text-base" onClick={() => setPrinting(true)}>
                {printLabel}
              </BigButton>
            </div>
          )}
        </div>
      </div>
      {printing &&
        createPortal(
          <div id="uam-print">
            <style>{PAGE_CSS[format]}</style>
            {Array.from({ length: copies }, (_, i) => (
              <div key={i} className="print-copy">
                {children}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
