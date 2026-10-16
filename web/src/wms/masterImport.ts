import { canonPartNo, partRevision, resolvePart } from './partCodes'
import type { FgItem, MasterData, PartMaster } from './types'

/**
 * นำเข้าข้อมูลหลักจาก Excel: ตรวจทุกแถวก่อนบันทึก (ใหม่ / แก้ไข / เหมือนเดิม / ผิด)
 * แบบฟอร์ม Part: Part No. | รหัส UAM | ชื่อ | กลุ่ม | Model (คั่นด้วย ,)
 * แบบฟอร์ม BOM: รหัสชุด | ชื่อชุด | Model | Part No. หรือรหัส UAM | จำนวนต่อวง — 1 ชุดหลายแถว, ชุดในไฟล์ = BOM ครบชุด
 */

export const PART_HEADERS = ['Part No.', 'รหัส UAM', 'ชื่อ / รายการ', 'กลุ่ม', 'Model (คั่นด้วย ,)']
export const BOM_HEADERS = ['รหัสชุดวงล้อ', 'ชื่อชุด', 'Model', 'Part No. หรือรหัส UAM', 'จำนวนต่อ 1 วง']

export type ImportStatus = 'new' | 'update' | 'same' | 'error'

export interface PartImport {
  /** แถวใน Excel */
  row: number
  part: PartMaster
  status: ImportStatus
  messages: string[]
}

export interface FgImport {
  rows: number[]
  fg: FgItem
  status: ImportStatus
  messages: string[]
}

const cell = (r: string[], i: number) => (r[i] ?? '').trim()
const isHeader = (r: string[], first: string) => cell(r, 0).toLowerCase() === first.toLowerCase()

/** แถวข้อมูล (ตัดหัวตารางและแถวว่าง) พร้อมเลขแถวใน Excel */
function dataRows(rows: string[][], first: string): { n: number; r: string[] }[] {
  const h = rows.findIndex((r) => isHeader(r, first))
  return rows
    .map((r, i) => ({ n: i + 1, r }))
    .slice(h + 1)
    .filter(({ r }) => r.some((c) => c && c.trim()))
}

export function planPartImport(rows: string[][], master: Pick<MasterData, 'parts' | 'models'>): PartImport[] {
  const models = new Set(master.models.map((m) => m.code))
  const out: PartImport[] = []
  /** รหัส UAM ที่กรอกในไฟล์ (ไม่นับค่าเดิมในระบบ) */
  const rowsUam = new Map<number, string>()
  for (const { n, r } of dataRows(rows, PART_HEADERS[0])) {
    const messages: string[] = []
    const raw = cell(r, 0).toUpperCase()
    const partNo = canonPartNo(master.parts, raw)
    const prev = master.parts.find((p) => p.partNo === partNo)
    const uam = cell(r, 1) || null
    if (uam) rowsUam.set(n, uam)
    const name = cell(r, 2) || prev?.name || ''
    const type = cell(r, 3).toUpperCase() || prev?.type || null
    const fileModels = cell(r, 4)
      .split(/[,\s]+/)
      .map((m) => m.trim().toUpperCase())
      .filter(Boolean)
    if (!partNo) messages.push('ไม่มี Part No.')
    if (!name) messages.push('ไม่มีชื่อ (part ใหม่ต้องใส่ชื่อ)')
    for (const m of fileModels) if (!models.has(m)) messages.push(`ไม่รู้จัก Model ${m}`)
    if (uam && !/^\d{4,10}$/.test(uam)) messages.push(`รหัส UAM "${uam}" ควรเป็นตัวเลข`)
    const other = uam && master.parts.find((p) => p.uamCode === uam && p.partNo !== partNo)
    if (other) messages.push(`รหัส UAM ${uam} เป็นของ ${other.partNo} อยู่แล้ว`)

    const part: PartMaster = {
      partNo,
      name,
      type,
      customerId: prev?.customerId ?? 'RE',
      // เพิ่ม Model ได้อย่างเดียว (ไม่ถอด Model เดิมออก)
      models: [...new Set([...(prev?.models ?? []), ...fileModels])],
      uamCode: uam ?? prev?.uamCode ?? null,
      revision: (!partNo.includes('/') && partRevision(raw)) || prev?.revision || null,
    }
    const same =
      prev &&
      prev.name === part.name &&
      (prev.type ?? null) === part.type &&
      (prev.uamCode ?? null) === part.uamCode &&
      part.models.every((m) => prev.models.includes(m))
    out.push({ row: n, part, status: messages.length ? 'error' : !prev ? 'new' : same ? 'same' : 'update', messages })
  }
  // ซ้ำกันในไฟล์: ไม่รู้ว่าแถวไหนถูก ⇒ ผิดทุกแถวที่ซ้ำ (ไม่บันทึกแถวแรกไปก่อน)
  const dup = (key: (x: PartImport) => string | null | undefined, what: string) => {
    const rows = new Map<string, number[]>()
    for (const x of out) {
      const k = key(x)
      if (k) rows.set(k, [...(rows.get(k) ?? []), x.row])
    }
    for (const x of out) {
      const same = rows.get(key(x) ?? '') ?? []
      if (same.length < 2) continue
      x.messages.push(`${what}ซ้ำกับแถว ${same.filter((r) => r !== x.row).join(', ')}`)
      x.status = 'error'
    }
  }
  dup((x) => x.part.partNo, '')
  dup((x) => x.part.uamCode && rowsUam.get(x.row), 'รหัส UAM ')
  return out
}

