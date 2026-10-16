import { useState, type ReactNode } from 'react'
import type { LedgerSheet } from '../../wms/ledger'
import { fmt } from '../../wms/logic'
import type { PartMaster, Requisition, StockClosing } from '../../wms/types'
import { BrandMark } from './BrandMark'

const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`
const num = (n: number) => (n ? fmt(n) : '')
const stamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' }) : '')
const th = 'border border-black bg-neutral-100 px-[1.2mm] py-[0.8mm] text-center font-semibold'
const td = 'border border-black px-[1.2mm] py-[0.6mm]'

/** หน้า A4 มาตรฐาน: โลโก้ + ชื่อบริษัท + ชื่อเอกสาร · ท้ายหน้ารหัสฟอร์มและเวลาที่พิมพ์ */
function A4Page({ title, sub, form, children }: { title: ReactNode; sub?: ReactNode; form?: string; children: ReactNode }) {
  const [printedAt] = useState(() => new Date().toISOString())
  return (
    <div className="print-page flex flex-col gap-[3mm] p-[10mm] text-[8.5pt]" style={{ width: '210mm', minHeight: '297mm', boxSizing: 'border-box' }}>
      <div className="flex items-end justify-between gap-[4mm] border-b-2 border-black pb-[2mm]">
        <BrandMark logo="12mm" name="11pt" subtitle="ระบบบริหารคลังสินค้า UAM WMS" subSize="7.5pt" />
        <div className="text-right">
          <div className="text-[12pt] font-bold leading-tight">{title}</div>
          {sub && <div className="text-[9pt]">{sub}</div>}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-[3mm]">{children}</div>
      <div className="flex justify-between border-t border-black pt-[1mm] text-[7pt]">
        <span>{form ?? ''}</span>
        <span>พิมพ์จากระบบ {stamp(printedAt)}</span>
      </div>
    </div>
  )
}

/** บัญชีคุม FM-P-537 1 part ต่อ 1 หน้า (แบบเดียวกับกระดาษ) */
export function LedgerPage({ sheet, model, month, closing }: { sheet: LedgerSheet; model: string; month: string; closing: StockClosing | null }) {
  const closed = closing?.status === 'closed' ? closing : null
  return (
    <A4Page title={`STOCK PARTS ${model}`} sub={`เดือน ${month}`} form="FM-P-537 · Rev.:01">
      <div className="text-[10pt] font-bold">
        PART : <span className="font-mono">{sheet.partNo}</span> {sheet.name}
        {sheet.uamCode && <span className="font-normal"> (UAM {sheet.uamCode})</span>}
      </div>
      <table className="w-full border-collapse text-[7.5pt]">
        <thead>
          <tr>
            <th className={th} rowSpan={2}>
              Date
            </th>
            <th className={th}>เลขที่</th>
            <th className={th}>วันที่</th>
            <th className={th} rowSpan={2}>
              เลขที่ใบเบิก
            </th>
            <th className={th} colSpan={2}>
              รับเข้า
            </th>
            <th className={th} rowSpan={2}>
              เบิก
            </th>
            <th className={th} rowSpan={2}>
              NG
            </th>
            <th className={th} rowSpan={2}>
              QC เบิก
            </th>
            <th className={th} rowSpan={2}>
              LOT
            </th>
            <th className={th}>Stock</th>
          </tr>
          <tr>
            <th className={th}>INV.</th>
            <th className={th}>Order No.</th>
            <th className={th}>ปกติ</th>
            <th className={th}>ทดแทน</th>
            <th className={th}>(Pcs.)</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          <tr>
            <td className={`${td} font-sans font-semibold`} colSpan={10}>
              Stock ยกมา
            </td>
            <td className={`${td} text-right font-semibold`}>{fmt(sheet.opening)}</td>
          </tr>
          {sheet.lines.map((l, i) => (
            <tr key={i}>
              <td className={td}>{shortDate(l.date)}</td>
              <td className={td}>{l.invNo ?? ''}</td>
              <td className={td}>{l.orderNo ?? ''}</td>
              <td className={td}>{l.docNo ?? ''}</td>
              <td className={`${td} text-right`}>{num(l.recv)}</td>
              <td className={`${td} text-right`}>{num(l.recvRep)}</td>
              <td className={`${td} text-right`}>{num(l.issue)}</td>
              <td className={`${td} text-right`}>{num(l.ng)}</td>
              <td className={`${td} text-right`}>{num(l.qc)}</td>
              <td className={`${td} text-[6.5pt]`}>{l.lot ?? ''}</td>
              <td className={`${td} text-right font-semibold`}>{fmt(l.stock)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="w-[110mm] border-collapse text-[8pt]">
        <tbody>
          <tr>
            <td className={`${td} font-semibold`}>ณ สิ้นเดือน</td>
            {['Stock ยกมา', 'งานเข้า', 'เบิกใช้', 'คงเหลือ'].map((h) => (
              <td key={h} className={`${td} text-center font-semibold`}>
                {h}
              </td>
            ))}
          </tr>
          <tr>
            <td className={td}>ยอดรวมทั้งหมด</td>
            {[sheet.opening, sheet.totalIn, sheet.totalOut, sheet.closing].map((v, i) => (
              <td key={i} className={`${td} text-right font-mono font-bold`}>
                {fmt(v)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <div className="mt-auto grid grid-cols-3 gap-[4mm] text-center text-[7.5pt]">
        {(
          [
            ['คลังปิดยอด', closed?.closedBy, closed?.closedAt],
            ['Planning รับทราบ', closed?.planningBy, closed?.planningAt],
            ['บัญชี รับทราบ', closed?.accountBy, closed?.accountAt],
          ] as const
        ).map(([k, by, at]) => (
          <div key={k} className="border border-black px-[2mm] py-[1.5mm]">
            <div className="font-semibold">{k}</div>
            <div className="min-h-[8mm] pt-[1mm]">{by ? `${by} · ${stamp(at ?? null)}` : ''}</div>
          </div>
        ))}
      </div>
    </A4Page>
  )
}

/** สรุปยอดเบิกตาม FM-P-005 ส่ง Planning */
export function PlanningPage({ fm, parts, from, to }: { fm: Requisition[]; parts: PartMaster[]; from: string; to: string }) {
  const partOf = (no: string) => parts.find((p) => p.partNo === no)
  return (
    <A4Page title="สรุปยอดเบิกส่ง Planning" sub={from === to ? from : `${from} ถึง ${to}`} form="ตาม FM-P-005">
      {fm.map((r) => (
        <div key={r.id} className="flex flex-col gap-[1mm]" style={{ breakInside: 'avoid' }}>
          <div className="font-semibold">
            FM-P-005 <span className="font-mono">{r.docNo}</span> · {r.modelCode} · {shortDate(r.docDate)}
            {r.fgQty ? ` · ${fmt(r.fgQty)} วง` : ''}
          </div>
          <table className="w-full border-collapse text-[7.5pt]">
            <thead>
              <tr>
                {['Part No.', 'รหัส UAM', 'รายการ', 'รวมใบย่อย', 'FM-P-005', 'ส่วนต่าง', 'คงเหลือ'].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l) => {
                const d = l.qty - (l.reqQty ?? 0)
                return (
                  <tr key={l.partNo}>
                    <td className={`${td} font-mono font-semibold`}>{l.partNo}</td>
                    <td className={`${td} font-mono`}>{partOf(l.partNo)?.uamCode ?? ''}</td>
                    <td className={td}>{partOf(l.partNo)?.name ?? ''}</td>
                    <td className={`${td} text-right font-mono`}>{fmt(l.reqQty)}</td>
                    <td className={`${td} text-right font-mono font-semibold`}>{fmt(l.qty)}</td>
                    <td className={`${td} text-right font-mono`}>{d ? (d > 0 ? `+${fmt(d)}` : fmt(d)) : '0'}</td>
                    <td className={`${td} text-right font-mono`}>{fmt(l.balance)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
      <div className="mt-auto grid grid-cols-2 gap-[10mm] pt-[6mm] text-center text-[8pt]">
        {['ผู้ส่ง (W/H Assy)', 'ผู้รับ (Planning)'].map((k) => (
          <div key={k}>
            <div className="border-b border-dotted border-black pb-[8mm]" />
            <div className="pt-[1mm]">{k}</div>
          </div>
        ))}
      </div>
    </A4Page>
  )
}
