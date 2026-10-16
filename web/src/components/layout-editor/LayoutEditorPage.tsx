import { useEffect, useMemo, useState } from 'react'
import { BRAND } from '../../data/brand'
import { ZONE_STYLE } from '../../data/zoneStyle'
import type { ZoneContents } from '../../inventory/reports'
import { floorPaint } from '../../lib/floorPlan'
import { errorText } from '../../wms/api'
import {
  applyLayoutEdits,
  clampToFloor,
  CORE_KINDS,
  editCount,
  emptyEdits,
  isEditable,
  newZone,
  rotated,
  withCopiesOnFloors,
  zoneIssues,
  type NewZoneKind,
} from '../../lib/layoutEdit'
import { findRoute, type RouteResult } from '../../lib/pathfinding'
import type { LayoutEditsApi } from '../../lib/useLayoutEdits'
import type { FactoryLayout, Zone } from '../../types/layout'
import { PlanCanvas } from './PlanCanvas'
import { ZoneForm } from './ZoneForm'

interface Props {
  /** ผังที่ใช้งานอยู่ (รวมการแก้ไขแล้ว) */
  layout: FactoryLayout
  /** ผังหลักก่อนแก้ — ใช้เทียบระยะเดิน */
  baseLayout: FactoryLayout
  api: LayoutEditsApi
  stock: Map<string, ZoneContents>
  /** มีสิทธิ์แก้ผัง (layout.edit) — ไม่มี = ดูอย่างเดียว */
  canEdit: boolean
  /** ต่อ Supabase: บันทึกลงฐานข้อมูลกลาง · ไม่มี = โหมดสาธิต เก็บในเครื่อง */
  onSave?: () => Promise<void>
  onOpen3D: (zoneId: string | null) => void
}

const ADDABLE: { kind: NewZoneKind; label: string; size: string }[] = [
  { kind: 'storage', label: 'โซนเก็บ (พาเลท / Rack)', size: '13.5 × 6.1 ม.' },
  { kind: 'assembly', label: 'ไลน์ประกอบ', size: '24 × 8 ม.' },
  { kind: 'inspection', label: 'พื้นที่ตรวจ/คัด MI3', size: '9 × 7 ม.' },
  { kind: 'ng', label: 'พื้นที่กัก NG', size: '8 × 6 ม.' },
  { kind: 'utility', label: 'ที่ชาร์จรถยก / พาเลทเปล่า', size: '9 × 6 ม.' },
  { kind: 'stairs', label: 'บันได', size: '4 × 10 ม.' },
  { kind: 'lift', label: 'ลิฟต์ขนของ', size: '4 × 8 ม.' },
]

const typing = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement

