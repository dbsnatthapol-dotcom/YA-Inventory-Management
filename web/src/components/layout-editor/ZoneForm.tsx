import { BRAND } from '../../data/brand'
import { palletsFor, STORAGE_LABEL } from '../../data/warehouse'
import { zonePlan } from '../../wms/locations'
import type { ZoneContents } from '../../wms/mapStock'
import { clampToFloor, rotated, zoneIssues, type ZonePatch } from '../../lib/layoutEdit'
import type { FactoryLayout, Zone } from '../../types/layout'
import { inputCls } from '../../lib/format'

const KIND_LABEL: Partial<Record<Zone['kind'], string>> = {
  storage: 'โซนเก็บ',
  stairs: 'บันได',
  lift: 'ลิฟต์',
  assembly: 'ไลน์ประกอบ',
  receiving: 'จุดรับเข้า',
  inspection: 'พื้นที่ตรวจ MI3',
  ng: 'พื้นที่กัก NG',
  utility: 'ที่ชาร์จรถยก',
}

/** แก้ค่าโซนที่เลือก: รหัส ชื่อ ชั้น ตำแหน่ง ขนาด หมุน ลบ + ความจุ rack และข้อเตือน */
export function ZoneForm({
  zone,
  layout,
  stock,
  locked,
  onUpdate,
  onRemove,
  onCopyToFloors,
}: {
  zone: Zone
  layout: FactoryLayout
  stock?: ZoneContents
  /** ไม่มีสิทธิ์แก้ผัง: ดูอย่างเดียว */
  locked?: boolean
  onUpdate: (patch: ZonePatch) => void
  onRemove: () => void
  /** บันได/ลิฟต์: สร้างให้ตรงตำแหน่งเดียวกันทุกชั้นของอาคาร */
  onCopyToFloors?: () => void
}) {
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

  const plan = zone.kind === 'storage' ? zonePlan(layout, zone) : null
  const pallets = plan ? palletsFor(stock).length : 0
  const intIn = (label: string, value: number, min: number, max: number, onChange: (v: number) => void, hint?: string) => (
    <label className="flex flex-col gap-0.5 text-xs text-slate-500">
      {label}
      <input
        type="number"
        step={1}
        min={min}
        max={max}
        className={inputCls}
        value={value}
        onChange={(e) => {
          const v = Math.round(Number(e.target.value))
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)))
        }}
      />
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </label>
  )

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-blue-200 p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold" style={{ color: BRAND.primary }}>
          {KIND_LABEL[zone.kind]} {zone.code}
        </h3>
        <span className="text-xs text-slate-500">{qty ? `${qty.toLocaleString('th-TH')} ชิ้น` : 'ว่าง'}</span>
      </div>
      {locked && <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700">ดูอย่างเดียว — ต้องมีสิทธิ์ "แก้ผังคลัง" จึงจะแก้ได้</p>}
      <fieldset disabled={locked} className="contents">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5 text-xs text-slate-500">
          รหัส
          <input
            className={inputCls}
            value={zone.code}
            disabled={zone.kind === 'receiving' || zone.code === 'MI3-QC'}
            title={zone.kind === 'receiving' || zone.code === 'MI3-QC' ? 'รหัสนี้ใช้ในงานรับของ เปลี่ยนไม่ได้' : undefined}
            onChange={(e) => onUpdate({ code: e.target.value.toUpperCase() })}
          />
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
        <div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-2">
          <div className="flex rounded-md bg-white p-0.5 text-xs ring-1 ring-slate-200" role="radiogroup" aria-label="ประเภทการเก็บ">
            {(['floor', 'rack'] as const).map((t) => (
              <button
                key={t}
                role="radio"
                aria-checked={plan.type === t}
                onClick={() => onUpdate({ storage: t, levels: undefined })}
                className={`flex-1 rounded px-2 py-1 transition ${plan.type === t ? 'font-semibold text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                style={plan.type === t ? { background: BRAND.primary } : undefined}
              >
                {STORAGE_LABEL[t]}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {intIn(plan.type === 'rack' ? 'จำนวนระดับ rack' : 'ซ้อนพาเลทกี่ชั้น', plan.levels.length, 1, plan.maxLevels, (v) => onUpdate({ levels: v }), `สูงสุด ${plan.maxLevels} ชั้น`)}
            {intIn('ที่วางพาเลทต่อชั้น', plan.perLevel, 0, plan.maxPerLevel, (v) => onUpdate({ slotsPerLevel: v }), `เต็มพื้นที่ ${plan.maxPerLevel} ที่`)}
          </div>
          <p className="text-xs text-slate-600">
            ความจุ <b>{plan.slots.length}</b> พาเลท ({plan.perLevel} ที่ × {plan.levels.length} ชั้น) · ใช้อยู่ {pallets} พาเลท
            {pallets > plan.slots.length && <b className="text-red-600"> · เกินความจุ {pallets - plan.slots.length} พาเลท</b>}
          </p>
          <p className="text-[11px] text-slate-400">อยากได้ที่วางมากกว่านี้ ให้ขยายขนาดโซน · ช่องเก็บ (QR) สร้างตามจำนวนนี้เมื่อกดบันทึกผัง</p>
        </div>
      )}
      {onCopyToFloors && (
        <button className="rounded-md border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50 disabled:opacity-40" onClick={onCopyToFloors}>
          วางให้ตรงกันทุกชั้นของอาคาร
        </button>
      )}
      </fieldset>
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
