import { addDays, bangkokDay } from './ledger'
import { fmt } from './logic'
import { workQueues, type WorkBox, type WorkQueues } from './myWork'
import type { Grn, Lpn, ReceiptCheck, Requisition, StockClosing, StorageLoc } from './types'

/** ผังขั้นตอนงานคลัง: รับเข้า → จัดเก็บ → จ่ายออก & ปิดยอด · แต่ละขั้นมีตัวเลขสดและพาไปทำงานนั้น */
export type FlowKey = 'check' | 'grn' | 'qi' | 'put' | 'stock' | 'ng' | 'issue' | 'fm005' | 'close'
export type FlowGroup = 'in' | 'store' | 'out'
/** idle = ไม่มีอะไร · ok = ปกติ · todo = มีงานรอ · late = มีงานค้างนาน */
export type FlowState = 'idle' | 'ok' | 'todo' | 'late'

export interface FlowStage {
  key: FlowKey
  group: FlowGroup
  step: number
  title: string
  /** null = ไม่มีข้อมูล (โหลดไม่ได้) */
  value: number | null
  unit: string
  detail: string
  state: FlowState
  /** ขั้นนี้คืออะไร ใครทำ (สอนงาน) */
  hint: string
}

export const FLOW_GROUPS: Record<FlowGroup, string> = { in: 'รับเข้า', store: 'จัดเก็บ', out: 'จ่ายออก & ปิดยอด' }

/** กล่องค้างเกินกี่วันถือว่าช้า (เท่ากับป้ายวันในหน้างานวันนี้) */
export const LATE_DAYS = 2
/** ดูใบเบิกย้อนหลังกี่วัน (หาใบย่อยที่ยังไม่กระทบ FM-P-005) */
export const FM005_WINDOW = 7
/** ต้นเดือน: เตือนปิดยอดเดือนก่อนถึงวันที่เท่านี้ · เลยวันที่ CLOSE_LATE_DAY ถือว่าช้า */
export const CLOSE_REMIND_DAYS = 10
export const CLOSE_LATE_DAY = 5

export interface FlowInput {
  today: string
  lpns: Lpn[]
  locations: StorageLoc[]
  checks: ReceiptCheck[] | null
  grns: Grn[] | null
  /** ใบเบิกตั้งแต่ FM005_WINDOW − 1 วันก่อนถึงวันนี้ */
  reqs: Requisition[] | null
  closings: StockClosing[] | null
  /** งานในคิวพิมพ์ (null = ไม่มีสิทธิ์พิมพ์) */
  printQueued: number | null
}

const pieces = (boxes: WorkBox[]) => boxes.reduce((s, b) => s + b.qty, 0)
const boxState = (boxes: WorkBox[]): FlowState => (!boxes.length ? 'idle' : boxes.some((b) => b.days > LATE_DAYS) ? 'late' : 'todo')
const boxDetail = (boxes: WorkBox[], none: string) => {
  if (!boxes.length) return none
  const late = boxes.filter((b) => b.days > LATE_DAYS).length
  return `${fmt(pieces(boxes))} ชิ้น${late ? ` · ค้างเกิน ${LATE_DAYS} วัน ${fmt(late)} กล่อง` : ''}`
}

/** ใบย่อยเข้าไลน์ที่ยังไม่กระทบ FM-P-005 จัดกลุ่มตามวัน + Model (1 กลุ่ม = FM-P-005 1 ใบ) */
export function unreconciled(reqs: Requisition[]) {
  const groups = new Map<string, { day: string; model: string | null; reqs: number }>()
  for (const r of reqs) {
    if (r.kind !== 'line' || r.status !== 'posted' || r.reconciledBy) continue
    const k = `${r.docDate}|${r.modelCode ?? ''}`
    const g = groups.get(k) ?? { day: r.docDate, model: r.modelCode, reqs: 0 }
    g.reqs++
    groups.set(k, g)
  }
  return [...groups.values()].sort((a, b) => a.day.localeCompare(b.day) || (a.model ?? '').localeCompare(b.model ?? ''))
}

/** ปิดยอดที่ Planning หรือบัญชียังไม่รับทราบ */
export const waitingAck = (closings: StockClosing[]) => closings.filter((c) => c.status === 'closed' && (!c.planningAt || !c.accountAt))

