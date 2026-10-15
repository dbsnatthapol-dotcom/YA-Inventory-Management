import { useMemo } from 'react'
import { modelColor } from '../../data/modelColors'
import { palletsFor } from '../../data/warehouse'
import { availableForMra } from '../../inventory/ledger'
import { zoneContents } from '../../inventory/reports'
import type { InventoryState } from '../../inventory/types'
import type { FactoryLayout } from '../../types/layout'
import { fmtTime } from '../inventory/format'
import { IconClose } from './icons'

const fmt = (n: number) => n.toLocaleString('th-TH')

/** รายละเอียดพาเลทที่คลิกบน rack: part, lot, invoice, จำนวน, สถานะพร้อมเบิก/รอคัด */
export function PalletCard({
  layout,
  state,
  zoneId,
  index,
  onClose,
}: {
  layout: FactoryLayout
  state: InventoryState
  zoneId: string
  index: number
  onClose: () => void
}) {
  const info = useMemo(() => {
    const contents = zoneContents(state, zoneId)
    const pallets = palletsFor(contents)
    const pallet = pallets[index]
    const item = pallet && contents.items.find((i) => i.lot.id === pallet.lotId)
    if (!pallet || !item) return null
    const lotPallets = pallets.filter((p) => p.lotId === pallet.lotId)
    return {
      pallet,
      item,
      ofLot: pallets.slice(0, index + 1).filter((p) => p.lotId === pallet.lotId).length,
      lotPallets: lotPallets.length,
      available: availableForMra(state, item.lot),
      receipt: state.receipts.find((r) => r.id === item.lot.receiptId),
      zone: layout.zones.find((z) => z.id === zoneId),
    }
  }, [layout, state, zoneId, index])

  if (!info) return null
  const { pallet, item, receipt, zone } = info
  const floor = layout.floors.find((f) => f.id === zone?.floorId)
  const status =
    item.pendingQc > 0 && info.available === 0
      ? { text: 'รอคัด MI3', cls: 'bg-amber-50 text-amber-700 ring-amber-200' }
      : item.pendingQc > 0
        ? { text: 'คัดแล้วบางส่วน', cls: 'bg-sky-50 text-sky-700 ring-sky-200' }
        : { text: 'พร้อมเบิก', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' }

  const rows: [string, string][] = [
    ['จำนวนบนพาเลท', `${fmt(pallet.qty)} ชิ้น`],
    ['ยอด lot นี้ใน BOI', `${fmt(item.qty)} ชิ้น · ${info.lotPallets} พาเลท`],
    ['เบิกได้ทันที', `${fmt(info.available)} ชิ้น`],
    ['Model', item.lot.model],
    ['Lot', item.lot.id],
    ['รับเข้า', fmtTime(item.lot.receivedAt)],
    ...(receipt ? ([['ผู้รับ', receipt.receivedBy]] as [string, string][]) : []),
    ['ตำแหน่ง', `${zone?.name ?? zoneId}${floor ? ` · ${floor.name.replace('อาคาร ', '')}` : ''}`],
  ]

  return (
    <div className="rounded-xl bg-white p-4 shadow-[0_8px_30px_-14px_rgba(15,40,80,0.4)] ring-1 ring-slate-200">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 h-10 w-10 shrink-0 rounded-lg shadow-inner" style={{ background: modelColor(pallet.model) }} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            พาเลท {info.ofLot}/{info.lotPallets} · {zone?.code}
          </div>
          <div className="truncate font-bold text-slate-800">{item.part?.description ?? pallet.partNo}</div>
          <div className="text-xs text-slate-500">{pallet.partNo}</div>
        </div>
        <button className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" onClick={onClose} title="ปิด">
          <IconClose />
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${status.cls}`}>{status.text}</span>
        <span className="truncate text-slate-400">{item.lot.invoiceNo}</span>
      </div>
      <dl className="mt-3 divide-y divide-slate-100 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 py-1.5">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-right font-medium text-slate-700">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
