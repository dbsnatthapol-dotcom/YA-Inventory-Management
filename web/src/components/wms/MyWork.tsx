import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../../auth/useAuth'
import { pendingAcks } from '../../wms/closing'
import { CYCLE_REASON, type CyclePlan, type CycleSlot } from '../../wms/cycleCount'
import { fmt } from '../../wms/logic'
import type { WorkBox } from '../../wms/myWork'
import type { ReceiptCheck } from '../../wms/types'
import { useApprovals } from '../../wms/useApprovals'
import { useMyWork } from '../../wms/useMyWork'
import { usePrintQueue } from '../../wms/usePrintQueue'
import { useWms } from '../../wms/useWms'
import type { ScanMode } from './ScanTab'
import { Alert, BigButton, Pill } from './ui'
import type { WmsTab } from './WarehousePage'

interface Props {
  /** เปิดหน้าสแกนที่กล่องนี้ในงานนี้ */
  onScan: (lpnNo: string, mode: ScanMode) => void
  /** จอคอม: เปิดแท็บงานคลัง · มือถือไม่มี (อนุมัติ / Invoice / บัญชีคุม ทำที่จอคอม) */
  onTab?: (tab: WmsTab) => void
  /** เปิดใบตรวจรับที่ค้าง */
  onOpenCheck?: (id: string) => void
  /** เปิดหน้าย้ายของจากรายการ (กล่องที่จุดรับของ) */
  onMove?: () => void
}

const SHOW = 5
const time = (iso: string) => new Date(iso).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
const dayLabel = (day: string) => new Date(`${day}T00:00:00+07:00`).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'long', day: 'numeric', month: 'long' })

