import { useEffect, useState } from 'react'
import { caseName, checkSummary, compareParts, ISSUE_LABEL, lineIssues } from '../../wms/checkSheet'
import { fmt } from '../../wms/logic'
import type { CheckDetail } from '../../wms/types'
import { useWms } from '../../wms/useWms'
import { BrandMark } from './BrandMark'

const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', calendar: 'gregory' }) : '-'
const cell = 'border border-neutral-500 px-[1.5mm] py-[0.8mm]'

/**
 * รายงานผลตรวจรับ A4 (แนบส่ง RE / เก็บแฟ้ม): ของไม่ตรง Packing List รายเคส · ยอดรวมต่อ part เทียบ Invoice · รูปหลักฐาน
 * รับเข้าตามยอดที่นับได้จริง ส่วนต่างอยู่ในรายงานนี้
 */
export function CheckReport({ detail }: { detail: CheckDetail }) {
  const { api, settings } = useWms()
  const c = detail.check
  const lines = [...detail.lines].sort((a, b) => a.caseNo.localeCompare(b.caseNo, 'en', { numeric: true }) || a.lineNo - b.lineNo)
  const off = lines.filter((l) => lineIssues(l).length > 0)
  const parts = compareParts(detail.lines, c.invoiceLines)
  const sum = checkSummary(detail.lines)
  const checkers = [...new Set(detail.lines.map((l) => l.checkedCode).filter(Boolean))].join(', ')
  const photos = lines.flatMap((l) => l.photos.map((p) => ({ path: p, label: `${caseName(l.caseNo)} · ${l.partNo}` })))
  // ลิงก์ภาพชั่วคราว (โหลดก่อนกดพิมพ์)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [printedAt] = useState(() => new Date().toISOString())
  useEffect(() => {
    let alive = true
    const paths = detail.lines.flatMap((l) => l.photos)
    Promise.all(paths.map(async (path) => [path, await api.docUrl(path).catch(() => null)] as const)).then((pairs) => {
      if (alive) setUrls(Object.fromEntries(pairs.filter((x): x is readonly [string, string] => !!x[1])))
    })
    return () => {
      alive = false
    }
  }, [api, detail])

  return (
    <div className="print-page flex flex-col gap-[4mm] p-[12mm] text-[9pt]" style={{ width: '210mm', minHeight: '297mm', boxSizing: 'border-box' }}>
      <div className="flex items-start justify-between gap-[6mm] border-b-2 border-black pb-[3mm]">
        <div>
          <BrandMark logo="14mm" name="13pt" />
          <div className="mt-[2mm] text-[11pt] font-semibold">
            รายงานผลตรวจรับสินค้า / RECEIVING INSPECTION REPORT
            {settings.mode === 'trial' && <span className="ml-2 border border-black px-1 text-[8pt]">ทดลอง</span>}
          </div>
          <div className="mt-[2mm] font-mono text-[15pt] font-bold">{c.checkNo}</div>
        </div>
        <div className="text-right font-mono text-[9pt]">
          {c.grnNo ? <div className="text-[12pt] font-bold">{c.grnNo}</div> : <div>{c.status === 'cancelled' ? 'ยกเลิก' : 'ยังไม่ออก GRN'}</div>}
          <div>พิมพ์ {dateTime(printedAt)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-[8mm] gap-y-[1mm] font-mono text-[8.5pt]">
        <div>ลูกค้า: {c.customerId === 'RE' ? 'Royal Enfield (Thailand)' : (c.customerId ?? '-')}</div>
        <div>Model: {c.modelCode ?? '-'}</div>
        <div>Packing List: {c.plRef}</div>
        <div>หีบห่อ: {c.packages ?? '-'}</div>
        <div>Invoice: {c.invoiceNo ?? '-'}</div>
        <div>PO: {c.poNo ?? '-'}</div>
        <div>เปิดใบ: {dateTime(c.createdAt)} · {c.createdCode ?? '-'}</div>
        <div>ผู้ตรวจ: {checkers || '-'}</div>
      </div>

      <div className="border border-black px-[2mm] py-[1.5mm] text-[9pt]">
        ตรวจ {sum.checked}/{sum.lines} รายการ ({sum.casesDone}/{sum.cases} เคส) · ตาม PL {fmt(sum.plQty)} ชิ้น · นับได้ {fmt(sum.actualQty)} ชิ้น
        {sum.damagedQty ? ` · เสียหาย ${fmt(sum.damagedQty)} ชิ้น` : ''} ·{' '}
        <b>{off.length ? `ไม่ตรง ${off.length} รายการ` : 'ตรงตาม Packing List ทุกรายการ'}</b>
        <div className="text-[8pt]">
          รับเข้าสต็อกตามยอดที่นับได้จริง · ส่วนต่างตามรายการด้านล่าง{sum.damagedQty ? ' · ของเสียหายแยกเป็นกล่อง NG รอส่งคืน' : ''}
        </div>
      </div>

      <div>
        <div className="mb-[1mm] text-[10pt] font-bold">1. รายการที่ไม่ตรง Packing List (รายเคส)</div>
        {off.length === 0 ? (
          <div className="text-[8.5pt]">ไม่มี</div>
        ) : (
          <table className="w-full border-collapse text-[8pt]">
            <thead>
              <tr>
                {['เคส', 'Part No.', 'รายการ', 'PL', 'นับได้', 'ต่าง', 'เสียหาย', 'ปัญหา', 'หมายเหตุ'].map((h) => (
                  <th key={h} className={`${cell} bg-neutral-100 text-left`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {off.map((l) => (
                <tr key={l.id}>
                  <td className={`${cell} font-mono`}>{l.caseNo || '-'}</td>
                  <td className={`${cell} font-mono`}>{l.partNo}</td>
                  <td className={cell}>{l.description}</td>
                  <td className={`${cell} text-right font-mono`}>{fmt(l.plQty)}</td>
                  <td className={`${cell} text-right font-mono font-bold`}>{fmt(l.actualQty)}</td>
                  <td className={`${cell} text-right font-mono`}>{l.actualQty === null ? '' : signed(l.actualQty - l.plQty)}</td>
                  <td className={`${cell} text-right font-mono`}>{l.damagedQty ? fmt(l.damagedQty) : ''}</td>
                  <td className={cell}>{lineIssues(l).map((i) => ISSUE_LABEL[i]).join(', ')}</td>
                  <td className={cell}>{l.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <div className="mb-[1mm] text-[10pt] font-bold">2. ยอดรวมต่อ part เทียบ Invoice</div>
        {c.invoiceLines.length === 0 ? (
          <div className="text-[8.5pt]">{c.invoiceNo ? `Invoice ${c.invoiceNo} ยังไม่มีรายการในระบบ` : 'ไม่ได้ระบุ Invoice'}</div>
        ) : (
          <table className="w-full border-collapse text-[8pt]">
            <thead>
              <tr>
                {['Part No.', 'PL', 'นับได้', 'Invoice', 'นับได้ − Invoice'].map((h) => (
                  <th key={h} className={`${cell} bg-neutral-100 text-left`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => {
                const diff = p.invoice !== null && p.actual !== null ? p.actual - p.invoice : null
                return (
                  <tr key={p.partNo} className={diff ? 'font-bold' : undefined}>
                    <td className={`${cell} font-mono`}>{p.partNo}</td>
                    <td className={`${cell} text-right font-mono`}>{fmt(p.pl)}</td>
                    <td className={`${cell} text-right font-mono`}>{fmt(p.actual)}</td>
                    <td className={`${cell} text-right font-mono`}>{fmt(p.invoice)}</td>
                    <td className={`${cell} text-right font-mono`}>{diff === null ? (p.invoice === null ? 'ไม่มีใน Invoice' : '') : diff === 0 ? 'ตรง' : signed(diff)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {photos.length > 0 && (
        <div>
          <div className="mb-[1mm] text-[10pt] font-bold">3. รูปหลักฐาน</div>
          <div className="grid grid-cols-4 gap-[3mm]">
            {photos.map((p) => (
              <figure key={p.path} className="flex flex-col gap-[0.5mm]">
                {urls[p.path] ? <img src={urls[p.path]} alt={p.label} className="h-[38mm] w-full border border-neutral-400 object-cover" /> : <div className="h-[38mm] border border-neutral-400" />}
                <figcaption className="text-[7pt]">{p.label}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}

      {c.note && <div className="text-[8.5pt]">หมายเหตุ: {c.note}</div>}

      <div className="mt-auto grid grid-cols-3 gap-[8mm] pt-[14mm] text-center">
        {['ผู้ตรวจรับ', 'หัวหน้าคลัง', 'ผู้ส่งสินค้า / รับทราบ'].map((s) => (
          <div key={s} className="border-t border-black pt-[1mm]">
            {s}
          </div>
        ))}
      </div>
    </div>
  )
}

const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n))
