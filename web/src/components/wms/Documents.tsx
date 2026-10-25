import { fmt, lpnUrl } from '../../wms/logic'
import { partsOffInvoice } from '../../wms/invoiceLines'
import { zoneHeadOf, type LabelContext } from '../../wms/labels'
import type { Lpn } from '../../wms/types'
import { BrandMark } from './BrandMark'
import { QrCode } from './QrCode'

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', calendar: 'gregory', timeZone: 'Asia/Bangkok' })

/**
 * ป้ายชี้บ่งกล่อง (UAM Tag) 100×150 มม. (แบบใบปะหน้าพัสดุ) — หน่วย mm เพื่อให้พิมพ์ได้ขนาดจริง
 * mono = เครื่องพิมพ์ฉลากความร้อน (โลโก้ดำ) · A4 4 ป้ายต่อแผ่นใช้โลโก้สี
 */
export function LabelCard({ lpn, ctx, heightMm = 150, mono = false }: { lpn: Lpn; ctx: LabelContext; heightMm?: number; mono?: boolean }) {
  const line = (id: string) => ctx.lines.find((l) => l.id === id)
  // กล่องรวมที่เป็น part เดียวกัน (คนละบรรทัดรับ) แสดงเหมือนกล่อง part เดียว
  const parts = new Set(lpn.items.map((i) => i.partNo))
  const single = parts.size === 1 ? lpn.items[0] : null
  const total = lpn.items.reduce((s, i) => s + i.qty, 0)
  // ช่องแนะนำจากใบรับ (กล่องหลาย part ใช้ของรายการแรกที่มี) · ไม่มีจึงใช้ที่อยู่ตอนนี้
  const home = lpn.items.map((i) => line(i.grnLineId)?.homeLocation).find((h) => !!h) || lpn.locationCode
  // กล่องในพื้นที่กัก NG (ของเสียหายจากการตรวจรับ): อยู่ที่นั่นจนส่งคืน ห้ามเข้าไลน์
  const ng = ctx.master.locations.find((l) => l.code === lpn.locationCode)?.kind === 'ng'
  const dest = lpn.hold ? 'MI3-QC' : ng ? lpn.locationCode : home
  const desc = single ? (line(single.grnLineId)?.description ?? ctx.master.parts.find((p) => p.partNo === single.partNo)?.name ?? '') : ''
  return (
    <div className="print-page flex flex-col gap-[2mm] border border-black p-[4mm] font-sans" style={{ width: '100mm', height: `${heightMm}mm`, boxSizing: 'border-box' }}>
      <div className="border-b-2 border-black pb-[1.2mm]">
        <div className="flex items-center justify-between gap-[2mm] whitespace-nowrap">
          <BrandMark mono={mono} logo="8.5mm" name="7.8pt" subSize="6.8pt" subtitle={<b>UAM TAG · ป้ายชี้บ่งสินค้า</b>} />
          {ctx.trial && <div className="border border-black px-[1.5mm] text-[7pt] font-bold">ทดลอง</div>}
        </div>
        <div className="mt-[1mm] flex items-end justify-between gap-[2mm]">
          <div className="truncate text-[8pt]">
            {ctx.grn?.customerId === 'RE' ? 'Royal Enfield' : (ctx.grn?.customerId ?? '')} · {ctx.grn?.modelCode ?? '-'}
          </div>
          <div className="shrink-0 font-mono text-[13pt] font-bold leading-none tracking-tight">{lpn.lpnNo}</div>
        </div>
      </div>

      <div className="grid grid-cols-[34mm_1fr] items-center gap-[3mm]">
        <QrCode text={lpnUrl(lpn.lpnNo)} size="34mm" title={lpn.lpnNo} />
        <div className="flex min-w-0 flex-col gap-[1mm]">
          {lpn.caseNo && <div className="w-fit border-2 border-black px-[1.5mm] font-mono text-[11pt] font-bold leading-tight">เคส {lpn.caseNo}</div>}
          {single ? (
            <>
              <div className="font-mono text-[12pt] font-bold leading-tight">{single.partNo}</div>
              <div className="text-[8pt] leading-snug">{desc}</div>
            </>
          ) : (
            <div className="text-[10pt] font-bold">{lpn.caseNo ? '' : 'กล่องรวม '}{parts.size} part</div>
          )}
          <div className="font-mono text-[22pt] font-bold leading-none">
            {fmt(total)} <span className="text-[9pt]">PCS</span>
          </div>
        </div>
      </div>

      {!single && (
        <div className="flex min-h-0 flex-1 flex-col gap-[0.5mm] overflow-hidden border-t border-black pt-[1mm] text-[7.5pt]">
          {lpn.items.map((i) => (
            <div key={i.id} className="flex justify-between gap-[2mm] font-mono">
              <span>{i.partNo}</span>
              <span>{fmt(i.qty)}</span>
            </div>
          ))}
        </div>
      )}
      {single && <div className="flex-1" />}

      {ng ? (
        <div className="border-2 border-black bg-black py-[1mm] text-center text-[10pt] font-bold text-white">NG · ของเสียหาย · ห้ามเข้าไลน์</div>
      ) : (
        <div className="border-2 border-black py-[1mm] text-center text-[9pt] font-bold">{lpn.hold ? 'รอตรวจ MI3 · ห้ามเบิก' : 'พร้อมใช้ · BOI'}</div>
      )}

      <div className="grid grid-cols-[1.25fr_1fr] gap-[2mm] border-2 border-black px-[2mm] py-[1.2mm]">
        <div className="min-w-0">
          <div className="text-[6.5pt] uppercase tracking-wider">ที่เก็บ</div>
          <div className="font-mono text-[13pt] font-bold leading-tight">{dest}</div>
          {lpn.locationCode !== dest && <div className="text-[6.5pt]">ตอนนี้อยู่ {lpn.locationCode}</div>}
        </div>
        <div className="min-w-0">
          <div className="text-[6.5pt] uppercase tracking-wider">หัวหน้าโซน</div>
          <div className="text-[8pt] font-semibold leading-tight">{zoneHeadOf(ctx.master, dest)}</div>
        </div>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-[2mm] border-t border-black pt-[1mm] font-mono text-[6.8pt] leading-snug">
        <span>GRN</span>
        <span>{ctx.grn?.grnNo ?? '-'}</span>
        <span>INV</span>
        <span>{ctx.grn?.invoiceNo ?? '-'}</span>
        <span>PL</span>
        <span>
          {ctx.grn?.plRef ?? '-'}
          {ctx.grn?.packages ? ` · ${ctx.grn.packages}` : ''}
        </span>
        <span>รับ</span>
        <span>
          {ctx.grn ? dateTime(ctx.grn.receivedAt) : '-'} · {ctx.grn?.receiverCode ?? ''}
        </span>
      </div>
    </div>
  )
}

