import { Fragment, useState } from 'react'
import { BRAND } from '../../data/brand'
import { availableForMra, BUCKET_LABEL, bucketBalance, FLOW, pendingInspection, type MoveInput } from '../../inventory/ledger'
import { modelRequiresInspection } from '../../inventory/extraction'
import { dailyStockReport, bangkokDate } from '../../inventory/reports'
import type { InventoryApi } from '../../inventory/useInventory'
import type { Bucket, Lot } from '../../inventory/types'
import type { Zone } from '../../types/layout'
import { fmt, inputBase } from './format'
import { Button, Chip, ErrorNote, Panel } from './ui'

interface Props {
  api: InventoryApi
  zones: Zone[]
  onShowZone: (zoneId: string) => void
  onTrace: (lotId: string) => void
}

/** ใบรายงาน STOCK ประจำวัน — หน้าตาเดียวกับแบบฟอร์มเดิมของแผนก W/H ASSY แต่ตัวเลขคำนวณจากรายการเคลื่อนไหว */
export function StockReport({ api, zones, onShowZone, onTrace }: Props) {
  const [date, setDate] = useState(bangkokDate())
  const [openPart, setOpenPart] = useState<string | null>(null)
  const [onlyActive, setOnlyActive] = useState(true)
  const rows = dailyStockReport(api.state, date)
  const visible = onlyActive ? rows.filter((r) => r.invoiceQty || r.actualReceive || r.mraIssued || r.balance || r.ngCustomer || r.ngSupplier) : rows

  return (
    <Panel
      title="ใบรายงาน STOCK ประจำวัน แผนก W/H ASSY · ROYAL ENFIELD"
      action={
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <label className="flex items-center gap-1 whitespace-nowrap">
            วันที่
            <input id="report-date" type="date" className={inputBase} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="flex items-center gap-1">
            <input id="only-active" type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
            แสดงเฉพาะรายการที่มียอด
          </label>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-left text-[13px]">
          <thead className="text-xs">
            <tr className="text-white" style={{ background: BRAND.primary }}>
              <th className="px-2 py-1.5" rowSpan={2}>
                #
              </th>
              <th className="px-2" rowSpan={2}>
                TYPE
              </th>
              <th className="px-2" rowSpan={2}>
                PART No.
              </th>
              <th className="px-2" rowSpan={2}>
                DESCRIPTION
              </th>
              <th className="border-l border-white/20 px-2 text-center">Income</th>
              <th className="border-l border-white/20 px-2 text-center" colSpan={2}>
                Inprocess
              </th>
              <th className="border-l border-white/20 px-2 text-center">QC</th>
              <th className="border-l border-white/20 px-2 text-center" colSpan={2}>
                Return
              </th>
              <th className="border-l border-white/20 px-2 text-center" rowSpan={2}>
                Balance ±
              </th>
            </tr>
            <tr className="bg-slate-100 text-slate-600">
              <th className="border-l px-2 py-1 text-right">รับตาม Invoice</th>
              <th className="border-l px-2 text-right">Actual Receive (BOI)</th>
              <th className="px-2 text-right">MRA เบิก</th>
              <th className="border-l px-2 text-right">MI3 / รอตรวจ</th>
              <th className="border-l px-2 text-right">NG รอส่งคืนลูกค้า</th>
              <th className="px-2 text-right">NG ส่งคืน Supplier</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {visible.map((r, i) => {
              const open = openPart === r.part.partNo
              return (
                <Fragment key={r.part.partNo}>
                  <tr
                    className={`cursor-pointer border-b border-slate-100 hover:bg-sky-50 ${open ? 'bg-sky-50' : ''}`}
                    onClick={() => setOpenPart(open ? null : r.part.partNo)}
                  >
                    <td className="px-2 py-1.5 text-slate-400">{i + 1}</td>
                    <td className="px-2">{r.part.type}</td>
                    <td className="px-2 font-mono text-xs">{r.part.partNo}</td>
                    <td className="px-2 text-xs text-slate-600">{r.part.description}</td>
                    <td className="border-l px-2 text-right">{fmt(r.invoiceQty)}</td>
                    <td className="border-l px-2 text-right">{fmt(r.actualReceive)}</td>
                    <td className="px-2 text-right">{fmt(r.mraIssued)}</td>
                    <td className="border-l px-2 text-right">
                      {fmt(r.mi3)}
                      {r.pendingQc > 0 && <span className="ml-1 text-[11px] text-amber-700">/ รอ {fmt(r.pendingQc)}</span>}
                    </td>
                    <td className="border-l px-2 text-right text-rose-700">{fmt(r.ngCustomer)}</td>
                    <td className="px-2 text-right text-rose-700">{fmt(r.ngSupplier)}</td>
                    <td className="border-l px-2 text-right font-bold" style={{ color: BRAND.primary }}>
                      {fmt(r.balance)}
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={11} className="bg-slate-50 px-3 py-3">
                        <LotList api={api} partNo={r.part.partNo} zones={zones} onShowZone={onShowZone} onTrace={onTrace} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        คลิกแถวเพื่อดู lot และบันทึกการเบิก / ส่งตรวจ / แจ้ง NG · ยอดเข้าออกนับเฉพาะวันที่เลือก · Balance = ของที่อยู่ในคลังจริง (BOI + MI3) ณ สิ้นวัน
      </p>
    </Panel>
  )
}

const ACTIONS: { kind: MoveInput['kind']; label: string }[] = [
  { kind: 'issue_mra', label: 'MRA เบิก' },
  { kind: 'to_mi3', label: 'ส่งตรวจ MI3' },
  { kind: 'mi3_pass', label: 'ผล MI3: ดี' },
  { kind: 'mi3_ng', label: 'ผล MI3: NG' },
  { kind: 'ng_in_process', label: 'เจอ NG ในกระบวนการ' },
  { kind: 'return_ng', label: 'ส่งคืน NG' },
]

function LotList({ api, partNo, zones, onShowZone, onTrace }: { api: InventoryApi; partNo: string } & Omit<Props, 'api'>) {
  const lots = api.state.lots.filter((l) => l.partNo === partNo)
  if (!lots.length) return <p className="text-sm text-slate-500">ยังไม่มี lot ของ part นี้ — รับเข้าได้ที่แท็บ "รับสินค้าเข้า"</p>
  return (
    <div className="flex flex-col gap-3">
      {lots.map((lot) => (
        <LotCard key={lot.id} api={api} lot={lot} zoneName={zones.find((z) => z.id === lot.zoneId)?.name ?? lot.zoneId} onShowZone={onShowZone} onTrace={onTrace} />
      ))}
    </div>
  )
}

function LotCard({ api, lot, zoneName, onShowZone, onTrace }: { api: InventoryApi; lot: Lot; zoneName: string; onShowZone: Props['onShowZone']; onTrace: Props['onTrace'] }) {
  const [kind, setKind] = useState<MoveInput['kind']>('issue_mra')
  const [qty, setQty] = useState(0)
  const [ngTo, setNgTo] = useState<Bucket>('NG_CUSTOMER')
  const [returnFrom, setReturnFrom] = useState<Bucket>('NG_CUSTOMER')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const s = api.state
  const bal = (b: Bucket) => bucketBalance(s, lot.id, b)
  const needsQc = modelRequiresInspection(lot.model)
  const ngKinds = FLOW[kind].to!.length > 1

  function submit() {
    const res = api.move({
      lotId: lot.id,
      kind,
      qty,
      to: ngKinds ? ngTo : undefined,
      from: kind === 'return_ng' ? returnFrom : undefined,
      note: note || undefined,
    })
    if (res.ok) {
      setQty(0)
      setNote('')
      setError(null)
    } else setError(res.error)
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold">{lot.id}</span>
        <Chip tone="muted">Model {lot.model}</Chip>
        {needsQc ? <Chip tone="warn">ต้องผ่าน MI3</Chip> : <Chip tone="ok">เบิกตรงได้</Chip>}
        <button className="text-xs text-sky-700 hover:underline" onClick={() => onShowZone(lot.zoneId)}>
          {zoneName} ↗
        </button>
        <button className="ml-auto text-xs text-sky-700 hover:underline" onClick={() => onTrace(lot.id)}>
          ดูประวัติ lot
        </button>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
        {(['BOI', 'MI3', 'MRA', 'NG_CUSTOMER', 'NG_SUPPLIER', 'RETURNED'] as Bucket[]).map((b) => (
          <div key={b} className="rounded bg-slate-50 px-2 py-1">
            <div className="text-[10px] text-slate-500">{BUCKET_LABEL[b]}</div>
            <div className="font-semibold tabular-nums">{fmt(bal(b))}</div>
          </div>
        ))}
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        MRA เบิกได้อีก <b>{fmt(availableForMra(s, lot))}</b>
        {needsQc && <> · รอตรวจ MI3 {fmt(pendingInspection(s, lot))}</>}
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <select id={`kind-${lot.id}`} aria-label="รายการ" className={inputBase} value={kind} onChange={(e) => setKind(e.target.value as MoveInput['kind'])}>
          {ACTIONS.map((a) => (
            <option key={a.kind} value={a.kind}>
              {a.label}
            </option>
          ))}
        </select>
        {kind === 'return_ng' && (
          <select id={`from-${lot.id}`} aria-label="ส่งคืนจาก" className={inputBase} value={returnFrom} onChange={(e) => setReturnFrom(e.target.value as Bucket)}>
            <option value="NG_CUSTOMER">จาก NG รอส่งคืนลูกค้า</option>
            <option value="NG_SUPPLIER">จาก NG ส่งคืน Supplier</option>
          </select>
        )}
        {ngKinds && (
          <select id={`to-${lot.id}`} aria-label="ปลายทาง NG" className={inputBase} value={ngTo} onChange={(e) => setNgTo(e.target.value as Bucket)}>
            <option value="NG_CUSTOMER">→ NG รอส่งคืนลูกค้า</option>
            <option value="NG_SUPPLIER">→ NG ส่งคืน Supplier</option>
          </select>
        )}
        <input id={`qty-${lot.id}`} aria-label="จำนวน" type="number" min={0} className={`${inputBase} w-28`} value={qty || ''} placeholder="จำนวน" onChange={(e) => setQty(Math.floor(Number(e.target.value)))} />
        <input id={`note-${lot.id}`} aria-label="หมายเหตุ" className={`${inputBase} min-w-0 flex-1`} value={note} placeholder="หมายเหตุ (เช่น อาการ NG)" onChange={(e) => setNote(e.target.value)} />
        <Button onClick={submit} disabled={!qty}>
          บันทึก
        </Button>
      </div>
      <div className="mt-2">
        <ErrorNote message={error} />
      </div>
    </div>
  )
}
