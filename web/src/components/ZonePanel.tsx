import { BRAND } from '../data/brand'
import { modelColor } from '../data/modelColors'
import { ZONE_STYLE } from '../data/zoneStyle'
import type { ZoneContents } from '../inventory/reports'
import type { FactoryLayout } from '../types/layout'

interface Props {
  layout: FactoryLayout
  zoneId: string | null
  contents: ZoneContents | null
  /** ยอดรวมทุกโซน — ใช้แสดงรายการโซนที่มีของเมื่อยังไม่ได้เลือก */
  allZones: Map<string, ZoneContents>
  onSelectZone: (zoneId: string) => void
}

const fmt = (n: number) => n.toLocaleString('th-TH')

/** แผง "ในโซนนี้มีอะไร": คลิกโซนบนผัง 3D แล้วแสดงของที่จัดเก็บ แยกตาม Model */
export function ZonePanel({ layout, zoneId, contents, allZones, onSelectZone }: Props) {
  const zone = layout.zones.find((z) => z.id === zoneId)
  const floorName = (floorId: string) => layout.floors.find((f) => f.id === floorId)?.name ?? floorId

  if (!zone || !contents) {
    const stocked = [...allZones.values()].filter((z) => z.totalQty > 0).sort((a, b) => b.totalQty - a.totalQty)
    return (
      <div className="flex flex-col gap-3">
        <p className="text-slate-500">คลิกชั้นวางหรือเต็นท์บนผัง เพื่อดูว่าในโซนนั้นมี part อะไร ของ Model ไหน เท่าไร</p>
        <h3 className="font-semibold" style={{ color: BRAND.primary }}>
          โซนที่มีของ ({stocked.length})
        </h3>
        <ul className="flex flex-col gap-1.5">
          {stocked.map((z) => {
            const zz = layout.zones.find((x) => x.id === z.zoneId)
            return (
              <li key={z.zoneId}>
                <button className="w-full rounded-md border border-slate-200 p-2 text-left hover:bg-slate-50" onClick={() => onSelectZone(z.zoneId)}>
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold">{zz?.name ?? z.zoneId}</span>
                    <span className="tabular-nums">{fmt(z.totalQty)} ชิ้น</span>
                  </div>
                  <ModelBar models={z.models} total={z.totalQty} />
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex items-center gap-2">
          <i className="inline-block h-3 w-3 rounded-sm" style={{ background: ZONE_STYLE[zone.kind].color }} />
          <h3 className="text-base font-bold" style={{ color: BRAND.primary }}>
            {zone.name}
          </h3>
        </div>
        <div className="text-xs text-slate-500">
          {floorName(zone.floorId)} · รหัส {zone.code}
          {zone.stores && ` · เก็บ ${zone.stores.join(' / ')}`}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
          <div className="text-[11px] text-slate-500">ของในโซน (BOI)</div>
          <div className="text-lg font-bold tabular-nums" style={{ color: BRAND.primary }}>
            {fmt(contents.totalQty)} ชิ้น
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
          <div className="text-[11px] text-slate-500">ในนั้นรอตรวจ MI3</div>
          <div className="text-lg font-bold tabular-nums text-amber-700">{fmt(contents.pendingQcQty)} ชิ้น</div>
        </div>
      </div>

      {contents.items.length === 0 ? (
        <p className="rounded-md bg-slate-50 p-3 text-slate-500">โซนนี้ว่าง ยังไม่มีของจัดเก็บ</p>
      ) : (
        <>
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-600">สัดส่วนตาม Model</div>
            <ModelBar models={contents.models} total={contents.totalQty} />
            <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {contents.models.map((m) => (
                <li key={m.model} className="flex items-center gap-1">
                  <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: modelColor(m.model) }} />
                  <b>{m.model}</b> <span className="tabular-nums text-slate-600">{fmt(m.qty)}</span>
                </li>
              ))}
            </ul>
          </div>

          <table className="w-full text-left text-xs">
            <thead className="text-slate-400">
              <tr className="border-b border-slate-200">
                <th className="py-1">Part / Lot</th>
                <th>Model</th>
                <th className="text-right">จำนวน</th>
              </tr>
            </thead>
            <tbody>
              {contents.items.map((i) => (
                <tr key={i.lot.id} className="border-b border-slate-100 align-top">
                  <td className="py-1">
                    <div className="font-mono">{i.lot.partNo}</div>
                    <div className="text-[11px] text-slate-500">{i.part?.description}</div>
                    <div className="font-mono text-[10px] text-slate-400">{i.lot.id}</div>
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1">
                      <i className="inline-block h-2 w-2 rounded-sm" style={{ background: modelColor(i.lot.model) }} />
                      {i.lot.model}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">
                    <b>{fmt(i.qty)}</b>
                    {i.pendingQc > 0 && <div className="text-[10px] text-amber-700">รอตรวจ {fmt(i.pendingQc)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

function ModelBar({ models, total }: { models: { model: string; qty: number }[]; total: number }) {
  if (!total) return null
  return (
    <div className="mt-1 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={models.map((m) => `${m.model} ${m.qty}`).join(', ')}>
      {models.map((m) => (
        <span key={m.model} style={{ width: `${(m.qty / total) * 100}%`, background: modelColor(m.model) }} title={`${m.model}: ${fmt(m.qty)}`} />
      ))}
    </div>
  )
}
