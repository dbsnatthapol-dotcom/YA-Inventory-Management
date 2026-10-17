import { FORMAT_NAME } from '../../wms/labels'
import type { PrintJob } from '../../wms/types'
import { Alert, BigButton, Card, Pill } from './ui'

const when = (iso: string) => new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })

/**
 * คิวพิมพ์บนคอมจุดพิมพ์: งานที่ส่งมาจากมือถือ เรียงตามลำดับที่ส่ง
 * กด "พิมพ์" ⇒ เปิดตัวอย่างของงานนั้น · พิมพ์เสร็จระบบปิดงานให้เอง
 */
export function PrintQueue({ queued, error, activeId, onPrint, onCancel }: { queued: PrintJob[]; error: string | null; activeId: string | null; onPrint: (j: PrintJob) => void; onCancel: (j: PrintJob) => void }) {
  if (!queued.length && !error) return null
  return (
    <Card title={`🖨️ คิวพิมพ์จากมือถือ (${queued.length})`} eyebrow="หน้างานกด 'ส่งไปพิมพ์ที่คอม' · กดพิมพ์ทีละงาน เครื่องนี้ต่อกับเครื่องพิมพ์ฉลาก/A4" className="ring-2 ring-amber-300 lg:col-span-2">
      {error && <Alert tone="bad">โหลดคิวพิมพ์ไม่สำเร็จ: {error}</Alert>}
      <ul className="flex flex-col gap-2">
        {queued.map((j) => (
          <li key={j.id} className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 ring-1 ${j.id === activeId ? 'bg-sky-50 ring-sky-600' : 'ring-slate-200'}`}>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{j.title ?? 'ป้ายกล่อง'}</span>
              <span className="text-xs text-slate-500">
                {FORMAT_NAME[j.format]} · {j.format === 'a4' ? 'ใบ GRN' : `${j.lpnIds.length} ป้าย`}
                {j.copies > 1 ? ` × ${j.copies} ชุด` : ''} · ส่งโดย {j.requestedCode ?? '-'} {when(j.requestedAt)}
              </span>
            </span>
            <Pill tone="warn">รอพิมพ์</Pill>
            <BigButton tone="secondary" onClick={() => onCancel(j)}>
              ยกเลิก
            </BigButton>
            <BigButton onClick={() => onPrint(j)}>พิมพ์</BigButton>
          </li>
        ))}
      </ul>
    </Card>
  )
}