export function planFgImport(rows: string[][], master: Pick<MasterData, 'parts' | 'models' | 'fgItems'>): FgImport[] {
  const models = new Set(master.models.map((m) => m.code))
  const byCode = new Map<string, FgImport>()
  for (const { n, r } of dataRows(rows, BOM_HEADERS[0])) {
    const code = cell(r, 0).toUpperCase()
    if (!code) continue
    let g = byCode.get(code)
    if (!g) {
      const prev = master.fgItems.find((f) => f.code === code)
      const model = cell(r, 2).toUpperCase() || prev?.modelCode || null
      g = { rows: [], fg: { code, name: cell(r, 1) || prev?.name || '', modelCode: model, active: true, lines: [] }, status: 'new', messages: [] }
      if (!g.fg.name) g.messages.push(`แถว ${n}: ไม่มีชื่อชุด`)
      if (model && !models.has(model)) g.messages.push(`แถว ${n}: ไม่รู้จัก Model ${model}`)
      byCode.set(code, g)
    }
    g.rows.push(n)
    const ref = cell(r, 3)
    const part = resolvePart(master.parts as PartMaster[], ref)
    const qty = Number(cell(r, 4).replace(/,/g, ''))
    if (!part) g.messages.push(`แถว ${n}: ไม่พบ part "${ref}" ใน Master`)
    else if (!Number.isFinite(qty) || qty <= 0) g.messages.push(`แถว ${n}: จำนวนต่อวงของ ${part.partNo} ต้องมากกว่า 0`)
    else if (g.fg.lines.some((l) => l.partNo === part.partNo)) g.messages.push(`แถว ${n}: ${part.partNo} ซ้ำในชุดเดียวกัน`)
    else g.fg.lines.push({ partNo: part.partNo, qtyPer: qty })
  }
  return [...byCode.values()].map((g) => {
    const prev = master.fgItems.find((f) => f.code === g.fg.code)
    const key = (f: FgItem) =>
      `${f.name}|${f.modelCode}|${f.active}|${[...f.lines]
        .sort((a, b) => a.partNo.localeCompare(b.partNo))
        .map((l) => `${l.partNo}:${l.qtyPer}`)
        .join(',')}`
    return { ...g, status: g.messages.length ? 'error' : !prev ? 'new' : key(prev) === key(g.fg) ? 'same' : 'update' }
  })
}
