import { sampleLayout } from '../data/factoryLayout'
import { MODELS, PARTS, ZONE_RULES } from '../inventory/masterData'
import type { WmsApi } from './api'
import { layoutLocations } from './locations'
import type {
  Grn,
  GrnLine,
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  Lpn,
  MasterData,
  PermRow,
  ReceivePayload,
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
}

const KEY = 'uam-wms-demo-v1'
const ME = 'DEMO'

function seed(): DemoDb {
  return {
    settings: { mode: 'trial', trialRound: 1, qiPartTypes: ['RIM', 'HUB'] },
    counters: {},
    invoices: [],
    grns: [],
    grnLines: [],
    lpns: [],
    tx: [],
    master: {
      parts: PARTS.map((p) => ({ partNo: p.partNo, name: p.description, type: p.type, customerId: p.customerId, models: p.models })),
      models: MODELS.map((m) => ({ code: m.code, customerId: m.customerId, requiresInspection: m.requiresInspection })),
      rules: ZONE_RULES.map((r) => ({ customerId: r.customerId, partType: r.type, zoneId: r.zoneId })),
      locations: layoutLocations(sampleLayout).map((l) => ({ ...l, active: true })),
      zoneHeads: [],
    },
    // ค่าเริ่มต้นเดียวกับ supabase/migrations/0008_wms_receiving.sql
    perms: (
      [
        ['warehouse', ['receive.create', 'label.print', 'scan.put', 'scan.move', 'scan.issue', 'scan.adjust', 'scan.count', 'invoice.report']],
        ['mi3', ['scan.qi', 'scan.move', 'label.print']],
        ['engineer', ['scan.adjust.approve', 'invoice.close', 'invoice.report']],
        ['manager', ['scan.adjust.approve', 'invoice.close', 'invoice.report', 'accesslog.view', 'master.edit']],
      ] as [string, string[]][]
    ).flatMap(([role, perms]) => perms.map((perm) => ({ role, perm, allowed: true }))),
    staff: [{ id: 'demo', employeeCode: ME, fullName: 'ผู้ใช้สาธิต', role: 'admin' }],
  }
}

function load(): DemoDb {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...seed(), ...JSON.parse(raw) }
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

  return {
    kind: 'demo',
    myPermissions: async () => ['*'],
    settings: async () => clone(db.settings),
    master: async () => clone(db.master),

    async findInvoiceNo(no) {
      const inv = db.invoices.find((i) => i.invoiceNo === no.trim())
      return inv ? { id: inv.id, grnCount: db.grns.filter((g) => g.invoiceId === inv.id).length } : null
    },

    createGrn: (p: ReceivePayload) =>
      commit(() => {
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
        }
        db.grns.unshift(grn)
        const used = new Set(db.lpns.filter((l) => l.status === 'active').map((l) => l.locationCode))
        p.lines.forEach((line, i) => {
          const part = db.master.parts.find((x) => x.partNo === line.partNo)
          const type = part?.type ?? null
          const needs = !!type && (model?.requiresInspection ?? true) && db.settings.qiPartTypes.includes(type)
          const rule = db.master.rules.find((r) => r.customerId === customer && r.partType === type) ?? db.master.rules.find((r) => r.customerId === customer && r.partType === null)
          const home =
            db.master.locations.find((l) => l.zoneId === rule?.zoneId && l.active && (l.kind === 'bin' || l.kind === 'floor') && !used.has(l.code))?.code ?? 'RCV-01'
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
        const i = db.master.parts.findIndex((x) => x.partNo === p.partNo.trim())
        const prev = i >= 0 ? db.master.parts[i].models : []
        const next = { ...p, partNo: p.partNo.trim(), type: p.type?.trim().toUpperCase() || null, models: [...new Set([...prev, ...p.models])] }
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
  }
}
