import { resolvePart } from './partCodes'
import type { Lpn, PartMaster } from './types'

/**
 * นำเข้ายอดตรวจนับ: แบบฟอร์ม ช่องเก็บ/โซน | Part No. | รายการ | ยอดในระบบ | นับได้ | หมายเหตุ
 * แถวที่ "นับได้" ว่าง = ไม่ได้นับ (ข้าม) · ใส่ 0 = นับแล้วไม่มีของ
 */
export const COUNT_HEADERS = ['ช่องเก็บ / โซน', 'Part No.', 'รายการ', 'ยอดในระบบ', 'นับได้', 'หมายเหตุ']

export interface CountCtx {
  parts: PartMaster[]
  locations: { code: string; zoneId: string }[]
  zones: { id: string; code: string }[]
  lpns: Pick<Lpn, 'status' | 'locationCode' | 'items'>[]
}

/** ช่องเก็บที่อยู่ใต้รหัสที่กรอก: ช่องเดียว หรือทุกช่องของโซน (ตรงกับ count_locations ฝั่งฐานข้อมูล) */
export function countLocations(code: string, ctx: Pick<CountCtx, 'locations' | 'zones'>): { locs: string[]; zoneId: string | null } | null {
  const c = code.trim().toUpperCase()
  if (!c) return null
  const loc = ctx.locations.find((l) => l.code === c)
  if (loc) return { locs: [c], zoneId: loc.zoneId }
  const zone = ctx.zones.find((z) => z.code.toUpperCase() === c)
  if (!zone) return null
  return { locs: [...ctx.locations.filter((l) => l.zoneId === zone.id).map((l) => l.code), zone.code], zoneId: zone.id }
}

/** ยอดในระบบของ part ในช่อง/โซน (กล่องที่ใช้งาน รวมกล่องรอ MI3) */
export const systemQty = (lpns: CountCtx['lpns'], locs: string[], partNo: string) =>
  lpns
    .filter((l) => l.status === 'active' && locs.includes(l.locationCode))
    .flatMap((l) => l.items)
    .filter((i) => i.partNo === partNo)
    .reduce((s, i) => s + i.qty, 0)

export interface CountRow {
  row: number
  loc: string
  zoneId: string | null
  partNo: string
  name: string
  system: number
  counted: number
  diff: number
  status: 'match' | 'short' | 'over' | 'error'
  messages: string[]
}

export function planStockImport(rows: string[][], ctx: CountCtx): { rows: CountRow[]; skipped: number } {
  const h = rows.findIndex((r) => (r[0] ?? '').trim() === COUNT_HEADERS[0])
  const out: CountRow[] = []
  let skipped = 0
  rows.forEach((r, i) => {
    if (i <= h) return
    const cell = (k: number) => (r[k] ?? '').trim()
    if (!r.some((c) => c && c.trim())) return
    const countedText = cell(4).replace(/,/g, '')
    if (!countedText) {
      skipped++
      return
    }
    const messages: string[] = []
    const where = countLocations(cell(0), ctx)
    if (!where) messages.push(`ไม่พบช่องเก็บหรือโซน "${cell(0)}"`)
    const part = resolvePart(ctx.parts, cell(1))
    if (!part) messages.push(`ไม่พบ part "${cell(1)}" ใน Master`)
    const counted = Number(countedText)
    if (!Number.isFinite(counted) || counted < 0) messages.push(`จำนวนนับ "${cell(4)}" ต้องเป็นตัวเลข 0 ขึ้นไป`)
    const system = where && part ? systemQty(ctx.lpns, where.locs, part.partNo) : 0
    const diff = messages.length ? 0 : counted - system
    out.push({
      row: i + 1,
      loc: cell(0).toUpperCase(),
      zoneId: where?.zoneId ?? null,
      partNo: part?.partNo ?? cell(1),
      name: part?.name ?? '',
      system,
      counted: Number.isFinite(counted) ? counted : 0,
      diff,
      status: messages.length ? 'error' : diff === 0 ? 'match' : diff < 0 ? 'short' : 'over',
      messages,
    })
  })
  // part เดียวกันหลายแถวที่ช่องซ้อนกัน (ช่องเดียวกัน หรือโซนกับช่องในโซนนั้น) ⇒ ไม่รู้ว่าแถวไหนถูก
  // และอนุมัติแล้วจะปรับยอดซ้ำสองรอบ ⇒ ผิดทุกแถว (กติกาเดียวกับ stock_count_submit ใน 0022)
  const locsOf = new Map(out.map((x) => [x, countLocations(x.loc, ctx)?.locs ?? []]))
  for (const x of out) {
    const mine = new Set(locsOf.get(x))
    const clash = out.filter((y) => y !== x && y.partNo === x.partNo && (locsOf.get(y) ?? []).some((c) => mine.has(c)))
    if (!clash.length) continue
    const same = clash.filter((y) => y.loc === x.loc).map((y) => y.row)
    const nested = clash.filter((y) => y.loc !== x.loc).map((y) => `${y.row} (${y.loc})`)
    if (same.length) x.messages.push(`ซ้ำกับแถว ${same.join(', ')}`)
    if (nested.length) x.messages.push(`ซ้อนกับแถว ${nested.join(', ')} · part เดียวกันให้นับระดับเดียว: รายช่อง หรือทั้งโซน`)
    x.status = 'error'
    x.diff = 0
  }
  return { rows: out, skipped }
}

/** แถวในแบบฟอร์ม: ยอดในระบบรายช่อง (หรือรวมรายโซน) ของทุก part ที่มีของ */
export function countTemplateRows(ctx: CountCtx, opts: { zoneId: string | null; byZone: boolean }): { loc: string; partNo: string; name: string; system: number }[] {
  const zoneOf = new Map(ctx.locations.map((l) => [l.code, l.zoneId]))
  const zoneCode = new Map(ctx.zones.map((z) => [z.id, z.code]))
  const sum = new Map<string, number>()
  for (const l of ctx.lpns) {
    if (l.status !== 'active') continue
    const zoneId = zoneOf.get(l.locationCode) ?? ctx.zones.find((z) => z.code === l.locationCode)?.id ?? null
    if (opts.zoneId && zoneId !== opts.zoneId) continue
    const loc = opts.byZone ? (zoneId ? (zoneCode.get(zoneId) ?? l.locationCode) : l.locationCode) : l.locationCode
    for (const i of l.items) if (i.qty > 0) sum.set(`${loc}|${i.partNo}`, (sum.get(`${loc}|${i.partNo}`) ?? 0) + i.qty)
  }
  const name = new Map(ctx.parts.map((p) => [p.partNo, p.name]))
  return [...sum]
    .map(([k, system]) => {
      const [loc, partNo] = k.split('|')
      return { loc, partNo, name: name.get(partNo) ?? '', system }
    })
    .sort((a, b) => a.loc.localeCompare(b.loc) || a.partNo.localeCompare(b.partNo))
}
