import { useState } from 'react'
import { BRAND } from '../data/brand'
import { palletsFor, planRack } from '../data/warehouse'
import type { ZoneContents } from '../inventory/reports'
import { clampToFloor, editCount, isEditable, newZone, rotated, zoneIssues, type LayoutEdits, type NewZoneKind, type ZonePatch } from '../lib/layoutEdit'
import type { FactoryLayout, Zone } from '../types/layout'
import { inputCls } from './inventory/format'

interface Props {
  layout: FactoryLayout
  edits: LayoutEdits
  zoneId: string | null
  stock: Map<string, ZoneContents>
  onSelect: (zoneId: string | null) => void
  onUpdate: (zoneId: string, patch: ZonePatch) => void
  onAdd: (zone: Zone) => void
  onRemove: (zoneId: string) => void
  onReset: () => void
}

const KIND_LABEL: Partial<Record<Zone['kind'], string>> = {
  storage: 'Rack',
  assembly: 'ไลน์ประกอบ',
  receiving: 'จุดรับเข้า',
  inspection: 'พื้นที่ตรวจ MI3',
  ng: 'พื้นที่กัก NG',
  utility: 'ที่ชาร์จรถยก',
}

const ADDABLE: NewZoneKind[] = ['storage', 'assembly', 'inspection', 'ng', 'utility']