/** หน้าแรกของคนหน้างาน: งานที่ค้างอยู่ตอนนี้ตามสิทธิ์ของแต่ละคน · แตะรายการแล้วเริ่มงานได้ทันที */
export function MyWork({ onScan, onTab, onOpenCheck, onMove }: Props) {
  const { api, can, ready } = useWms()
  const { profile } = useAuth()
  const [ver, setVer] = useState(0)
  const work = useMyWork(ver)
  const approvals = useApprovals(ready && can('scan.adjust.approve'), ver)
  const print = usePrintQueue(ready && can('label.print'), ver)
  const desk = !!onTab
  // งานที่ทำที่จอคอม: Invoice ที่ยังไม่ปิด และปิดยอดที่รอรับทราบ
  const [invoices, setInvoices] = useState<{ open: number; reported: number }>({ open: 0, reported: 0 })
  const [acks, setAcks] = useState(0)
  // ใบตรวจรับที่ยังตรวจไม่เสร็จ (ทุกคนช่วยตรวจได้)
  const [checks, setChecks] = useState<ReceiptCheck[]>([])
  useEffect(() => {
    if (!ready || !can('receive.create')) return
    let alive = true
    api
      .listChecks()
      .then((c) => alive && setChecks(c.filter((x) => x.status === 'open')))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [api, ready, can, ver])
  useEffect(() => {
    if (!ready || !desk) return
    let alive = true
    if (can('invoice.close') || can('invoice.report'))
      api
        .listInvoices(100)
        .then((list) => alive && setInvoices({ open: list.filter((i) => i.status === 'open').length, reported: list.filter((i) => i.status === 'discrepancy_reported').length }))
        .catch(() => undefined)
    if (can('ledger.ack.planning') || can('ledger.ack.account'))
      api
        .listClosings()
        .then((c) => alive && setAcks(pendingAcks(c, can).length))
        .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [api, ready, desk, can, ver])

  const q = work.queues
  const sections: { key: string; count: number; node: ReactNode }[] = []
  if (can('receive.create'))
    sections.push({ key: 'checks', count: checks.length, node: <CheckSection checks={checks} onOpen={onOpenCheck} /> })
  if (q && can('scan.qi'))
    sections.push({
      key: 'qi',
      count: q.qi.length,
      node: <BoxSection title="รอตรวจ MI3" hint="บันทึกจำนวนดี / NG แล้วกล่องจะเบิกได้" boxes={q.qi} action="ตรวจ" onPick={(b) => onScan(b.lpnNo, 'QI')} />,
    })
  if (q && can('scan.put'))
    sections.push({
      key: 'put',
      count: q.putaway.length,
      node: (
        <BoxSection
          title="จัดเก็บเข้าช่อง"
          hint="อยู่ที่จุดรับของ / จุดตรวจ MI3 · สแกนกล่องแล้วสแกนป้ายช่อง หรือเลือกหลายกล่องจากรายการ"
          boxes={q.putaway}
          action="จัดเก็บ"
          onPick={(b) => onScan(b.lpnNo, 'PUT')}
          extra={
            onMove && (
              <BigButton tone="secondary" className="self-start" onClick={onMove}>
                เลือกหลายกล่องแล้วย้ายทีเดียว →
              </BigButton>
            )
          }
        />
      ),
    })
  if (can('scan.count'))
    sections.push({ key: 'count', count: work.plan ? work.plan.target - work.plan.done : 0, node: <CycleSection plan={work.plan} onCount={(lpnNo) => onScan(lpnNo, 'COUNT')} /> })
  if (q && can('scan.issue'))
    sections.push({
      key: 'ng',
      count: q.ng.length,
      node: <BoxSection title="NG รอส่งคืน" hint="ตัดยอดด้วยการเบิก → NG / ส่งคืน ตอนส่งของออก" boxes={q.ng} action="เบิก NG" onPick={(b) => onScan(b.lpnNo, 'ISSUE')} />,
    })
  if (can('scan.adjust.approve'))
    sections.push({
      key: 'approve',
      count: approvals.total,
      node: (
        <DeskSection
          title="รออนุมัติปรับยอด"
          count={approvals.total}
          detail={`จากการตรวจนับ ${approvals.adj.length} · ใบตรวจนับ Excel ${approvals.pendingSheets.length} · คนขอกับคนอนุมัติต้องเป็นคนละคน`}
          action="ไปอนุมัติ"
          onGo={onTab && (() => onTab('count'))}
        />
      ),
    })
  if (can('label.print'))
    sections.push({
      key: 'print',
      count: print.queued.length,
      node: (
        <DeskSection
          title="คิวพิมพ์ป้าย"
          count={print.queued.length}
          detail={print.queued
            .slice(0, 3)
            .map((j) => j.title ?? 'งานพิมพ์')
            .join(' · ')}
          action="ไปพิมพ์"
          onGo={onTab && (() => onTab('labels'))}
        />
      ),
    })
  if (onTab && (can('invoice.close') || can('invoice.report')))
    sections.push({
      key: 'invoice',
      count: invoices.open,
      node: <DeskSection title="Invoice ยังรับไม่ครบ" count={invoices.open} detail={invoices.reported ? `แจ้งผู้ขายแล้วรอของ ${invoices.reported}` : 'ตรวจยอดรับกับ Invoice แล้วปิด หรือแจ้งผู้ขาย'} action="กระทบยอด" onGo={() => onTab('invoice')} />,
    })
  if (onTab && (can('ledger.ack.planning') || can('ledger.ack.account')))
    sections.push({ key: 'ack', count: acks, node: <DeskSection title="ปิดยอดเดือน รอคุณรับทราบ" count={acks} detail="บัญชีคุม FM-P-537" action="ไปรับทราบ" onGo={() => onTab('ledger')} /> })

  const busy = sections.filter((s) => s.count > 0)
  const idle = sections.filter((s) => s.count === 0)
  const total = busy.reduce((s, x) => s + x.count, 0)

  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-slate-800">งานวันนี้{profile ? ` · ${profile.full_name}` : ''}</h2>
          <p className="text-sm text-slate-500">
            {work.today ? dayLabel(work.today) : 'กำลังโหลด…'}
            {work.at && ` · อัปเดต ${time(work.at)} น.`}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ${total ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'}`}>
          {total ? `ค้าง ${fmt(total)} รายการ` : '✓ ไม่มีงานค้าง'}
        </span>
        <BigButton tone="secondary" onClick={() => setVer((v) => v + 1)}>
          ↻ อัปเดต
        </BigButton>
      </section>

      {work.error && <Alert tone="bad">โหลดงานไม่สำเร็จ: {work.error}</Alert>}
      {!sections.length && <Alert tone="info">บัญชีนี้ยังไม่มีงานหน้างาน · ดูภาพรวมหรือผังคลังได้จากเมนู</Alert>}
      {!work.at && !work.error && sections.length > 0 && <p className="py-8 text-center text-slate-500">กำลังโหลดงาน…</p>}

      <div className="grid gap-3 lg:grid-cols-2">
        {work.at &&
          busy.map((s) => (
            <div key={s.key} className="min-w-0">
              {s.node}
            </div>
          ))}
      </div>
      {work.at && idle.length > 0 && (
        <p className="rounded-xl bg-white px-4 py-3 text-sm text-slate-500 ring-1 ring-slate-200">
          ✓ ไม่มีงานค้าง: {idle.map((s) => SECTION_NAME[s.key]).join(' · ')}
        </p>
      )}
    </div>
  )
}

const SECTION_NAME: Record<string, string> = {
  checks: 'ใบตรวจรับ',
  qi: 'ตรวจ MI3',
  put: 'จัดเก็บ',
  count: 'นับวน',
  ng: 'NG รอส่งคืน',
  approve: 'อนุมัติปรับยอด',
  print: 'คิวพิมพ์',
  invoice: 'Invoice',
  ack: 'รับทราบปิดยอด',
}

function Shell({ title, count, hint, children }: { title: string; count?: ReactNode; hint: string; children: ReactNode }) {
  return (
    <section className="flex h-full flex-col gap-2 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <header className="flex items-baseline gap-2">
        <h3 className="text-base font-bold text-slate-800">{title}</h3>
        {count}
      </header>
      <p className="text-xs text-slate-500">{hint}</p>
      {children}
    </section>
  )
}

const Count = ({ n }: { n: number }) => <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">{fmt(n)}</span>

function BoxSection({ title, hint, boxes, action, onPick, extra }: { title: string; hint: string; boxes: WorkBox[]; action: string; onPick: (b: WorkBox) => void; extra?: ReactNode }) {
  const [all, setAll] = useState(false)
  const shown = all ? boxes : boxes.slice(0, SHOW)
  return (
    <Shell title={title} count={<Count n={boxes.length} />} hint={hint}>
      <ul className="flex flex-col divide-y divide-slate-100">
        {shown.map((b) => (
          <li key={b.lpnNo}>
            <button className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-slate-50" onClick={() => onPick(b)}>
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-sm font-semibold text-slate-800">{b.lpnNo}</span>
                <span className="block truncate text-xs text-slate-500">
                  {b.summary || 'กล่องว่าง'} · {b.loc}
                  {b.model ? ` · ${b.model}` : ''}
                </span>
              </span>
              {b.days > 0 && <Pill tone={b.days > 2 ? 'warn' : 'muted'}>{b.days} วัน</Pill>}
              <span className="shrink-0 text-sm font-semibold text-sky-700">{action} →</span>
            </button>
          </li>
        ))}
      </ul>
      {boxes.length > SHOW && (
        <button className="self-start text-sm font-semibold text-sky-700" onClick={() => setAll((a) => !a)}>
          {all ? 'ย่อ' : `ดูทั้งหมด ${boxes.length} กล่อง`}
        </button>
      )}
      {extra}
    </Shell>
  )
}

function CheckSection({ checks, onOpen }: { checks: ReceiptCheck[]; onOpen?: (id: string) => void }) {
  return (
    <Shell title="ใบตรวจรับค้าง" count={<Count n={checks.length} />} hint="ตรวจของตาม Packing List ทีละเคส · หลายคนช่วยกันตรวจใบเดียวกันได้">
      <ul className="flex flex-col divide-y divide-slate-100">
        {checks.slice(0, SHOW).map((c) => (
          <li key={c.id}>
            <button className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-slate-50 disabled:cursor-default" disabled={!onOpen} onClick={() => onOpen?.(c.id)}>
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-sm font-semibold text-slate-800">{c.checkNo}</span>
                <span className="block truncate text-xs text-slate-500">
                  PL {c.plRef} · {c.modelCode ?? '-'} · ตรวจแล้ว {c.checkedCount}/{c.lineCount}
                </span>
              </span>
              <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${c.lineCount ? (c.checkedCount / c.lineCount) * 100 : 0}%` }} />
              </span>
              {onOpen && <span className="shrink-0 text-sm font-semibold text-sky-700">ตรวจ →</span>}
            </button>
          </li>
        ))}
      </ul>
    </Shell>
  )
}

function DeskSection({ title, count, detail, action, onGo }: { title: string; count: number; detail: string; action: string; onGo?: () => void }) {
  return (
    <Shell title={title} count={<Count n={count} />} hint={detail}>
      {onGo ? (
        <BigButton className="self-start" onClick={onGo}>
          {action} →
        </BigButton>
      ) : (
        <p className="text-xs text-slate-500">ทำที่จอคอม: เมนู ☰ › สลับเป็นโหมดคอม › งานคลัง</p>
      )}
    </Shell>
  )
}

function CycleSection({ plan, onCount }: { plan: CyclePlan | null; onCount: (lpnNo: string) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  if (!plan) return <Shell title="นับวนวันนี้" hint="กำลังโหลด…">{null}</Shell>
  const pending = plan.slots.filter((s) => s.reason && !s.done)
  const shown = all ? plan.slots : [...pending.slice(0, SHOW), ...(pending.length ? [] : plan.slots.slice(0, SHOW))]
  return (
    <Shell
      title="นับวนวันนี้"
      count={
        <span className="text-sm font-semibold text-slate-600">
          {plan.done}/{plan.target} ช่อง{plan.extra ? ` · นับเพิ่ม ${plan.extra}` : ''}
        </span>
      }
      hint="นับแบบไม่เห็นยอดในระบบ · ช่องที่ครั้งก่อนไม่ตรง / ยังไม่เคยนับ / เข้า-ออกบ่อย มาก่อน · นับครบทุกช่องในราว 1 เดือน"
    >
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${plan.target ? (plan.done / plan.target) * 100 : 0}%` }} />
      </div>
      {plan.target === 0 ? (
        <p className="text-sm text-slate-500">ยังไม่มีช่องที่มีของให้นับ</p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100">
          {shown.map((s) => (
            <SlotRow key={s.code} s={s} open={open === s.code} onToggle={() => setOpen((o) => (o === s.code ? null : s.code))} onCount={onCount} />
          ))}
        </ul>
      )}
      {plan.slots.length > shown.length && (
        <button className="self-start text-sm font-semibold text-sky-700" onClick={() => setAll(true)}>
          ดูทั้งหมด {plan.slots.length} ช่อง
        </button>
      )}
      {all && (
        <button className="self-start text-sm font-semibold text-sky-700" onClick={() => setAll(false)}>
          ย่อ
        </button>
      )}
    </Shell>
  )
}

function SlotRow({ s, open, onToggle, onCount }: { s: CycleSlot; open: boolean; onToggle: () => void; onCount: (lpnNo: string) => void }) {
  return (
    <li>
      <button className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-slate-50" onClick={onToggle} aria-expanded={open}>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-sm font-semibold text-slate-800">{s.code}</span>
          <span className="block text-xs text-slate-500">
            {s.boxes.length} กล่อง · นับแล้ว {s.counted}/{s.items} รายการ{s.lastCounted ? ` · ครั้งก่อน ${s.lastCounted}` : ''}
          </span>
        </span>
        {s.done ? <Pill tone="ok">✓ ครบ</Pill> : s.reason ? <Pill tone={s.reason === 'recount' ? 'warn' : 'info'}>{CYCLE_REASON[s.reason]}</Pill> : <Pill tone="muted">นับเพิ่ม</Pill>}
        <span className="shrink-0 text-slate-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul className="mb-2 flex flex-col gap-1.5 rounded-lg bg-slate-50 p-2">
          {s.boxes.map((b) => (
            <li key={b.lpnNo} className="flex items-center gap-2">
              <span className="flex-1 font-mono text-sm">{b.lpnNo}</span>
              <span className="text-xs text-slate-500">
                {b.counted}/{b.items}
              </span>
              <BigButton tone={b.counted >= b.items ? 'secondary' : 'primary'} className="!min-h-[40px] !px-3 !py-1 text-sm" onClick={() => onCount(b.lpnNo)}>
                {b.counted >= b.items ? 'นับซ้ำ' : 'นับ'}
              </BigButton>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
