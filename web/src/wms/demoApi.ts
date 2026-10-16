import { sampleLayout } from '../data/factoryLayout'
import { MODELS, PARTS, ZONE_RULES } from '../inventory/masterData'
import type { WmsApi } from './api'
import { layoutLocations, zoneCodeOf } from './locations'
import { buildLedger, monthRange } from './ledger'
import { canonPartNo, partRevision, partsOfModel } from './partCodes'
import type {
  Grn,
  GrnLine,
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  LedgerRow,
  Lpn,
  MasterData,
  PermRow,
  ReceivePayload,
  Requisition,
  StockClosing,
  Settings,
  StaffBrief,
  Tx,
  ZoneHead,
} from './types'

/**
 * โหมดสาธิต (ไม่ได้ต่อ Supabase): เก็บทุกอย่างในเบราว์เซอร์ และใช้กฎเดียวกับฟังก์ชันในฐานข้อมูล
 * (supabase/migrations/0009_wms_functions.sql) เพื่อให้ลองขั้นตอนได้ครบโดยไม่ต้อง login
 */
interface DemoDb {
  settings: Settings
  counters: Record<string, number>
  invoices: (Invoice & { lines: InvoiceLine[] })[]
  grns: Grn[]
  grnLines: GrnLine[]
  lpns: Lpn[]
  tx: Tx[]
  master: MasterData
  perms: PermRow[]
  staff: StaffBrief[]
  requisitions: Requisition[]
  closings: StockClosing[]
}

/** โซนที่มีหัวหน้าโซน (ตรงกับหน้าหลังบ้าน) */
const HEAD_KINDS = new Set(['storage', 'tent', 'receiving', 'inspection', 'ng', 'assembly', 'utility'])
const DEMO_HEAD = { id: 'demo-head', employeeCode: 'DEMO-WH', fullName: 'เต็มดวง (เจี๊ยบ)', role: 'warehouse' }

// v2: รหัส part เป็นเลขฐาน (ข้อมูลสาธิตเก่าที่มี /A /B เริ่มใหม่)
const KEY = 'uam-wms-demo-v2'
const ME = 'DEMO'

function seed(): DemoDb {
  return {
    settings: { mode: 'trial', trialRound: 1, qiPartTypes: ['RIM', 'HUB'] },
    counters: {},
    requisitions: [],
    closings: [],
    invoices: [],
    grns: [],
    grnLines: [],
    lpns: [],
    tx: [],
    master: {
      parts: PARTS.map((p) => ({ partNo: p.partNo, name: p.description, type: p.type, customerId: p.customerId, models: p.models, revision: p.revision ?? null })),
      models: MODELS.map((m) => ({ code: m.code, customerId: m.customerId, requiresInspection: m.requiresInspection })),
      rules: ZONE_RULES.map((r) => ({ customerId: r.customerId, partType: r.type, zoneId: r.zoneId })),
      locations: layoutLocations(sampleLayout).map((l) => ({ ...l, active: true })),
      // หัวหน้าโซนทุกโซน: พี่เต็มดวง (เจี๊ยบ) · ภายหลังแยกตามสายงาน
      zoneHeads: sampleLayout.zones
        .filter((z) => HEAD_KINDS.has(z.kind))
        .map((z) => ({ zoneId: z.id, staffId: DEMO_HEAD.id, employeeCode: DEMO_HEAD.employeeCode, fullName: DEMO_HEAD.fullName })),
      // ตัวอย่างชุดวงล้อ (สาธิต) ตามสัดส่วนใน FM-P-005 290 วง: ลูกปืน 2 ตัว, ซี่ลวดแต่ละแบบ 9 ซี่ ต่อ 1 วง
      fgItems: [
        {
          code: 'K1G-RR-BLK',
          name: 'K1G ล้อหลัง 17×3.50 TL BLACK (ตัวอย่าง)',
          modelCode: 'K1G',
          active: true,
          lines: [
            { partNo: 'RAT00586', qtyPer: 1 },
            { partNo: 'RAT01088', qtyPer: 1 },
            { partNo: 'RAT00282', qtyPer: 1 },
            { partNo: 'RAT00283', qtyPer: 1 },
            { partNo: '150324', qtyPer: 2 },
            { partNo: 'RAT00566', qtyPer: 9 },
            { partNo: 'RAT00567', qtyPer: 9 },
          ],
        },
      ],
    },
    // ค่าเริ่มต้นเดียวกับ supabase/migrations/0008_wms_receiving.sql
    perms: (
      [
        ['warehouse', ['receive.create', 'label.print', 'scan.put', 'scan.move', 'scan.issue', 'scan.adjust', 'scan.count', 'invoice.report']],
        ['mi3', ['scan.qi', 'scan.move', 'label.print']],
        ['engineer', ['scan.adjust.approve', 'invoice.close', 'invoice.report', 'layout.edit']],
        ['manager', ['scan.adjust.approve', 'invoice.close', 'invoice.report', 'accesslog.view', 'master.edit', 'layout.edit', 'ledger.close', 'ledger.ack.account']],
        ['planner', ['ledger.ack.planning']],
      ] as [string, string[]][]
    ).flatMap(([role, perms]) => perms.map((perm) => ({ role, perm, allowed: true }))),
    staff: [{ id: 'demo', employeeCode: ME, fullName: 'ผู้ใช้สาธิต', role: 'admin' }, DEMO_HEAD],
  }
}