/** หน้าปรับผังโรงงาน (แยกจากผัง 3D): ผังมุมบนรายชั้นที่ลาก-วาง-ปรับขนาดได้ พร้อมผลต่อระยะเดินส่ง Part */
export function LayoutEditorPage({ layout, baseLayout, api, stock, canEdit, onSave, onOpen3D }: Props) {
  const buildingFloors = layout.floors.filter((f) => f.area === 'building')
  const [floorId, setFloorId] = useState(buildingFloors[0]?.id ?? '')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAisles, setShowAisles] = useState(true)

  const selected = layout.zones.find((z) => z.id === selectedId) ?? null
  // โซนที่เลือกถูกย้ายไปชั้นอื่น ⇒ ตามไปที่ชั้นนั้น
  const activeFloorId = selected && buildingFloors.some((f) => f.id === selected.floorId) ? selected.floorId : floorId
  const floor = buildingFloors.find((f) => f.id === activeFloorId) ?? buildingFloors[0]
  // คำนวณเร็ว (ทางเดิน ~30 เส้น, เสา ~40 ต้น) จึงไม่ต้อง memo
  const paint = floorPaint(layout, floor)
  const zones = layout.zones.filter((z) => z.floorId === floor.id)
  const nodes = layout.nodes.filter((n) => n.floorId === floor.id)
  const viewable = (z: Zone) => isEditable(z, floor)
  const editable = (z: Zone) => canEdit && viewable(z)
  const issues = new Map(zones.filter(viewable).map((z) => [z.id, zoneIssues(layout, z)]))
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const pending = editCount(api.edits)

  const save = async () => {
    if (!onSave) return
    const errors = layout.zones.filter((z) => zoneIssues(layout, z).some((i) => i.level === 'error') && isEditable(z, layout.floors.find((f) => f.id === z.floorId)))
    if (errors.length && !confirm(`มี ${errors.length} โซนที่ยังมีปัญหา (${errors.map((z) => z.code).slice(0, 5).join(', ')}) — บันทึกต่อหรือไม่?`)) return
    setSaving(true)
    setSaveMsg(null)
    try {
      await onSave()
      setSaveMsg({ ok: true, text: 'บันทึกผังแล้ว — ทุกคนเห็นผังนี้' })
    } catch (e) {
      setSaveMsg({ ok: false, text: errorText(e) })
    } finally {
      setSaving(false)
    }
  }
  const baseline = useMemo(() => applyLayoutEdits(baseLayout, emptyEdits()), [baseLayout])

  const add = (kind: NewZoneKind) => {
    if (!canEdit) return
    const zone = newZone(kind, floor, layout.zones)
    api.add(zone)
    setSelectedId(zone.id)
  }

  const removable = (z: Zone) => editable(z) && z.kind !== 'receiving' && !(stock.get(z.id)?.totalQty ?? 0)

  // คีย์ลัด: ลูกศร = ขยับ (Shift = 2 ม.), R = หมุน, Delete = ลบ, Esc = ยกเลิกเลือก, Ctrl+Z / Ctrl+Y = ย้อน / ทำซ้ำ
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) api.redo()
        else api.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        api.redo()
        return
      }
      if (e.key === 'Escape') return setSelectedId(null)
      if (!selected || !isEditable(selected, floor)) return
      const step = e.shiftKey ? 2 : 0.5
      const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      if (move[e.key]) {
        e.preventDefault()
        const next = clampToFloor({ ...selected, x: selected.x + move[e.key][0], z: selected.z + move[e.key][1] }, floor)
        api.update(selected.id, { x: next.x, z: next.z })
      } else if (e.key.toLowerCase() === 'r') {
        const next = clampToFloor(rotated(selected), floor)
        api.update(selected.id, { x: next.x, z: next.z, width: next.width, depth: next.depth })
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && removable(selected)) {
        if (confirm(`ลบ ${selected.code}?`)) {
          api.remove(selected.id)
          setSelectedId(null)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto bg-slate-100 p-3 lg:flex-row lg:overflow-hidden">
      {/* ซ้าย: เพิ่มอุปกรณ์ + วิธีใช้ */}
      <aside className="flex shrink-0 flex-col gap-3 lg:w-60">
        <section className={`rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 ${canEdit ? '' : 'hidden'}`}>
          <h2 className="mb-2 text-sm font-bold" style={{ color: BRAND.primary }}>
            เพิ่มลงใน {floor.name.replace('อาคาร ', '')}
          </h2>
          <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-1">
            {ADDABLE.map((a) => (
              <button key={a.kind} onClick={() => add(a.kind)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ring-1 ring-slate-200 hover:bg-slate-50">
                <i className="h-4 w-4 shrink-0 rounded" style={{ background: ZONE_STYLE[a.kind].color }} />
                <span className="leading-tight">
                  <span className="block text-slate-800">{a.label}</span>
                  <span className="block text-[11px] text-slate-400">{a.size}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
        <section className="hidden rounded-xl bg-white p-3 text-xs leading-relaxed text-slate-600 shadow-sm ring-1 ring-slate-200 lg:block">
          <h3 className="mb-1 font-semibold text-slate-800">วิธีใช้</h3>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>ลากโซนเพื่อย้าย (ขยับทีละ 0.5 ม.)</li>
            <li>ลากจุดสี่เหลี่ยมที่มุม/ขอบเพื่อปรับขนาด</li>
            <li>ลากพื้นที่ว่างเพื่อเลื่อนผัง · หมุนล้อเมาส์เพื่อซูม</li>
            <li>
              คีย์ลัด: <b>← ↑ → ↓</b> ขยับ · <b>R</b> หมุน · <b>Del</b> ลบ · <b>Ctrl+Z</b> ย้อน
            </li>
            <li>จุดสีเขียว = จุดหยิบของบนทางเดิน ระบบหาให้ใหม่ทุกครั้งที่ย้าย</li>
            <li>บันได/ลิฟต์: วางให้ตรงกันทุกชั้นจึงจะขึ้น-ลงได้ (มีปุ่มช่วยในแผงด้านขวา)</li>
            {onSave && <li>แก้เสร็จแล้วกด <b>บันทึกผัง</b> เพื่อให้ทุกคนเห็น · ช่องเก็บ (QR) สร้างตามผังที่บันทึก</li>}
          </ul>
        </section>
      </aside>

      {/* กลาง: ผัง */}
      <section className="flex min-h-[60vh] min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-white p-0.5 shadow-sm ring-1 ring-slate-200">
            {buildingFloors.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  setSelectedId(null)
                  setFloorId(f.id)
                }}
                className={`rounded-md px-3 py-1 text-sm transition ${f.id === floor.id ? 'font-semibold text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                style={f.id === floor.id ? { background: BRAND.primary } : undefined}
              >
                {f.name.replace('อาคาร ', '')}
              </button>
            ))}
          </div>
          <div className="flex overflow-hidden rounded-lg bg-white text-sm shadow-sm ring-1 ring-slate-200">
            <button className="px-3 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40" onClick={api.undo} disabled={!api.canUndo} title="ย้อนกลับ (Ctrl+Z)">
              ↶ ย้อน
            </button>
            <button className="border-l border-slate-100 px-3 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40" onClick={api.redo} disabled={!api.canRedo} title="ทำซ้ำ (Ctrl+Y)">
              ทำซ้ำ ↷
            </button>
          </div>
          <label className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1 text-sm text-slate-600 shadow-sm ring-1 ring-slate-200">
            <input type="checkbox" checked={showAisles} onChange={(e) => setShowAisles(e.target.checked)} />
            แสดงทางเดิน
          </label>
          <span className="text-xs text-slate-500">
            {onSave ? (pending ? `แก้ไขแล้ว ${pending} รายการ · ยังไม่บันทึก` : 'ผังตรงกับระบบ') : `แก้ไขแล้ว ${pending} รายการ · เก็บในเครื่องนี้ (โหมดสาธิต)`}
          </span>
          {saveMsg && <span className={`text-xs ${saveMsg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{saveMsg.text}</span>}
          <span className="ml-auto flex gap-2">
            <button className="rounded-lg bg-white px-3 py-1 text-sm text-slate-600 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50" onClick={() => onOpen3D(selectedId)}>
              ดูใน 3D
            </button>
            <button
              className="rounded-lg bg-white px-3 py-1 text-sm text-red-600 shadow-sm ring-1 ring-slate-200 hover:bg-red-50 disabled:opacity-40"
              disabled={!pending || saving}
              onClick={() => {
                if (confirm(`${onSave ? 'ยกเลิกการแก้ไขที่ยังไม่บันทึก?' : 'คืนค่าผังเริ่มต้น?'} ตำแหน่งที่แก้ไว้และโซนที่เพิ่มจะหายทั้งหมด (กดย้อนกลับได้)`)) {
                  api.reset()
                  setSelectedId(null)
                }
              }}
            >
              {onSave ? 'ยกเลิกการแก้ไข' : 'คืนค่าเริ่มต้น'}
            </button>
            {onSave && canEdit && (
              <button
                className="rounded-lg px-3 py-1 text-sm font-semibold text-white shadow-sm disabled:opacity-40"
                style={{ background: BRAND.primary }}
                disabled={!pending || saving}
                onClick={save}
              >
                {saving ? 'กำลังบันทึก…' : 'บันทึกผัง'}
              </button>
            )}
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <PlanCanvas
            key={floor.id}
            floor={floor}
            paint={paint}
            zones={zones}
            nodes={nodes}
            selectedId={selected?.floorId === floor.id ? selectedId : null}
            onSelect={setSelectedId}
            onCommit={api.update}
            issues={issues}
            stock={stock}
            showAisles={showAisles}
            isEditable={editable}
          />
        </div>
      </section>

      {/* ขวา: คุณสมบัติโซน / ภาพรวมชั้น */}
      <aside className="flex min-h-0 shrink-0 flex-col gap-3 overflow-y-auto lg:w-80">
        {selected ? (
          <>
            {viewable(selected) ? (
              <ZoneForm
                key={selected.id}
                zone={selected}
                layout={layout}
                stock={stock.get(selected.id)}
                locked={!canEdit}
                onUpdate={(patch) => canEdit && api.update(selected.id, patch)}
                onRemove={() => {
                  if (!canEdit) return
                  api.remove(selected.id)
                  setSelectedId(null)
                }}
                onCopyToFloors={
                  CORE_KINDS.includes(selected.kind) && !floor.mezzanine ? () => api.transform((e) => withCopiesOnFloors(e, layout, selected.id)) : undefined
                }
              />
            ) : (
              <section className="rounded-xl bg-white p-3 text-sm text-slate-600 shadow-sm ring-1 ring-slate-200">
                <b className="text-slate-800">{selected.name}</b> แก้ในหน้านี้ไม่ได้
              </section>
            )}
            {!CORE_KINDS.includes(selected.kind) && <RouteImpact zone={selected} layout={layout} baseline={baseline} />}
          </>
        ) : (
          <FloorSummary zones={zones.filter(viewable)} issues={issues} stock={stock} onSelect={setSelectedId} />
        )}
      </aside>
    </div>
  )
}

function FloorSummary({
  zones,
  issues,
  stock,
  onSelect,
}: {
  zones: Zone[]
  issues: Map<string, ReturnType<typeof zoneIssues>>
  stock: Map<string, ZoneContents>
  onSelect: (id: string) => void
}) {
  return (
    <section className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <h2 className="mb-1 text-sm font-bold" style={{ color: BRAND.primary }}>
        โซนในชั้นนี้ ({zones.length})
      </h2>
      <p className="mb-2 text-xs text-slate-500">คลิกโซนบนผังหรือในรายการเพื่อแก้ไข</p>
      <ul className="flex flex-col gap-1">
        {zones.map((z) => {
          const list = issues.get(z.id) ?? []
          const qty = stock.get(z.id)?.totalQty ?? 0
          return (
            <li key={z.id}>
              <button onClick={() => onSelect(z.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ring-1 ring-slate-200 hover:bg-slate-50">
                <i className={`h-2 w-2 shrink-0 rounded-full ${list.some((i) => i.level === 'error') ? 'bg-red-500' : list.length ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                <b className="text-slate-800">{z.code}</b>
                <span className="truncate text-slate-500">{z.name}</span>
                {qty > 0 && <span className="ml-auto shrink-0 text-xs tabular-nums text-slate-400">{qty.toLocaleString('th-TH')}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** ผลต่อระยะเดิน: จากจุดรับเข้า → โซนนี้ และ โซนนี้ → ไลน์นำร่อง เทียบกับผังเดิม */
function RouteImpact({ zone, layout, baseline }: { zone: Zone; layout: FactoryLayout; baseline: FactoryLayout }) {
  const rows = useMemo(() => {
    const measure = (l: FactoryLayout, fromId: string, toId: string): RouteResult | null => {
      const from = l.zones.find((z) => z.id === fromId)
      const to = l.zones.find((z) => z.id === toId)
      return from && to ? findRoute(l, from.accessNodeId, to.accessNodeId) : null
    }
    const receiving = layout.zones.find((z) => z.kind === 'receiving')
    const line = layout.zones.find((z) => z.id === 'F2-ASM') ?? layout.zones.find((z) => z.kind === 'assembly')
    const list: { label: string; now: RouteResult | null; before: RouteResult | null }[] = []
    if (zone.kind === 'assembly') {
      // rack ที่ใกล้ไลน์นี้ที่สุด
      const racks = layout.zones.filter((z) => z.kind === 'storage')
      const best = racks
        .map((r) => ({ r, route: measure(layout, r.id, zone.id) }))
        .filter((x) => x.route)
        .sort((a, b) => a.route!.walkDistance - b.route!.walkDistance)[0]
      if (best) list.push({ label: `ส่ง part จาก ${best.r.code} (ใกล้สุด)`, now: best.route, before: measure(baseline, best.r.id, zone.id) })
    } else {
      if (receiving && receiving.id !== zone.id) list.push({ label: `เก็บของจาก ${receiving.code}`, now: measure(layout, receiving.id, zone.id), before: measure(baseline, receiving.id, zone.id) })
      if (line) list.push({ label: `ส่ง part ไป ${line.code}`, now: measure(layout, zone.id, line.id), before: measure(baseline, zone.id, line.id) })
    }
    return list
  }, [zone, layout, baseline])

  if (!rows.length) return null
  return (
    <section className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <h3 className="mb-2 text-sm font-bold" style={{ color: BRAND.primary }}>
        ผลต่อระยะเดิน
      </h3>
      <ul className="flex flex-col gap-2 text-sm">
        {rows.map((r) => {
          const delta = r.now && r.before ? Math.round(r.now.walkDistance - r.before.walkDistance) : null
          return (
            <li key={r.label} className="rounded-lg bg-slate-50 px-2.5 py-2">
              <div className="text-xs text-slate-500">{r.label}</div>
              {r.now ? (
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold tabular-nums text-slate-800">
                    {Math.round(r.now.walkDistance)} ม. · {(r.now.timeSeconds / 60).toFixed(1)} นาที/เที่ยว
                  </span>
                  {delta !== null && delta !== 0 && (
                    <span className={`rounded-full px-1.5 text-xs font-semibold ${delta < 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                      {delta > 0 ? '+' : ''}
                      {delta} ม.
                    </span>
                  )}
                </div>
              ) : (
                <div className="text-sm text-red-600">ไม่มีทางเดินถึง</div>
              )}
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-[11px] text-slate-400">เทียบกับผังเริ่มต้น · คิดตามทางเดินจริงที่ไม่ถูก rack ขวาง</p>
    </section>
  )
}