/** แผงแก้ไขผัง: เลือกโซนแล้วลากบนผัง 3D หรือกรอกตำแหน่ง/ขนาด, เพิ่ม/ลบ rack และไลน์ประกอบ */
export function LayoutEditorPanel({ layout, edits, zoneId, stock, onSelect, onUpdate, onAdd, onRemove, onReset }: Props) {
  const buildingFloors = layout.floors.filter((f) => f.area === 'building')
  const [addFloorId, setAddFloorId] = useState(buildingFloors[0]?.id ?? '')
  const [addKind, setAddKind] = useState<NewZoneKind>('storage')
  const floorOf = (id: string) => layout.floors.find((f) => f.id === id)
  const editable = layout.zones.filter((z) => isEditable(z, floorOf(z.floorId)))
  const zone = editable.find((z) => z.id === zoneId)
  const changed = new Set([...Object.keys(edits.changed), ...edits.added.map((z) => z.id)])

  const add = (kind: NewZoneKind) => {
    const floor = floorOf(addFloorId)
    if (!floor) return
    const created = newZone(kind, floor, layout.zones)
    onAdd(created)
    onSelect(created.id)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md bg-blue-50 p-3 text-xs leading-relaxed text-blue-900">
        <b>โหมดแก้ไขผัง</b> · ลาก rack / ไลน์ประกอบ / จุดรับเข้า บนผัง 3D เพื่อย้าย (ขยับทีละ 0.5 ม.) หรือกรอกค่าด้านล่าง · ระบบหาทางเดินเข้าใหม่และคำนวณระยะเดินส่ง
        Part ให้ทันที · บันทึกอัตโนมัติในเครื่องนี้
      </div>

      <section className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">เพิ่มที่</span>
        <select className="rounded-md border border-slate-300 px-2 py-1" value={addFloorId} onChange={(e) => setAddFloorId(e.target.value)}>
          {buildingFloors.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <select className="rounded-md border border-slate-300 px-2 py-1" value={addKind} onChange={(e) => setAddKind(e.target.value as NewZoneKind)}>
          {ADDABLE.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <button className="rounded-md px-3 py-1 font-semibold text-white" style={{ background: BRAND.primary }} onClick={() => add(addKind)}>
          + เพิ่ม
        </button>
      </section>

      {zone ? (
        <ZoneForm
          key={zone.id}
          zone={zone}
          layout={layout}
          stock={stock.get(zone.id)}
          onUpdate={(patch) => onUpdate(zone.id, patch)}
          onRemove={() => {
            onRemove(zone.id)
            onSelect(null)
          }}
        />
      ) : (
        <p className="text-sm text-slate-500">คลิกโซนบนผังหรือในรายการด้านล่างเพื่อแก้ไข</p>
      )}

      <section className="flex flex-col gap-2">
        {buildingFloors.map((f) => (
          <div key={f.id}>
            <h4 className="mb-1 text-xs font-semibold text-slate-500">{f.name}</h4>
            <ul className="flex flex-col gap-1">
              {editable
                .filter((z) => z.floorId === f.id)
                .map((z) => {
                  const issues = zoneIssues(layout, z)
                  return (
                    <li key={z.id}>
                      <button
                        onClick={() => onSelect(z.id)}
                        className={`flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-sm ${z.id === zoneId ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}
                      >
                        <i className={`h-2 w-2 shrink-0 rounded-full ${issues.some((i) => i.level === 'error') ? 'bg-red-500' : issues.length ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                        <span className="font-medium">{z.code}</span>
                        <span className="truncate text-slate-500">{z.name}</span>
                        {changed.has(z.id) && <span className="ml-auto shrink-0 rounded bg-blue-100 px-1 text-[10px] text-blue-700">แก้แล้ว</span>}
                      </button>
                    </li>
                  )
                })}
            </ul>
          </div>
        ))}
      </section>

      <footer className="flex items-center justify-between border-t border-slate-200 pt-3 text-xs text-slate-500">
        <span>แก้ไขแล้ว {editCount(edits)} รายการ</span>
        <button
          className="rounded-md border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          disabled={!editCount(edits)}
          onClick={() => {
            if (confirm('คืนค่าผังเริ่มต้น? ตำแหน่งที่แก้ไว้และโซนที่เพิ่มจะหายทั้งหมด')) {
              onReset()
              onSelect(null)
            }
          }}
        >
          คืนค่าผังเริ่มต้น
        </button>
      </footer>
    </div>
  )
}

function ZoneForm({ zone, layout, stock, onUpdate, onRemove }: { zone: Zone; layout: FactoryLayout; stock?: ZoneContents; onUpdate: (patch: ZonePatch) => void; onRemove: () => void }) {
  const floor = layout.floors.find((f) => f.id === zone.floorId)!
  const issues = zoneIssues(layout, zone)
  const qty = stock?.totalQty ?? 0
  const canRemove = zone.kind !== 'receiving' && qty === 0
  const access = layout.nodes.find((n) => n.id === zone.accessNodeId)

  /** แก้ตำแหน่ง/ขนาด แล้วบีบให้อยู่ในพื้นชั้น */
  const place = (patch: Partial<Pick<Zone, 'x' | 'z' | 'width' | 'depth'>>, target = floor) => {
    const next = clampToFloor({ ...zone, ...patch }, target)
    onUpdate({ x: next.x, z: next.z, width: next.width, depth: next.depth, ...(target.id !== zone.floorId ? { floorId: target.id } : {}) })
  }
  const num = (label: string, key: 'x' | 'z' | 'width' | 'depth', min: number) => (
    <label className="flex flex-col gap-0.5 text-xs text-slate-500">
      {label}
      <input
        type="number"
        step={0.5}
        min={min}
        className={inputCls}
        value={zone[key]}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v) && v >= min) place({ [key]: v })
        }}
      />
    </label>
  )

  const plan = zone.kind === 'storage' ? planRack(zone.width, zone.depth) : null
  const pallets = plan ? palletsFor(stock).length : 0

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-blue-200 p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold" style={{ color: BRAND.primary }}>
          {KIND_LABEL[zone.kind]} {zone.code}
        </h3>
        <span className="text-xs text-slate-500">{qty ? `${qty.toLocaleString('th-TH')} ชิ้น` : 'ว่าง'}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5 text-xs text-slate-500">
          รหัส
          <input className={inputCls} value={zone.code} onChange={(e) => onUpdate({ code: e.target.value })} />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-slate-500">
          ชั้น
          <select
            className={inputCls}
            value={zone.floorId}
            onChange={(e) => {
              const target = layout.floors.find((f) => f.id === e.target.value)
              if (target) place({}, target)
            }}
          >
            {layout.floors
              .filter((f) => f.area === 'building')
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-0.5 text-xs text-slate-500">
          ชื่อ
          <input className={inputCls} value={zone.name} onChange={(e) => onUpdate({ name: e.target.value })} />
        </label>
        {num('ตำแหน่ง X (ม.)', 'x', 0)}
        {num('ตำแหน่ง Z (ม.)', 'z', 0)}
        {num('กว้าง (ม.)', 'width', 1)}
        {num('ลึก (ม.)', 'depth', 1)}
      </div>
      <div className="flex gap-2 text-sm">
        <button className="flex-1 rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50" onClick={() => place(rotated(zone))}>
          ↻ หมุน 90°
        </button>
        <button
          className="flex-1 rounded-md border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canRemove}
          title={zone.kind === 'receiving' ? 'จุดรับเข้าลบไม่ได้' : qty ? 'ย้ายของออกจากโซนก่อนลบ' : undefined}
          onClick={() => confirm(`ลบ ${zone.code}?`) && onRemove()}
        >
          ลบ
        </button>
      </div>
      {plan && (
        <p className="text-xs text-slate-600">
          ความจุ {plan.slots.length} ช่องพาเลท ({plan.rows.length} แถว × {plan.bays} ช่อง × 3 ระดับ) · ใช้อยู่ {pallets} พาเลท
          {pallets > plan.slots.length && <b className="text-red-600"> · เกินความจุ {pallets - plan.slots.length} พาเลท</b>}
        </p>
      )}
      <p className="text-xs text-slate-500">
        จุดเข้า-ออก: {access ? `ทางเดิน (${access.x}, ${access.z})` : '—'}
      </p>
      {issues.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {issues.map((i) => (
            <li key={i.text} className={i.level === 'error' ? 'text-red-600' : 'text-amber-600'}>
              ⚠ {i.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
