import { useState } from 'react'
import { BUCKET_LABEL, FLOW } from '../../inventory/ledger'
import { MODELS } from '../../inventory/masterData'
import { bangkokDate, movementLog, type MovementFilter } from '../../inventory/reports'
import type { InventoryApi } from '../../inventory/useInventory'
import type { MovementKind } from '../../inventory/types'
import { fmt, fmtTime, inputBase } from './format'
import { Chip, Panel } from './ui'

interface Props {
  api: InventoryApi
  onTrace: (lotId: string) => void
}

/** ประวัติการเคลื่อนไหวทั้งระบบ: ทุกแถว tag กลับไปหา lot → invoice → Model ได้ */
export function MovementLog({ api, onTrace }: Props) {
  const today = bangkokDate()
  const [filter, setFilter] = useState<MovementFilter>({ from: today, to: today })
  const rows = movementLog(api.state, filter)
  const totalIn = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + r.movement.qty, 0)
  const totalOut = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + r.movement.qty, 0)
  const set = (patch: Partial<MovementFilter>) => setFilter((f) => ({ ...f, ...patch }))

  return (
    <Panel title="Movement — ความเคลื่อนไหวสินค้าเข้า-ออกทั้งระบบ">
      <div className="mb-3 flex flex-wrap items-end gap-2 text-xs text-slate-600">
        <label className="flex flex-col gap-0.5">
          ตั้งแต่
          <input id="mv-from" type="date" className={inputBase} value={filter.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} />
        </label>
        <label className="flex flex-col gap-0.5">
          ถึง
          <input id="mv-to" type="date" className={inputBase} value={filter.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} />
        </label>
        <label className="flex flex-col gap-0.5">
          Model
          <select id="mv-model" className={inputBase} value={filter.model ?? ''} onChange={(e) => set({ model: e.target.value || undefined })}>
            <option value="">ทุก Model</option>
            {MODELS.map((m) => (
              <option key={m.code} value={m.code}>
                {m.code}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          ประเภท
          <select id="mv-kind" className={inputBase} value={filter.kind ?? ''} onChange={(e) => set({ kind: (e.target.value || undefined) as MovementKind | undefined })}>
            <option value="">ทุกประเภท</option>
            {(Object.keys(FLOW) as MovementKind[]).map((k) => (
              <option key={k} value={k}>
                {FLOW[k].label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-0.5">
          ค้นหา
          <input
            id="mv-q"
            className={`${inputBase} w-full`}
            value={filter.q ?? ''}
            placeholder="เลข Invoice, Lot, Part No., ผู้บันทึก, หมายเหตุ"
            onChange={(e) => set({ q: e.target.value || undefined })}
          />
        </label>
      </div>

      <div className="mb-2 flex flex-wrap gap-2 text-xs">
        <Chip tone="muted">{rows.length} รายการ</Chip>
        <Chip tone="info">เข้า {fmt(totalIn)} ชิ้น</Chip>
        <Chip tone="warn">ออก {fmt(totalOut)} ชิ้น</Chip>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-[13px] tabular-nums">
          <thead className="text-xs text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="py-1.5 pr-2">เวลา</th>
              <th className="pr-2">รายการ</th>
              <th className="pr-2">Part</th>
              <th className="pr-2">Model</th>
              <th className="pr-2">Lot / Invoice</th>
              <th className="pr-2">จาก → ไป</th>
              <th className="pr-2 text-right">จำนวน</th>
              <th className="pr-2">ผู้บันทึก</th>
              <th>หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.movement.id} className="border-b border-slate-100 align-top hover:bg-slate-50">
                <td className="whitespace-nowrap py-1.5 pr-2 text-slate-500">{fmtTime(r.movement.at)}</td>
                <td className="pr-2">
                  <Chip tone={r.direction === 'in' ? 'info' : r.direction === 'out' ? 'warn' : 'muted'}>{r.label}</Chip>
                </td>
                <td className="pr-2">
                  <div className="font-mono text-xs">{r.lot.partNo}</div>
                  <div className="max-w-56 truncate text-[11px] text-slate-500">{r.part?.description}</div>
                </td>
                <td className="pr-2 font-semibold">{r.lot.model}</td>
                <td className="pr-2">
                  <button className="whitespace-nowrap font-mono text-xs text-sky-700 hover:underline" onClick={() => onTrace(r.lot.id)}>
                    {r.lot.id}
                  </button>
                </td>
                <td className="whitespace-nowrap pr-2 text-xs text-slate-600">
                  {r.movement.from ? BUCKET_LABEL[r.movement.from] : 'ภายนอก'} → {r.movement.to ? BUCKET_LABEL[r.movement.to] : 'ภายนอก'}
                </td>
                <td className="pr-2 text-right font-semibold">{fmt(r.movement.qty)}</td>
                <td className="whitespace-nowrap pr-2 text-xs">{r.movement.by ?? '—'}</td>
                <td className="text-xs text-slate-600">{r.movement.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="py-6 text-center text-sm text-slate-500">ไม่มีรายการตามเงื่อนไขที่เลือก</p>}
      </div>
    </Panel>
  )
}
