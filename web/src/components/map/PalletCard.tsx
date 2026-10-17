import { modelColor } from '../../data/modelColors'
import { palletsFor } from '../../data/warehouse'
import { fmtTime } from '../../lib/format'
import type { FactoryLayout } from '../../types/layout'
import type { ZoneContents } from '../../wms/mapStock'
import type { Lpn } from '../../wms/types'
import { IconClose } from './icons'

const fmt = (n: number) => n.toLocaleString('th-TH')

/** รายละเอียดกล่องที่คลิกบนผัง (1 ป้าย = 1 กล่อง/พาเลท): part, จำนวน, ที่มา GRN / Invoice, พร้อมเบิกหรือรอ MI3 */
export function PalletCard({
  layout,
  stock,
  lpns,
  zoneId,
  index,
  onClose,
}: {
  layout: FactoryLayout
  stock: ZoneContents | undefined
  lpns: Lpn[]
  zoneId: string
  index: number
  onClose: () => void
}) {
  const pallets = palletsFor(stock)
  const pallet = pallets[index]
  if (!pallet) return null
  const lpn = lpns.find((l) => l.lpnNo === pallet.lpnNo)
  const items = stock?.items.filter((i) => i.lpnNo === pallet.lpnNo) ?? []
  const zone = layout.zones.find((z) => z.id === zoneId)
  const floor = layout.floors.find((f) => f.id === zone?.floorId)
  const status = pallet.hold ? { text: 'รอตรวจ MI3 · ห้ามเบิก', cls: 'bg-amber-50 text-amber-700 ring-amber-200' } : { text: 'พร้อมเบิก', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' }

  const rows: [string, string][] = [
    ['จำนวนในกล่อง', `${fmt(pallet.qty)} ชิ้น`],
    ['Model', pallet.model],
    ['ช่องเก็บ', items[0]?.location ?? '–'],
    ['ใบรับสินค้า', lpn?.grnNo ?? '–'],
    ...(lpn?.invoiceNo ? ([['Invoice', lpn.invoiceNo]] as [string, string][]) : []),
    ...(lpn ? ([['รับเข้า', fmtTime(lpn.createdAt)]] as [string, string][]) : []),
    ['ตำแหน่ง', `${zone?.name ?? zoneId}${floor ? ` · ${floor.name.replace('อาคาร ', '')}` : ''}`],
  ]

  return (
    <div className="rounded-xl bg-white p-4 shadow-[0_8px_30px_-14px_rgba(15,40,80,0.4)] ring-1 ring-slate-200">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 h-10 w-10 shrink-0 rounded-lg shadow-inner" style={{ background: modelColor(pallet.model) }} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            กล่อง {index + 1}/{pallets.length} · {zone?.code}
          </div>
          <div className="truncate font-bold text-slate-800">{items.length > 1 ? `${items.length} part ในกล่องเดียว` : items[0]?.name || pallet.partNo}</div>
          <div className="font-mono text-xs text-slate-500">{pallet.lpnNo}</div>
        </div>
        <button className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" onClick={onClose} title="ปิด">
          <IconClose />
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${status.cls}`}>{status.text}</span>
        <a className="ml-auto text-sky-700 hover:underline" href={`/t/${encodeURIComponent(pallet.lpnNo)}`} title="เปิดกล่องนี้ในหน้าสแกน">
          เปิดหน้าสแกน →
        </a>
      </div>
      {items.length > 1 && (
        <ul className="mt-3 flex flex-col gap-1 text-xs">
          {items.map((i) => (
            <li key={i.key} className="flex justify-between gap-2">
              <span className="truncate">
                <span className="font-mono font-semibold">{i.partNo}</span> {i.name}
              </span>
              <span className="tabular-nums">{fmt(i.qty)}</span>
            </li>
          ))}
        </ul>
      )}
      <dl className="mt-3 divide-y divide-slate-100 text-xs">
        {items.length === 1 && (
          <div className="flex justify-between gap-3 py-1.5">
            <dt className="text-slate-500">Part No.</dt>
            <dd className="text-right font-mono font-medium text-slate-700">{items[0].partNo}</dd>
          </div>
        )}
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
