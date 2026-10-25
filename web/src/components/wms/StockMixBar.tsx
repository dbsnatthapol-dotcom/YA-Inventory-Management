import { fmt } from '../../wms/logic'
import { STOCK_PART_COLOR, STOCK_PART_LABEL, STOCK_PARTS, type StockMix } from '../../wms/stockMix'

/**
 * แถบองค์ประกอบสต็อก: ในช่องเก็บ / รอจัดเก็บ / รอตรวจ MI3 / พื้นที่ NG (นิยามเดียวกันทุกหน้า)
 * ของดีคงคลัง = ในช่องเก็บ + รอจัดเก็บ
 */
export function StockMixBar({ mix, className = '' }: { mix: StockMix; className?: string }) {
  const total = STOCK_PARTS.reduce((s, p) => s + mix[p].qty, 0)
  if (!total) return <p className={`text-xs text-slate-400 ${className}`}>ยังไม่มีของในคลัง</p>
  const shown = STOCK_PARTS.filter((p) => mix[p].qty > 0)
  return (
    <div className={`flex flex-col gap-1.5 ${className}`} role="group" aria-label="องค์ประกอบสต็อก">
      <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded bg-white">
        {shown.map((p) => (
          <span
            key={p}
            className="h-full min-w-[3px] first:rounded-l last:rounded-r"
            style={{ width: `${(mix[p].qty / total) * 100}%`, background: STOCK_PART_COLOR[p] }}
            title={`${STOCK_PART_LABEL[p]} ${fmt(mix[p].qty)} ชิ้น · ${fmt(mix[p].boxes)} กล่อง (${Math.round((mix[p].qty / total) * 100)}%)`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
        {STOCK_PARTS.map((p) => (
          <span key={p} className="flex items-center gap-1.5 whitespace-nowrap">
            <i className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: STOCK_PART_COLOR[p] }} aria-hidden />
            {STOCK_PART_LABEL[p]} <b className="tabular-nums text-slate-800">{fmt(mix[p].qty)}</b> ชิ้น · {fmt(mix[p].boxes)} กล่อง
          </span>
        ))}
      </div>
    </div>
  )
}