function load(): DemoDb {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      // ข้อมูลเก่าในเครื่องอาจยังไม่มีช่องใหม่ (เช่น fgItems) ⇒ เติมจากค่าเริ่มต้น
      const base = seed()
      const saved = JSON.parse(raw) as Partial<DemoDb>
      return { ...base, ...saved, master: { ...base.master, ...saved.master } }
    }
  } catch {
    // ไม่มีที่เก็บ: เริ่มใหม่
  }
  return seed()
}

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`)
const nowIso = () => new Date().toISOString()
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

export function demoWms(): WmsApi {
  let db = load()
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(db))
    } catch {
      // เต็มหรือไม่มีที่เก็บ: ใช้ได้เฉพาะรอบนี้
    }
  }
  const fail = (msg: string): never => {
    throw new Error(msg)
  }  // เดือนที่ปิดยอดแล้ว: ใบเบิกของ Model นั้นแก้ไม่ได้ (เหมือน trigger requisition_month_lock)
  const assertOpen = (model: string | null | undefined, day: string) => {
    if (model && db.closings.some((c) => c.modelCode === model && c.month === day.slice(0, 7) && c.status === 'closed'))
      fail(`บัญชีคุม ${model} เดือน ${day.slice(0, 7)} ปิดยอดแล้ว · ให้ผู้มีสิทธิ์เปิดเดือนก่อน`)
  }

  const nextDoc = (prefix: string) => {
    const d = new Date()
    const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`
    const key = `${prefix}-${yymm}-${db.settings.mode}-${db.settings.trialRound}`
    const n = (db.counters[key] = (db.counters[key] ?? 0) + 1)
    return `${prefix}-${yymm}-${String(n).padStart(prefix === 'LPN' ? 6 : 4, '0')}`
  }
  const log = (t: Partial<Tx> & Pick<Tx, 'kind'>) =>
    db.tx.unshift({
      id: uid(),
      docNo: null,
      lpnId: null,
      lpnNo: null,
      lpnItemId: null,
      partNo: null,
      qty: null,
      newQty: null,
      passQty: null,
      ngQty: null,
      fromLoc: null,
      toLoc: null,
      ref: null,
      reason: null,
      status: 'done',
      createdCode: ME,
      createdAt: nowIso(),
      decidedCode: null,
      ...t,
    })
  const lpnById = (id: string) => db.lpns.find((l) => l.id === id) ?? fail('ไม่พบป้าย')
  const itemById = (id: string) => {
    for (const l of db.lpns) {
      const it = l.items.find((i) => i.id === id)
      if (it) return { lpn: l, item: it }
    }
    return fail('ไม่พบรายการในกล่อง')
  }
  const commit = <T>(fn: () => T): Promise<T> => {
    const before = JSON.stringify(db)
    try {
      const out = fn()
      save()
      return Promise.resolve(clone(out))
    } catch (e) {
      db = JSON.parse(before)
      return Promise.reject(e)
    }
  }
  const lpnOf = (lpn: Lpn) => clone(lpn)

  // ===== ใบเบิก: กติกาเดียวกับ wms_issue_fifo / wms_return_lifo ใน 0014 =====
  const onHand = (part: string) =>
    db.lpns.filter((l) => l.status === 'active').reduce((s, l) => s + l.items.filter((i) => i.partNo === part).reduce((t, i) => t + i.qty, 0), 0)
  const issueFifo = (reqId: string, doc: string, ref: string, part: string, qty: number) => {
    if (!(qty > 0)) return
    const boxes = db.lpns
      .filter((l) => l.status === 'active' && !l.hold && l.items.some((i) => i.partNo === part && i.qty > 0))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.lpnNo.localeCompare(b.lpnNo))
    const have = boxes.reduce((s, l) => s + l.items.filter((i) => i.partNo === part).reduce((t, i) => t + i.qty, 0), 0)
    if (have < qty) fail(`สต็อก ${part} ไม่พอ · พร้อมเบิก ${have} ขอเบิก ${qty}`)
    let left = qty
    for (const l of boxes)
      for (const item of l.items.filter((i) => i.partNo === part && i.qty > 0)) {
        if (left <= 0) break
        const take = Math.min(left, item.qty)
        item.qty -= take
        left -= take
        log({ kind: 'ISSUE', docNo: doc, lpnId: l.id, lpnNo: l.lpnNo, lpnItemId: item.id, partNo: part, qty: take, fromLoc: l.locationCode, ref, requisitionId: reqId })
        if (!l.items.some((i) => i.qty > 0)) l.status = 'empty'
      }
  }
  const putBack = (t: Tx, qty: number, doc: string, ref: string | null, reqId: string, reason: string | null = null) => {
    const l = db.lpns.find((x) => x.id === t.lpnId)
    const item = l?.items.find((i) => i.id === t.lpnItemId)
    if (!l || !item) return
    item.qty += qty
    if (l.status === 'empty') l.status = 'active'
    log({ kind: 'RETURN', docNo: doc, lpnId: l.id, lpnNo: l.lpnNo, lpnItemId: item.id, partNo: t.partNo, qty, toLoc: l.locationCode, ref, reason, requisitionId: reqId })
  }
  const returnLifo = (reqId: string, from: string[], doc: string, ref: string, part: string, qty: number) => {
    let left = qty
    // db.tx เรียงใหม่ → เก่า อยู่แล้ว
    for (const t of db.tx.filter((x) => x.kind === 'ISSUE' && from.includes(x.requisitionId ?? '') && x.partNo === part)) {
      if (left <= 0) break
      const take = Math.min(left, t.qty ?? 0)
      putBack(t, take, doc, ref, reqId)
      left -= take
    }
    if (left > 0) fail(`คืน ${part} ได้ไม่ครบ (เกินยอดที่เบิกไว้ ${left})`)
  }
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })

  const api: WmsApi = {
    kind: 'demo',
    myPermissions: async () => ['*'],
    settings: async () => clone(db.settings),
    master: async () => clone(db.master),

    async findInvoiceNo(no) {
      const inv = db.invoices.find((i) => i.invoiceNo === no.trim())
      return inv ? { id: inv.id, grnCount: db.grns.filter((g) => g.invoiceId === inv.id).length } : null
    },

    createGrn: (input: ReceivePayload) =>
      commit(() => {
        // รหัสหลัก (เลขฐาน) เหมือน trigger part_canon ฝั่งฐานข้อมูล
        const canon = (c: string) => canonPartNo(db.master.parts, c)
        const p: ReceivePayload = {
          ...input,
          lines: input.lines.map((l) => ({ ...l, partNo: canon(l.partNo) })),
          invoice: input.invoice && { ...input.invoice, lines: input.invoice.lines.map((l) => ({ ...l, partNo: canon(l.partNo) })) },
        }
        if (!p.lines.length) fail('ไม่มีรายการรับเข้า')
        if (!p.packingList.refDoc.trim()) fail('ต้องมีเลขอ้างอิงของ Packing List')
        const model = db.master.models.find((m) => m.code === p.modelCode)
        const customer = model?.customerId ?? p.invoice?.customerId ?? null
        let invoice = p.invoice?.invoiceNo ? db.invoices.find((i) => i.invoiceNo === p.invoice!.invoiceNo) : undefined
        if (p.invoice?.invoiceNo && !invoice) {
          invoice = {
            id: uid(),
            invoiceNo: p.invoice.invoiceNo,
            customerId: customer,
            poNo: p.invoice.poNo || null,
            docDate: p.invoice.docDate || null,
            movementType: p.invoice.movementType || null,
            status: 'open',
            statusNote: null,
            statusAt: null,
            imagePaths: p.invoice.imagePaths ?? [],
            createdAt: nowIso(),
            lines: p.invoice.lines.map((l) => ({ lineNo: l.lineNo, partNo: l.partNo, description: l.description, qty: l.qty })),
          }
          db.invoices.unshift(invoice)
        }
        const grn: Grn = {
          id: uid(),
          grnNo: nextDoc('GRN'),
          invoiceId: invoice?.id ?? null,
          invoiceNo: invoice?.invoiceNo ?? null,
          plRef: p.packingList.refDoc,
          soNo: p.packingList.soNo || null,
          packages: p.packingList.packages || null,
          modelCode: p.modelCode || null,
          customerId: customer,
          receivedAt: nowIso(),
          receiverCode: ME,
          note: p.note || null,
          replacement: !!p.replacement,
        }
        db.grns.unshift(grn)
        const used = new Set(db.lpns.filter((l) => l.status === 'active').map((l) => l.locationCode))
        p.lines.forEach((line, i) => {
          const part = db.master.parts.find((x) => x.partNo === line.partNo)
          const type = part?.type ?? null
          const needs = !!type && (model?.requiresInspection ?? true) && db.settings.qiPartTypes.includes(type)
          const rule = db.master.rules.find((r) => r.customerId === customer && r.partType === type) ?? db.master.rules.find((r) => r.customerId === customer && r.partType === null)
          const zoneId = line.zoneId || rule?.zoneId
          const home =
            db.master.locations.find((l) => l.zoneId === zoneId && l.active && (l.kind === 'bin' || l.kind === 'floor') && !used.has(l.code))?.code ??
            (line.zoneId ? zoneCodeOf(db.master.locations.find((l) => l.zoneId === line.zoneId)?.code ?? line.zoneId) : 'RCV-01')
          used.add(home)
          const gl: GrnLine = {
            id: uid(),
            grnId: grn.id,
            lineNo: i + 1,
            partNo: line.partNo,
            description: line.description,
            partType: type,
            plQty: line.plQty,
            countedQty: line.countedQty,
            invoiceQty: invoice?.lines.find((l) => l.partNo === line.partNo)?.qty ?? null,
            needsQi: needs,
            homeLocation: home,
          }
          db.grnLines.push(gl)
          if (line.countedQty > 0) {
            const lpn: Lpn = { id: uid(), lpnNo: nextDoc('LPN'), grnId: grn.id, locationCode: needs ? 'MI3-QC' : 'RCV-01', hold: needs, status: 'active', createdAt: nowIso(), items: [] }
            lpn.items.push({ id: uid(), lpnId: lpn.id, grnLineId: gl.id, partNo: line.partNo, qty: line.countedQty })
            db.lpns.push(lpn)
            log({ kind: 'RECEIVE', docNo: grn.grnNo, lpnId: lpn.id, lpnNo: lpn.lpnNo, partNo: line.partNo, qty: line.countedQty, toLoc: lpn.locationCode, ref: grn.plRef })
          }
        })
        return { grnId: grn.id, grnNo: grn.grnNo }
      }),

    uploadDoc: async () => null,
    attachImages: async () => undefined,
    listGrns: async (limit = 30) => clone(db.grns.slice(0, limit)),

    async grnDetail(grnId) {
      const grn = db.grns.find((g) => g.id === grnId)
      if (!grn) return null
      return clone({
        grn,
        lines: db.grnLines.filter((l) => l.grnId === grnId).sort((a, b) => a.lineNo - b.lineNo),
        lpns: db.lpns.filter((l) => l.grnId === grnId && l.status !== 'merged' && l.status !== 'void').sort((a, b) => a.lpnNo.localeCompare(b.lpnNo)),
      })
    },

    findGrnId: async (grnNo) => db.grns.find((g) => g.grnNo === grnNo.trim().toUpperCase())?.id ?? null,

    mergeLpns: (ids, location) =>
      commit(() => {
        if (ids.length < 2) fail('เลือกอย่างน้อย 2 ป้ายเพื่อรวม')
        const src = ids.map(lpnById)
        if (src.some((l) => l.status !== 'active')) fail('มีป้ายที่ถูกรวมหรือใช้หมดไปแล้ว')
        const lpn: Lpn = {
          id: uid(),
          lpnNo: nextDoc('LPN'),
          grnId: src[0].grnId,
          locationCode: location ?? src[0].locationCode,
          hold: src.some((l) => l.hold),
          status: 'active',
          createdAt: nowIso(),
          items: src.flatMap((l) => l.items),
        }
        lpn.items.forEach((i) => {
          i.prevLpnId = i.lpnId
          i.lpnId = lpn.id
        })
        src.forEach((l) => {
          l.status = 'merged'
          l.items = []
        })
        db.lpns.push(lpn)
        log({ kind: 'MERGE', docNo: lpn.lpnNo, lpnId: lpn.id, lpnNo: lpn.lpnNo, toLoc: lpn.locationCode, ref: src.map((l) => l.lpnNo).join(', ') })
        return { lpnId: lpn.id, lpnNo: lpn.lpnNo }
      }),

    unmergeLpn: (lpnId) =>
      commit(() => {
        const box = lpnById(lpnId)
        if (box.status !== 'active') fail('ป้ายนี้ใช้งานไม่ได้แล้ว (อาจถูกรวมต่อ ใช้หมด หรือยกเลิกไปแล้ว)')
        const src = db.lpns.filter((l) => l.status === 'merged' && box.items.some((i) => i.prevLpnId === l.id))
        if (!src.length) fail('กล่องนี้ไม่ได้เกิดจากการรวม · ถ้าจะแบ่งของใช้ "แยกกล่อง"')
        if (db.tx.some((t) => t.kind !== 'MERGE' && (t.lpnId === lpnId || box.items.some((i) => i.id === t.lpnItemId))))
          fail('กล่องนี้มีการเคลื่อนไหวหลังรวมแล้ว (ย้าย/เบิก/แก้ยอด/ตรวจ/แยก) ยกเลิกการรวมไม่ได้ · ใช้ "แยกกล่อง" แทน')
        if (box.items.some((i) => !src.some((l) => l.id === i.prevLpnId))) fail('ไม่พบข้อมูลป้ายเดิมของบางรายการ · ใช้ "แยกกล่อง" แทน')
        for (const l of src) {
          l.items = box.items.filter((i) => i.prevLpnId === l.id)
          l.items.forEach((i) => {
            i.lpnId = l.id
            i.prevLpnId = null
          })
          l.status = 'active'
        }
        box.items = []
        box.status = 'void'
        const lpnNos = src.map((l) => l.lpnNo).sort().join(', ')
        log({ kind: 'UNMERGE', docNo: box.lpnNo, lpnId, lpnNo: box.lpnNo, fromLoc: box.locationCode, ref: lpnNos })
        return { lpnNos }
      }),

    splitLpn: (lpnId, picks) =>
      commit(() => {
        const box = lpnById(lpnId)
        if (box.status !== 'active') fail('ไม่พบป้าย หรือป้ายนี้ใช้งานไม่ได้แล้ว')
        const lpn: Lpn = { id: uid(), lpnNo: nextDoc('LPN'), grnId: box.grnId, locationCode: box.locationCode, hold: box.hold, status: 'active', createdAt: nowIso(), items: [] }
        for (const p of picks) {
          if (!(p.qty > 0)) continue
          const item = box.items.find((i) => i.id === p.itemId) ?? fail('รายการที่เลือกไม่ได้อยู่ในกล่องนี้')
          if (!Number.isInteger(p.qty)) fail('จำนวนต้องเป็นจำนวนเต็ม')
          if (p.qty > item.qty) fail(`${item.partNo} มีในกล่องแค่ ${item.qty} ชิ้น`)
          if (p.qty === item.qty) {
            box.items = box.items.filter((i) => i !== item)
            lpn.items.push({ ...item, lpnId: lpn.id, prevLpnId: null })
          } else {
            item.qty -= p.qty
            lpn.items.push({ id: uid(), lpnId: lpn.id, grnLineId: item.grnLineId, partNo: item.partNo, qty: p.qty })
          }
        }
        if (!lpn.items.length) fail('ใส่จำนวนที่จะแยกออกอย่างน้อย 1 รายการ')
        if (!box.items.some((i) => i.qty > 0)) fail('ต้องเหลือของในกล่องเดิมอย่างน้อย 1 รายการ · ถ้าจะย้ายทั้งกล่องใช้ "ย้ายที่" ในแท็บสแกน')
        if (box.hold) {
          const held = (l: Lpn) => l.items.some((i) => i.qty > 0 && db.grnLines.find((g) => g.id === i.grnLineId)?.needsQi)
          box.hold = held(box)
          lpn.hold = held(lpn)
        }
        db.lpns.push(lpn)
        log({ kind: 'SPLIT', docNo: lpn.lpnNo, lpnId, lpnNo: box.lpnNo, fromLoc: box.locationCode, toLoc: box.locationCode, ref: lpn.items.map((i) => `${i.partNo} ${i.qty}`).join(', ') })
        return { lpnId: lpn.id, lpnNo: lpn.lpnNo }
      }),

    async findLpn(no) {
      const lpn = db.lpns.find((l) => l.lpnNo === no.trim().toUpperCase())
      if (!lpn) return null
      const grn = db.grns.find((g) => g.id === lpn.grnId) ?? null
      const home = db.grnLines.find((g) => g.id === lpn.items[0]?.grnLineId)?.homeLocation ?? null
      return clone({ lpn: lpnOf(lpn), grn, homeLocation: home })
    },

    scanMove: (lpnId, to, kind) =>
      commit(() => {
        const lpn = lpnById(lpnId)
        const dest = to.trim().toUpperCase()
        if (lpn.status !== 'active') fail('ไม่พบป้าย หรือป้ายนี้ใช้หมดแล้ว')
        if (!dest) fail('เลือกช่องปลายทาง')
        if (dest === lpn.locationCode) fail('กล่องอยู่ที่ช่องนี้แล้ว')
        log({ kind, lpnId, lpnNo: lpn.lpnNo, fromLoc: lpn.locationCode, toLoc: dest })
        lpn.locationCode = dest
      }),

    scanIssue: (itemId, qty, ref, note) =>
      commit(() => {
        const { lpn, item } = itemById(itemId)
        if (lpn.status !== 'active') fail('ไม่พบป้าย หรือป้ายนี้ใช้หมดแล้ว')
        if (lpn.hold) fail('เบิกไม่ได้ · กล่องนี้ยังไม่ผ่านการตรวจ MI3')
        if (!(qty > 0)) fail('ใส่จำนวนที่เบิก')
        if (qty > item.qty) fail(`เบิกได้ไม่เกิน ${item.qty} ชิ้น`)
        const doc = nextDoc('GI')
        item.qty -= qty
        log({ kind: 'ISSUE', docNo: doc, lpnId: lpn.id, lpnNo: lpn.lpnNo, lpnItemId: itemId, partNo: item.partNo, qty, fromLoc: lpn.locationCode, toLoc: note || null, ref: ref || null })
        if (lpn.items.every((i) => i.qty <= 0)) lpn.status = 'empty'
        return doc
      }),

    scanAdjustRequest: (itemId, newQty, reason) =>
      commit(() => {
        const { lpn, item } = itemById(itemId)
        if (!(newQty >= 0)) fail('ใส่ยอดที่ถูกต้อง')
        if (!reason.trim()) fail('ระบุเหตุผลก่อนส่ง')
        if (newQty === item.qty) fail('ยอดเท่าเดิม ไม่ต้องแก้ไข')
        if (db.tx.some((t) => t.lpnItemId === itemId && t.kind === 'ADJ' && t.status === 'pending')) fail('มีคำขอแก้ไขยอดของรายการนี้รออนุมัติอยู่แล้ว')
        const doc = nextDoc('ADJ')
        log({ kind: 'ADJ', docNo: doc, lpnId: lpn.id, lpnNo: lpn.lpnNo, lpnItemId: itemId, partNo: item.partNo, qty: item.qty, newQty, reason, status: 'pending', createdCode: 'DEMO-REQ' })
        return doc
      }),

    scanAdjustDecide: (txId, approve) =>
      commit(() => {
        const t = db.tx.find((x) => x.id === txId)
        if (!t || t.status !== 'pending') fail('รายการนี้ถูกพิจารณาไปแล้ว')
        if (approve) {
          const { lpn, item } = itemById(t!.lpnItemId!)
          item.qty = t!.newQty ?? item.qty
          if (lpn.status !== 'merged') lpn.status = lpn.items.some((i) => i.qty > 0) ? 'active' : 'empty'
        }
        t!.status = approve ? 'approved' : 'rejected'
        t!.decidedCode = ME
      }),

    scanCount: (lpnId, counted) =>
      commit(() => {
        const lpn = lpnById(lpnId)
        if (!(counted >= 0)) fail('ใส่จำนวนที่นับได้')
        const sys = lpn.items.reduce((s, i) => s + i.qty, 0)
        log({ kind: 'COUNT', lpnId, lpnNo: lpn.lpnNo, qty: sys, newQty: counted })
        return counted - sys
      }),

    scanQi: (lpnId, pass, ng, note) =>
      commit(() => {
        const lpn = lpnById(lpnId)
        if (lpn.status !== 'active') fail('ไม่พบป้าย')
        if (!lpn.hold) fail('กล่องนี้ไม่ต้องตรวจ หรือผ่านการตรวจแล้ว')
        if (lpn.items.length !== 1) fail('บันทึกผลตรวจได้ทีละ part · แยกกล่องก่อน')
        const item = lpn.items[0]
        if (pass < 0 || ng < 0 || pass + ng !== item.qty) fail(`ผ่าน + NG ต้องเท่ากับ ${item.qty} ชิ้น`)
        const doc = nextDoc('QI')
        log({ kind: 'QI', docNo: doc, lpnId, lpnNo: lpn.lpnNo, lpnItemId: item.id, partNo: item.partNo, qty: item.qty, passQty: pass, ngQty: ng, reason: note || null })
        item.qty = pass
        lpn.hold = false
        lpn.status = pass > 0 ? 'active' : 'empty'
        return doc
      }),

    recentTx: async (limit = 30, lpnId) => clone(db.tx.filter((t) => !lpnId || t.lpnId === lpnId).slice(0, limit)),
    pendingAdjustments: async () => clone(db.tx.filter((t) => t.kind === 'ADJ' && t.status === 'pending')),
    activeLpns: async () => clone(db.lpns.filter((l) => l.status === 'active')),

    async invoiceView(query) {
      const q = query.trim()
      const pl = db.grns.find((g) => g.plRef === q)
      const inv = db.invoices.find((i) => i.invoiceNo === q || i.poNo === q || (pl && i.id === pl.invoiceId))
      if (!inv) return null
      const grns = db.grns.filter((g) => g.invoiceId === inv.id).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      const received = new Map<string, number>()
      for (const l of db.grnLines) if (grns.some((g) => g.id === l.grnId)) received.set(l.partNo, (received.get(l.partNo) ?? 0) + l.countedQty)
      const { lines, ...invoice } = inv
      return clone({ invoice, lines, grns, received: [...received].map(([partNo, qty]) => ({ partNo, qty })) })
    },

    invoiceSetStatus: (id, status: InvoiceStatus, note) =>
      commit(() => {
        const inv = db.invoices.find((i) => i.id === id) ?? fail('ไม่พบ Invoice')
        inv.status = status
        inv.statusNote = note || null
        inv.statusAt = nowIso()
      }),

    listInvoices: async (limit = 30) => db.invoices.slice(0, limit).map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, status: i.status, createdAt: i.createdAt })),

    permissionRows: async () => clone(db.perms),
    setPermission: (role, perm, allowed) =>
      commit(() => {
        const row = db.perms.find((p) => p.role === role && p.perm === perm)
        if (row) row.allowed = allowed
        else db.perms.push({ role, perm, allowed })
      }),
    staffDirectory: async () => clone(db.staff),
    setZoneHead: (zoneId, staffId) =>
      commit(() => {
        db.master.zoneHeads = db.master.zoneHeads.filter((h) => h.zoneId !== zoneId)
        const s = db.staff.find((x) => x.id === staffId)
        if (s) db.master.zoneHeads.push({ zoneId, staffId: s.id, employeeCode: s.employeeCode, fullName: s.fullName } satisfies ZoneHead)
      }),
    setSetting: (key, value) =>
      commit(() => {
        if (key === 'wms_mode') db.settings.mode = value === 'live' ? 'live' : 'trial'
        else db.settings.qiPartTypes = value as string[]
      }),
    newTrialRound: () =>
      commit(() => {
        // สาธิต: ข้อมูลทดลองถูกซ่อนด้วยการเริ่มชุดใหม่ (ฐานข้อมูลจริงเก็บรอบเก่าไว้)
        db = { ...db, invoices: [], grns: [], grnLines: [], lpns: [], tx: [], settings: { ...db.settings, trialRound: db.settings.trialRound + 1 } }
        return db.settings.trialRound
      }),
    upsertPart: (p) =>
      commit(() => {
        if (!p.partNo.trim() || !p.name.trim()) fail('ต้องมี Part No. และชื่อ')
        const partNo = canonPartNo(db.master.parts, p.partNo)
        const i = db.master.parts.findIndex((x) => x.partNo === partNo)
        const prev = i >= 0 ? db.master.parts[i] : null
        const uam = p.uamCode?.trim() || null
        if (uam && db.master.parts.some((x) => x.uamCode === uam && x.partNo !== partNo)) fail(`รหัส UAM ${uam} ใช้กับ part อื่นแล้ว`)
        const next = {
          ...p,
          partNo,
          revision: (!partNo.includes('/') && partRevision(p.partNo)) || prev?.revision || null,
          type: p.type?.trim().toUpperCase() || null,
          uamCode: uam,
          models: [...new Set([...(prev?.models ?? []), ...p.models])],
        }
        if (i >= 0) db.master.parts[i] = next
        else db.master.parts.push(next)
      }),
    upsertLocation: (l) =>
      commit(() => {
        const code = l.code.trim().toUpperCase()
        if (!code) fail('ต้องมีรหัสช่อง')
        const i = db.master.locations.findIndex((x) => x.code === code)
        if (i >= 0) db.master.locations[i] = { ...l, code }
        else db.master.locations.push({ ...l, code })
      }),
    setZoneRule: (r) =>
      commit(() => {
        const type = r.partType?.trim().toUpperCase() || null
        const i = db.master.rules.findIndex((x) => x.customerId === r.customerId && x.partType === type)
        if (i >= 0) db.master.rules[i] = { ...r, partType: type }
        else db.master.rules.push({ ...r, partType: type })
      }),
    saveFg: (fg) =>
      commit(() => {
        const code = fg.code.trim().toUpperCase()
        if (!code || !fg.name.trim()) fail('ต้องมีรหัสและชื่อชุดวงล้อ')
        const next = { ...fg, code, name: fg.name.trim(), lines: fg.lines.filter((l) => l.qtyPer > 0).map((l) => ({ ...l, partNo: canonPartNo(db.master.parts, l.partNo) })) }
        const i = db.master.fgItems.findIndex((x) => x.code === code)
        if (i >= 0) db.master.fgItems[i] = next
        else db.master.fgItems.push(next)
      }),
    postRequisition: (p) =>
      commit(() => {
        assertOpen(p.modelCode, p.docDate || today())
        const lines = p.lines.filter((l) => l.qty > 0)
        if (!lines.length) fail('ไม่มีรายการที่จะเบิก')
        const reqNo = nextDoc('RQ')
        const req: Requisition = {
          id: uid(),
          kind: p.kind,
          reqNo,
          docNo: p.docNo?.trim() || null,
          docDate: p.docDate || today(),
          modelCode: p.modelCode || null,
          fgCode: p.fgCode || null,
          fgQty: p.fgQty ?? null,
          fromDept: p.fromDept || null,
          toDept: p.toDept || null,
          note: p.note || null,
          status: 'posted',
          reconciledBy: null,
          createdCode: ME,
          createdAt: nowIso(),
          lines: [],
        }
        db.requisitions.unshift(req)
        for (const l of lines) {
          issueFifo(req.id, reqNo, req.docNo ?? reqNo, l.partNo, l.qty)
          req.lines.push({ partNo: l.partNo, reqQty: l.reqQty ?? null, qty: l.qty, balance: onHand(l.partNo) })
        }
        return { id: req.id, reqNo }
      }),
    reconcileFm005: (p) =>
      commit(() => {
        const docNo = p.docNo.trim()
        if (!docNo) fail('ใส่เลขที่ FM-P-005')
        if (!p.docDate || !p.modelCode) fail('ใส่วันที่และ Model')
        assertOpen(p.modelCode, p.docDate)
        if (db.requisitions.some((r) => r.kind === 'fm005' && r.docNo === docNo && r.status === 'posted')) fail(`FM-P-005 เลขที่ ${docNo} บันทึกไปแล้ว`)
        const subs = db.requisitions.filter((r) => r.kind === 'line' && r.status === 'posted' && !r.reconciledBy && r.docDate === p.docDate && r.modelCode === p.modelCode)
        const subIds = subs.map((r) => r.id)
        const reqNo = nextDoc('RQ')
        const fm: Requisition = {
          id: uid(),
          kind: 'fm005',
          reqNo,
          docNo,
          docDate: p.docDate,
          modelCode: p.modelCode,
          fgCode: p.fgCode || null,
          fgQty: p.fgQty ?? null,
          fromDept: p.fromDept || null,
          toDept: p.toDept || null,
          note: p.note || null,
          status: 'posted',
          reconciledBy: null,
          createdCode: ME,
          createdAt: nowIso(),
          lines: [],
        }
        db.requisitions.unshift(fm)
        const fmQty = new Map<string, number>()
        for (const l of p.lines) fmQty.set(l.partNo, (fmQty.get(l.partNo) ?? 0) + (l.qty || 0))
        const subQty = new Map<string, number>()
        for (const r of subs) for (const l of r.lines) subQty.set(l.partNo, (subQty.get(l.partNo) ?? 0) + l.qty)
        for (const part of [...new Set([...fmQty.keys(), ...subQty.keys()])].sort()) {
          const f = fmQty.get(part) ?? 0
          const sub = subQty.get(part) ?? 0
          if (f > sub) issueFifo(fm.id, reqNo, docNo, part, f - sub)
          else if (f < sub) returnLifo(fm.id, subIds, reqNo, docNo, part, sub - f)
          fm.lines.push({ partNo: part, reqQty: sub, qty: f, balance: onHand(part) })
        }
        for (const r of subs) r.reconciledBy = fm.id
        return { id: fm.id, reqNo, subs: subs.length }
      }),
    voidRequisition: (id, reason) =>
      commit(() => {
        const r = db.requisitions.find((x) => x.id === id)
        if (!r || r.status !== 'posted') fail('ไม่พบใบเบิก หรือยกเลิกไปแล้ว')
        if (r!.kind === 'fm005') fail('ยกเลิก FM-P-005 ไม่ได้ · แจ้งผู้ดูแลระบบ')
        if (r!.reconciledBy) fail('ใบนี้กระทบยอดกับ FM-P-005 แล้ว ยกเลิกไม่ได้')
        if (!reason.trim()) fail('ระบุเหตุผลที่ยกเลิก')
        assertOpen(r!.modelCode, r!.docDate)
        for (const t of db.tx.filter((x) => x.kind === 'ISSUE' && x.requisitionId === id)) putBack(t, t.qty ?? 0, r!.reqNo, t.ref, id, `ยกเลิกใบเบิก: ${reason.trim()}`)
        r!.status = 'void'
        r!.note = [r!.note, `ยกเลิก: ${reason.trim()}`].filter(Boolean).join(' · ')
      }),
    listRequisitions: async (from, to) => clone(db.requisitions.filter((r) => r.docDate >= from && r.docDate <= to)),
    ledgerRows: async (parts, to) => {
      const want = new Set(parts)
      const reqs = new Map(db.requisitions.map((r) => [r.id, r]))
      const rows: LedgerRow[] = []
      for (const t of [...db.tx].reverse()) {
        if (!t.partNo || !want.has(t.partNo) || t.createdAt >= to) continue
        const ok = ['RECEIVE', 'ISSUE', 'RETURN'].includes(t.kind) || (t.kind === 'QI' && (t.ngQty ?? 0) > 0) || (t.kind === 'ADJ' && t.status === 'approved')
        if (!ok) continue
        const lpn = db.lpns.find((l) => l.id === t.lpnId)
        const grn = db.grns.find((g) => g.id === lpn?.grnId)
        const inv = db.invoices.find((i) => i.id === grn?.invoiceId)
        const req = reqs.get(t.requisitionId ?? '')
        const reqCol = req?.kind === 'qc' ? 'qc' : req?.kind === 'ng' ? 'ng' : 'issue'
        rows.push({
          at: t.createdAt,
          partNo: t.partNo,
          kind: t.kind,
          col: t.kind === 'RECEIVE' ? (grn?.replacement ? 'recv_rep' : 'recv') : t.kind === 'ISSUE' || t.kind === 'RETURN' ? reqCol : t.kind === 'QI' ? 'ng' : 'adj',
          qty: t.kind === 'RETURN' ? -(t.qty ?? 0) : t.kind === 'QI' ? (t.ngQty ?? 0) : t.kind === 'ADJ' ? (t.newQty ?? 0) - (t.qty ?? 0) : (t.qty ?? 0),
          invNo: t.kind === 'RECEIVE' ? (inv?.invoiceNo ?? null) : null,
          orderNo: t.kind === 'RECEIVE' ? (inv?.poNo ?? null) : null,
          orderDate: t.kind === 'RECEIVE' ? (inv?.docDate ?? null) : null,
          docNo: t.kind === 'ISSUE' || t.kind === 'RETURN' ? (req?.docNo ?? req?.reqNo ?? t.ref ?? t.docNo) : t.kind === 'RECEIVE' ? (grn?.grnNo ?? null) : t.docNo,
          lot: grn?.grnNo ?? null,
          note: t.reason ?? (req?.kind === 'fm005' ? 'กระทบยอด FM-P-005' : null),
        })
      }
      return rows
    },
    // สาธิต: ผังเก็บในเครื่อง (useLayoutEdits) — ที่นี่ปรับเฉพาะช่องเก็บให้ตรงกับผัง (กติกาเดียวกับ layout_save)
    listClosings: async () => clone(db.closings),
    closeMonth: async (model, month, note) => {
      if (month >= today().slice(0, 7)) fail(`ปิดยอดได้เมื่อจบเดือน ${month} แล้ว`)
      const prev = db.closings.find((c) => c.modelCode === model && c.month === month)
      if (prev?.status === 'closed') fail(`${model} เดือน ${month} ปิดยอดไปแล้ว`)
      const parts = partsOfModel(db.master, model)
      const sheets = buildLedger(await api.ledgerRows(parts.map((p) => p.partNo), monthRange(month).to), parts, month)
      const totals = sheets.map((x) => ({ partNo: x.partNo, opening: x.opening, in: x.totalIn, out: x.totalOut, closing: x.closing }))
      const next: StockClosing = {
        id: prev?.id ?? uid(),
        modelCode: model,
        month,
        status: 'closed',
        totals,
        closedBy: `ผู้ใช้สาธิต (${ME})`,
        closedAt: nowIso(),
        planningBy: null,
        planningAt: null,
        accountBy: null,
        accountAt: null,
        note: note?.trim() || null,
      }
      db.closings = [next, ...db.closings.filter((c) => c.id !== next.id)]
      save()
    },
    reopenMonth: (id, reason) =>
      commit(() => {
        const c = db.closings.find((x) => x.id === id && x.status === 'closed')
        if (!c) fail('ไม่พบรายการปิดยอด')
        if (!reason.trim()) fail('ระบุเหตุผลที่เปิดเดือน')
        c!.status = 'reopened'
        c!.note = [c!.note, `เปิดเดือน: ${reason.trim()} โดย ผู้ใช้สาธิต`].filter(Boolean).join(' · ')
      }),
    ackClosing: (id, side) =>
      commit(() => {
        const c = db.closings.find((x) => x.id === id && x.status === 'closed')
        if (!c || (side === 'planning' ? c.planningAt : c.accountAt)) fail('ไม่พบรายการ หรือรับทราบไปแล้ว')
        if (side === 'planning') Object.assign(c!, { planningBy: `ผู้ใช้สาธิต (${ME})`, planningAt: nowIso() })
        else Object.assign(c!, { accountBy: `ผู้ใช้สาธิต (${ME})`, accountAt: nowIso() })
      }),
    saveLayout: (p) =>
      commit(() => {
        const busy = (codes: (code: string) => boolean) => db.lpns.filter((l) => l.status === 'active' && codes(l.locationCode)).map((l) => l.lpnNo)
        for (const id of p.removed) {
          const codes = new Set(db.master.locations.filter((l) => l.zoneId === id).map((l) => l.code))
          const lpns = busy((c) => codes.has(c))
          if (lpns.length) fail(`โซน ${id} ยังมีของ (${lpns.slice(0, 5).join(', ')}) — ย้ายของออกก่อนลบ`)
          db.master.locations = db.master.locations.filter((l) => l.zoneId !== id)
        }
        for (const z of p.locations) {
          const want = new Set(z.codes)
          const dropped = db.master.locations.filter((l) => l.zoneId === z.zoneId && l.active && !want.has(l.code)).map((l) => l.code)
          const lpns = busy((c) => dropped.includes(c))
          if (lpns.length) fail(`ช่องที่จะปิดยังมีของ (${lpns.slice(0, 5).join(', ')}) — ย้ายของออกก่อน`)
          db.master.locations = db.master.locations
            .map((l) => (l.zoneId === z.zoneId && !want.has(l.code) ? { ...l, active: false } : l))
            .filter((l) => !want.has(l.code))
            .concat(z.codes.map((code) => ({ code, zoneId: z.zoneId, kind: z.kind, active: true })))
        }
      }),
  }
  return api
}
