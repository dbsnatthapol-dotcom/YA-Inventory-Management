import type { ReactNode } from 'react'
import type { MapStats } from '../../lib/mapStats'
import { IconAlert, IconBox, IconLine, IconScan } from './icons'

const fmt = (n: number) => n.toLocaleString('th-TH')

function Card({
  icon,
  tone,
  label,
  value,
  unit,
  sub,
  children,
  onClick,
  active,
}: {
  icon: ReactNode
  tone: string
  label: string
  value: string
  unit: string
  sub: ReactNode
  children?: ReactNode
  onClick?: () => void
  active?: boolean
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`flex min-w-[11.5rem] shrink-0 items-start gap-3 rounded-xl bg-white/95 px-3.5 py-2.5 text-left shadow-[0_6px_24px_-12px_rgba(15,40,80,0.35)] ring-1 backdrop-blur transition ${
        active ? 'ring-2 ring-amber-400' : 'ring-slate-200/80'
      } ${onClick ? 'hover:ring-slate-300' : ''}`}
    >
      <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>{icon}</span>
      <span className="min-w-0 leading-tight">
        <span className="block text-[11px] text-slate-500">{label}</span>
        <span className="block text-lg font-bold tabular-nums text-slate-800">
          {value} <span className="text-[11px] font-medium text-slate-400">{unit}</span>
        </span>
        <span className="block text-[11px] text-slate-500">{sub}</span>
        {children}
      </span>
    </Tag>
  )
}

/** ตัวเลขสรุปลอยบนผัง: คงคลัง, รอคัด MI3, เบิกเข้าไลน์วันนี้, NG รอส่งคืน */
export function KpiStrip({ stats, qcPins, onToggleQcPins }: { stats: MapStats; qcPins: boolean; onToggleQcPins: () => void }) {
  const usage = stats.slots ? Math.round((stats.usedSlots / stats.slots) * 100) : 0
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
      <Card icon={<IconBox />} tone="bg-blue-50 text-blue-600" label="ของดีคงคลัง (BOI)" value={fmt(stats.boiQty)} unit="ชิ้น" sub={`${fmt(stats.pallets)} พาเลท · rack ใช้ ${usage}%`}>
        <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-slate-100">
          <span className={`block h-full rounded-full ${usage >= 90 ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${usage}%` }} />
        </span>
      </Card>
      <Card
        icon={<IconScan />}
        tone="bg-amber-50 text-amber-600"
        label="รอคัด MI3"
        value={fmt(stats.pendingQcQty)}
        unit="ชิ้น"
        sub={qcPins ? `${stats.pendingQcLots} lot · ปักหมุดบนผังแล้ว` : `${stats.pendingQcLots} lot · กดเพื่อปักหมุด`}
        onClick={onToggleQcPins}
        active={qcPins}
      />
      <Card icon={<IconLine />} tone="bg-emerald-50 text-emerald-600" label="เบิกเข้าไลน์วันนี้" value={fmt(stats.issuedToday)} unit="ชิ้น" sub={`รับเข้าวันนี้ ${stats.receiptsToday} invoice`} />
      <Card icon={<IconAlert />} tone="bg-red-50 text-red-600" label="NG รอส่งคืน" value={fmt(stats.ngWaitingQty)} unit="ชิ้น" sub={`พบใหม่วันนี้ ${fmt(stats.ngFoundToday)} ชิ้น`} />
    </div>
  )
}