/** A4 แบ่ง 4 ป้าย (2×2) สำหรับเครื่องพิมพ์ธรรมดาแล้วตัด */
export function LabelSheet({ lpns, ctx }: { lpns: Lpn[]; ctx: LabelContext }) {
  return (
    <div className="print-page grid grid-cols-2 content-start gap-[4mm] p-[4mm]" style={{ width: '210mm', height: '297mm', boxSizing: 'border-box' }}>
      {lpns.map((l) => (
        <LabelCard key={l.id} lpn={l} ctx={ctx} heightMm={140} />
      ))}
    </div>
  )
}

/** ใบรับสินค้า (GRN) A4 เก็บแฟ้ม พร้อม QR และช่องเซ็น */
export function GrnSheet({ ctx }: { ctx: LabelContext }) {
  const g = ctx.grn
  if (!g) return null
  // เทียบ Invoice ราย part (part เดียวมาหลายเคส รวมกันแล้วค่อยเทียบ)
  const off = partsOffInvoice(ctx.lines).length
  const firstOf = new Map<string, number>()
  const cases = new Map<string, number>()
  for (const l of ctx.lines) {
    if (!firstOf.has(l.partNo)) firstOf.set(l.partNo, l.lineNo)
    cases.set(l.partNo, (cases.get(l.partNo) ?? 0) + 1)
  }
  return (
    <div className="print-page flex flex-col gap-[4mm] p-[12mm] text-[9pt]" style={{ width: '210mm', minHeight: '297mm', boxSizing: 'border-box' }}>
      <div className="flex items-start justify-between gap-[6mm] border-b-2 border-black pb-[3mm]">
        <div>
          <BrandMark logo="14mm" name="13pt" />
          <div className="mt-[2mm] text-[11pt] font-semibold">
            ใบรับสินค้า / GOODS RECEIPT NOTE {ctx.trial && <span className="ml-2 border border-black px-1 text-[8pt]">ทดลอง</span>}
            {g.status === 'void' && <span className="ml-2 border-2 border-black px-1 text-[10pt] font-bold">ยกเลิกแล้ว</span>}
          </div>
          <div className="mt-[2mm] font-mono text-[15pt] font-bold">{g.grnNo}</div>
        </div>
        <QrCode text={`${typeof window !== 'undefined' ? window.location.origin : ''}/g/${g.grnNo}`} size="26mm" title={g.grnNo} />
      </div>
      <div className="grid grid-cols-2 gap-x-[8mm] gap-y-[1mm] font-mono text-[8.5pt]">
        <div>ลูกค้า: {g.customerId === 'RE' ? 'Royal Enfield (Thailand)' : (g.customerId ?? '-')}</div>
        <div>Model: {g.modelCode ?? '-'}</div>
        <div>Invoice: {g.invoiceNo ?? '-'}</div>
        <div>Packing List: {g.plRef}</div>
        <div>SO: {g.soNo ?? '-'}</div>
        <div>หีบห่อ: {g.packages ?? '-'}</div>
        <div>วันที่รับ: {dateTime(g.receivedAt)}</div>
        <div>ผู้รับ: {g.receiverCode ?? '-'}</div>
      </div>
      <table className="w-full border-collapse text-[8pt]">
        <thead>
          <tr>
            {['#', 'เคส', 'Part No.', 'รายการ', 'PL', 'รับจริง', 'Invoice', 'ที่เก็บ', 'MI3'].map((h) => (
              <th key={h} className="border border-neutral-500 bg-neutral-100 px-[1.5mm] py-[1mm] text-left">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ctx.lines.map((l) => (
            <tr key={l.id}>
              <td className="border border-neutral-500 px-[1.5mm] py-[0.8mm]">{l.lineNo}</td>
              <td className="border border-neutral-500 px-[1.5mm] py-[0.8mm] font-mono">{l.caseNo ?? ''}</td>
              <td className="border border-neutral-500 px-[1.5mm] py-[0.8mm] font-mono">{l.partNo}</td>
              <td className="border border-neutral-500 px-[1.5mm] py-[0.8mm]">{l.description}</td>
              <td className="border border-neutral-500 px-[1.5mm] py-[0.8mm] text-right font-mono">{fmt(l.plQty)}</td>
              <td className="border border-neutral-500 px-[1.5mm] py-[0.8mm] text-right font-mono font-bold">
                {fmt(l.countedQty)}
                {l.damagedQty ? <div className="text-[7pt] font-normal">เสียหาย→NG {fmt(l.damagedQty)}</div> : null}
              </td>
              <td className="border border-neutral-500 px-[1.5mm] py-[0.8mm] text-right font-mono">
                {firstOf.get(l.partNo) === l.lineNo ? (
                  <>
                    {fmt(l.invoiceQty)}
                    {(cases.get(l.partNo) ?? 0) > 1 && l.invoiceQty !== null && <div className="text-[7pt]">รวม {cases.get(l.partNo)} เคส</div>}
                  </>
                ) : (
                  l.invoiceQty !== null && <span className="text-[7pt]">รวมที่บรรทัด {firstOf.get(l.partNo)}</span>
                )}
              </td>
              <td className="border border-neutral-500 px-[1.5mm] py-[0.8mm] font-mono">{l.needsQi ? 'MI3-QC' : (l.homeLocation ?? '-')}</td>
              <td className="border border-neutral-500 px-[1.5mm] py-[0.8mm]">{l.needsQi ? 'ตรวจ' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[8pt]">
        รวม {ctx.lines.length} รายการ · {fmt(ctx.lines.reduce((s, l) => s + l.countedQty, 0))} ชิ้น
        {ctx.lines.some((l) => l.damagedQty) && ` · เสียหายแยกกล่อง NG ${fmt(ctx.lines.reduce((s, l) => s + (l.damagedQty ?? 0), 0))} ชิ้น`}
        {off > 0 && ` · ไม่ตรง Invoice ${off} part (ดูหน้ากระทบยอด Invoice)`}
      </div>
      <div className="mt-auto grid grid-cols-3 gap-[8mm] pt-[14mm] text-center">
        {['ผู้รับสินค้า', 'ผู้ตรวจนับ', 'หัวหน้าโซน'].map((s) => (
          <div key={s} className="border-t border-black pt-[1mm]">
            {s}
          </div>
        ))}
      </div>
    </div>
  )
}