export function flowStages(i: FlowInput, q: WorkQueues = workQueues(i.lpns, i.locations, i.today)): FlowStage[] {
  const kind = new Map(i.locations.map((l) => [l.code, l.kind]))
  const stored = i.lpns.filter((l) => {
    const k = kind.get(l.locationCode)
    return l.status === 'active' && !l.hold && k !== 'staging' && k !== 'hold' && k !== 'ng' && l.items.some((it) => it.qty > 0)
  })
  const storedQty = stored.reduce((s, l) => s + l.items.reduce((t, it) => t + it.qty, 0), 0)
  const storedParts = new Set(stored.flatMap((l) => l.items.filter((it) => it.qty > 0).map((it) => it.partNo))).size

  const open = i.checks?.filter((c) => c.status === 'open') ?? null
  const lateChecks = open?.filter((c) => bangkokDay(c.createdAt) < i.today).length ?? 0
  const checkedLines = open?.reduce((s, c) => s + c.checkedCount, 0) ?? 0
  const allLines = open?.reduce((s, c) => s + c.lineCount, 0) ?? 0

  // ใบรับวันนี้ (ไม่นับเอกสารกล่องใหม่จากการตรวจนับ CNT- และใบที่ยกเลิก)
  const grnsToday = i.grns?.filter((g) => g.status !== 'void' && !g.grnNo.startsWith('CNT-') && bangkokDay(g.receivedAt) === i.today) ?? null
  const todayIds = new Set(grnsToday?.map((g) => g.id))
  const boxesToday = i.lpns.filter((l) => l.grnId && todayIds.has(l.grnId)).length

  const posted = i.reqs?.filter((r) => r.status === 'posted') ?? null
  const issuedToday = posted?.filter((r) => r.docDate === i.today && r.kind !== 'fm005') ?? null
  const issuedQty = issuedToday?.reduce((s, r) => s + r.lines.reduce((t, l) => t + l.qty, 0), 0) ?? 0
  const byKind = (k: Requisition['kind']) => issuedToday?.filter((r) => r.kind === k).length ?? 0
  const pending = posted ? unreconciled(posted) : null
  const pendingLate = pending?.filter((g) => g.day < i.today).length ?? 0
  const acks = i.closings ? waitingAck(i.closings) : null
  const lastClosed = i.closings
    ?.filter((c) => c.status === 'closed')
    .map((c) => c.month)
    .sort()
    .at(-1)
  // ต้นเดือน: Model ที่มีของในคลังแต่ยังไม่ปิดยอดเดือนก่อน
  const day = Number(i.today.slice(8, 10))
  const prevMonth = addDays(`${i.today.slice(0, 7)}-01`, -1).slice(0, 7)
  const stocked = [...new Set(i.lpns.filter((l) => l.status === 'active' && l.modelCode).map((l) => l.modelCode!))]
  const notClosed =
    i.closings && day <= CLOSE_REMIND_DAYS ? stocked.filter((m) => !i.closings!.some((c) => c.modelCode === m && c.month === prevMonth && c.status === 'closed')).sort() : []
  const closeTodo = acks ? acks.length + notClosed.length : null

  return [
    {
      key: 'check',
      group: 'in',
      step: 1,
      title: 'ตรวจรับตาม PL',
      value: open?.length ?? null,
      unit: 'ใบ',
      detail: !open ? 'โหลดไม่ได้' : open.length ? `ตรวจแล้ว ${fmt(checkedLines)}/${fmt(allLines)} บรรทัด${lateChecks ? ` · ค้างจากวันก่อน ${lateChecks} ใบ` : ''}` : 'ไม่มีใบค้าง',
      state: !open?.length ? 'idle' : lateChecks ? 'late' : 'todo',
      hint: 'คลังถ่าย Packing List ให้ระบบอ่าน แล้วตรวจของทีละเคสบนมือถือ (หลายคนช่วยกันได้) · ครบแล้วกดออก GRN',
    },
    {
      key: 'grn',
      group: 'in',
      step: 2,
      title: 'ออก GRN & ป้าย QR',
      value: grnsToday?.length ?? null,
      unit: 'ใบวันนี้',
      detail: !grnsToday ? 'โหลดไม่ได้' : `${fmt(boxesToday)} กล่องใหม่${i.printQueued ? ` · คิวพิมพ์ ${fmt(i.printQueued)}` : ''}`,
      state: i.printQueued ? 'todo' : grnsToday?.length ? 'ok' : 'idle',
      hint: 'ออก GRN แล้วระบบสร้างกล่อง (1 เคส = 1 กล่อง) พร้อมป้าย QR · มือถือส่งงานพิมพ์มาที่คอมจุดพิมพ์ได้',
    },
    {
      key: 'qi',
      group: 'in',
      step: 3,
      title: 'รอตรวจ MI3',
      value: q.qi.length,
      unit: 'กล่อง',
      detail: boxDetail(q.qi, 'ไม่มีกล่องรอตรวจ'),
      state: boxState(q.qi),
      hint: 'part ที่ต้องตรวจถูกกักไว้ (ยังเบิกไม่ได้) · MI3 สแกนกล่องแล้วบันทึกจำนวนดี / NG',
    },
    {
      key: 'put',
      group: 'store',
      step: 4,
      title: 'รอจัดเก็บเข้าช่อง',
      value: q.putaway.length,
      unit: 'กล่อง',
      detail: boxDetail(q.putaway, 'จัดเก็บครบแล้ว'),
      state: boxState(q.putaway),
      hint: 'กล่องที่จุดรับของ / จุดตรวจ MI3 · สแกนกล่อง + ป้ายช่อง หรือเลือกหลายกล่องจากรายการแล้วย้ายทีเดียว',
    },
    {
      key: 'stock',
      group: 'store',
      step: 5,
      title: 'ในช่องเก็บ พร้อมเบิก',
      value: stored.length,
      unit: 'กล่อง',
      detail: stored.length ? `${fmt(storedQty)} ชิ้น · ${fmt(storedParts)} part` : 'ยังไม่มีของในช่อง',
      state: stored.length ? 'ok' : 'idle',
      hint: 'ของที่อยู่ในช่องเก็บ เบิกแบบเข้าก่อนออกก่อน (FIFO) · ดูตำแหน่งได้ที่ผังคลัง 2D / 3D',
    },
    {
      key: 'ng',
      group: 'store',
      step: 6,
      title: 'NG รอส่งคืน',
      value: q.ng.length,
      unit: 'กล่อง',
      detail: boxDetail(q.ng, 'ไม่มี NG ค้าง'),
      state: boxState(q.ng),
      hint: 'ของเสียหายที่พบตอนตรวจรับแยกเป็นกล่องในพื้นที่กัก NG เบิกเข้าไลน์ไม่ได้ · ตัดยอดด้วยการเบิก → NG / ส่งคืน (NG จาก MI3 ตัดยอดตอนบันทึกผลตรวจ)',
    },
    {
      key: 'issue',
      group: 'out',
      step: 7,
      title: 'เบิกเข้าไลน์',
      value: issuedToday?.length ?? null,
      unit: 'ใบวันนี้',
      detail: !issuedToday
        ? 'โหลดไม่ได้'
        : issuedToday.length
          ? `${fmt(issuedQty)} ชิ้น · ไลน์ ${byKind('line')} · QC ${byKind('qc')} · NG ${byKind('ng')}`
          : 'ยังไม่มีการเบิกวันนี้',
      state: issuedToday?.length ? 'ok' : 'idle',
      hint: 'สแกนกล่องเบิก หรือบันทึกใบเบิก ระบบตัดจากกล่องที่รับเข้าก่อน · ทุกครั้งเป็นใบเบิก RQ',
    },
    {
      key: 'fm005',
      group: 'out',
      step: 8,
      title: 'กระทบ FM-P-005',
      value: pending?.length ?? null,
      unit: 'ชุดรอกระทบ',
      detail: !pending ? 'โหลดไม่ได้' : pendingLate ? `ค้างจากวันก่อน ${pendingLate} ชุด` : pending.length ? 'รอใบ FM-P-005 ตอนจบวัน' : 'กระทบครบแล้ว',
      state: !pending?.length ? (pending ? 'ok' : 'idle') : pendingLate ? 'late' : 'todo',
      hint: 'จบวัน ธุรการกรอกยอด FM-P-005 (วัน + Model) ระบบเทียบกับใบย่อย ส่วนต่างตัดเพิ่มหรือคืนเข้าสต็อก',
    },
    {
      key: 'close',
      group: 'out',
      step: 9,
      title: 'ปิดยอด FM-P-537',
      value: closeTodo,
      unit: 'งาน',
      detail: !acks
        ? 'โหลดไม่ได้'
        : [
            notClosed.length ? `ยังไม่ปิด ${prevMonth}: ${notClosed.join(', ')}` : lastClosed ? `ปิดล่าสุด ${lastClosed}` : 'ยังไม่เคยปิดยอด',
            acks.length ? `รอรับทราบ ${acks.length}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
      state: notClosed.length && day > CLOSE_LATE_DAY ? 'late' : closeTodo ? 'todo' : lastClosed ? 'ok' : 'idle',
      hint: 'ต้นเดือนหัวหน้าคลังปิดยอดบัญชีคุมของเดือนก่อนทีละ Model · Planning และบัญชีกดรับทราบ',
    },
  ]
}
