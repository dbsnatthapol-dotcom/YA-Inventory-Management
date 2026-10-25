import { useCallback, useEffect, useMemo, useState } from 'react'
import { errorText } from '../../wms/api'
import { caseName, checkSummary, compareParts, groupCases, ISSUE_LABEL, lineIssues, offInvoice, type CaseGroup, type LineIssue } from '../../wms/checkSheet'
import { fmt } from '../../wms/logic'
import type { CheckDetail, CheckLine, CheckLinePatch, InvoiceLine, ReceiptCheck } from '../../wms/types'
import { useWms } from '../../wms/useWms'
import { useIsMobile } from '../../lib/viewMode'
import { CheckReport } from './CheckReport'
import { PrintDialog } from './Print'
import { Alert, BigButton, Card, Field, inputCls, Pill, Segmented, tdCls, thCls, type Tone } from './ui'
import { TraceButton } from './TraceButton'

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '')
const ISSUE_TONE: Record<LineIssue, Tone> = { short: 'bad', over: 'warn', missing: 'bad', extra: 'warn', damaged: 'bad' }
/** ตรวจพร้อมกันหลายเครื่อง: ดึงของคนอื่นทุก 15 วินาที */
const POLL_MS = 15_000

/** รายการใบตรวจรับ: ใบที่ยังเปิดก่อน */
export function CheckList({ checks, error, onOpen }: { checks: ReceiptCheck[] | null; error: string | null; onOpen: (id: string) => void }) {
  if (error) return <Alert tone="bad">โหลดใบตรวจรับไม่สำเร็จ: {error}</Alert>
  if (!checks) return <p className="py-8 text-center text-slate-500">กำลังโหลดใบตรวจรับ…</p>
  if (!checks.length)
    return (
      <Card>
        <p className="py-6 text-center text-sm text-slate-500">ยังไม่มีใบตรวจรับ · ไปที่ "รับของใหม่" ถ่าย Packing List แล้วกด "สร้างใบตรวจรับ"</p>
      </Card>
    )
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {checks.map((c) => {
        const pct = c.lineCount ? Math.round((c.checkedCount / c.lineCount) * 100) : 0
        return (
          <button key={c.id} onClick={() => onOpen(c.id)} className="flex flex-col gap-2 rounded-xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 hover:ring-sky-400">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-base font-bold text-slate-800">{c.checkNo}</span>
              {c.status === 'open' ? <Pill tone="info">กำลังตรวจ</Pill> : c.status === 'done' ? <Pill tone="ok">ออก {c.grnNo ?? 'GRN'} แล้ว</Pill> : <Pill tone="muted">ยกเลิก</Pill>}
            </div>
            <div className="text-sm text-slate-600">
              PL {c.plRef} · {c.modelCode ?? '-'}
              {c.invoiceNo ? ` · INV ${c.invoiceNo}` : ''}
              {c.packages ? ` · ${c.packages}` : ''}
            </div>
            {c.status === 'open' && (
              <>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                </div>
                <div className="text-xs text-slate-500">
                  ตรวจแล้ว {c.checkedCount}/{c.lineCount} รายการ · สร้าง {when(c.createdAt)} โดย {c.createdCode ?? '-'}
                </div>
              </>
            )}
            {c.status === 'cancelled' && <div className="text-xs text-slate-500">ยกเลิก: {c.cancelReason}</div>}
          </button>
        )
      })}
    </div>
  )
}

/** ตรวจรับทีละเคส: กดตรงทั้งเคส หรือใส่ยอดที่นับได้ทีละบรรทัด · หลายคนตรวจใบเดียวกันได้ · ครบแล้วออก GRN */
export function CheckView({ id, onBack, onReceived, onChanged }: { id: string; onBack: () => void; onReceived: (grnId: string) => void; onChanged: () => void }) {
  const { api, master, can } = useWms()
  const mobile = useIsMobile()
  const [d, setD] = useState<CheckDetail | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'bad' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState<'todo' | 'issue' | 'all'>('todo')
  const [report, setReport] = useState(false)
  const allowed = can('receive.create')

  const load = useCallback(async () => {
    try {
      const next = await api.checkDetail(id)
      setD(next)
      return next
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
      return null
    }
  }, [api, id])

  useEffect(() => {
    let alive = true
    api
      .checkDetail(id)
      .then((next) => alive && setD(next))
      .catch((e) => alive && setMsg({ tone: 'bad', text: errorText(e) }))
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      api
        .checkDetail(id)
        .then((next) => alive && next && setD((cur) => (cur && sameLines(cur, next) ? cur : next)))
        .catch(() => undefined)
    }
    const t = window.setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      alive = false
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [api, id])

  /** งานที่เปลี่ยนบรรทัด: แทนบรรทัดในจอทันที (ไม่ต้องรอโหลดใหม่) */
  const run = async (fn: () => Promise<string | void>, notify = false) => {
    setBusy(true)
    setMsg(null)
    try {
      const text = await fn()
      if (text) setMsg({ tone: 'ok', text })
      if (notify) onChanged()
    } catch (e) {
      const text = errorText(e)
      // คนอื่นบันทึกบรรทัดเดียวกันไปก่อน ⇒ โหลดของล่าสุดให้เห็นก่อนตรวจซ้ำ
      if (text.includes('มีคนบันทึกไปก่อนแล้ว')) await load()
      setMsg({ tone: text.includes('มีคนบันทึกไปก่อนแล้ว') ? 'warn' : 'bad', text })
    } finally {
      setBusy(false)
    }
  }
  const putLine = (l: CheckLine) => setD((cur) => (cur ? { ...cur, lines: cur.lines.some((x) => x.id === l.id) ? cur.lines.map((x) => (x.id === l.id ? l : x)) : [...cur.lines, l] } : cur))

  const lines = useMemo(() => d?.lines ?? [], [d])
  const cases = useMemo(() => groupCases(lines), [lines])
  const sum = useMemo(() => checkSummary(lines), [lines])
  const parts = useMemo(() => compareParts(lines, d?.check.invoiceLines ?? []), [lines, d])
  if (!d) return msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : <p className="py-8 text-center text-slate-500">กำลังโหลดใบตรวจรับ…</p>
  const c = d.check
  const editable = c.status === 'open' && allowed
  // เคสที่เปิดอยู่ยังแสดงแม้ตรวจครบแล้ว (เห็นผลบรรทัดสุดท้ายก่อนไปเคสอื่น)
  const shown = cases.filter((g) => (filter === 'todo' ? g.checked < g.lines.length || g.caseNo === open : filter === 'issue' ? g.issues > 0 : true))
  const left = sum.lines - sum.checked
  const offInv = offInvoice(parts)

  const saveLine = (l: CheckLine, patch: CheckLinePatch, text?: string) =>
    run(async () => {
      putLine(await api.saveCheckLine(l.id, l.version, patch))
      return text
    })
  const saveCase = (g: CaseGroup, mode: 'ok' | 'missing') =>
    run(async () => {
      if (mode === 'missing' && !window.confirm(`${caseName(g.caseNo)} ไม่มีมากับรถ? ทุกรายการในเคสที่ยังไม่ได้ตรวจจะบันทึกว่านับได้ 0`)) return
      const n = await api.saveCheckCase(c.id, g.caseNo, mode)
      await load()
      // ตรวจเคสนี้ครบ ⇒ เปิดเคสถัดไปที่ยังไม่ตรวจให้เลย
      const next = cases.find((x) => x.caseNo !== g.caseNo && x.checked < x.lines.length)
      setOpen(next ? next.caseNo : null)
      return `${caseName(g.caseNo)}: ${mode === 'ok' ? 'ตรงตาม PL' : 'ไม่มีมา'} ${n} รายการ`
    }, true)
  const addLine = (caseNo: string, partNo: string, actual: number, note: string) =>
    run(async () => {
      putLine(await api.addCheckLine(c.id, { caseNo, partNo, actual, note }))
      return `${caseName(caseNo)}: เพิ่ม ${partNo} ที่ไม่มีใน PL แล้ว`
    })
  const complete = () =>
    run(async () => {
      if (
        !window.confirm(
          `ตรวจครบแล้ว ออกใบรับ (GRN) ตามยอดที่นับได้?\n\n${sum.cases} เคส · ${fmt(sum.actualQty)} ชิ้น${sum.issueLines ? ` · ของไม่ตรง ${sum.issueLines} รายการ` : ''}${sum.damagedQty ? `\nของเสียหาย ${fmt(sum.damagedQty)} ชิ้น แยกเป็นกล่อง NG (พื้นที่กัก NG) อัตโนมัติ` : ''}`,
        )
      )
        return
      const r = await api.completeCheck(c.id)
      onReceived(r.grnId)
      return `ออก ${r.grnNo} แล้ว`
    }, true)
  const cancel = () =>
    run(async () => {
      const reason = window.prompt(`ยกเลิกใบตรวจรับ ${c.checkNo}? ใส่เหตุผล`)
      if (!reason?.trim()) return
      await api.cancelCheck(c.id, reason)
      await load()
      return 'ยกเลิกใบตรวจรับแล้ว'
    }, true)

  return (
    <div className={`flex flex-col gap-3 ${c.status === 'open' ? 'pb-28' : ''}`}>
      <Card
        eyebrow="ใบตรวจรับ · ตรวจทีละเคสตาม Packing List"
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{c.checkNo}</span>
            {c.status === 'open' ? <Pill tone="info">กำลังตรวจ</Pill> : c.status === 'done' ? <Pill tone="ok">ออก {c.grnNo} แล้ว</Pill> : <Pill tone="muted">ยกเลิก</Pill>}
          </span>
        }
        action={
          <div className="flex flex-wrap gap-2">
            <TraceButton query={c.grnNo ?? c.checkNo} label="ตามรอย" className="min-h-[44px]" />
            <BigButton tone="secondary" onClick={onBack}>
              ← ทั้งหมด
            </BigButton>
            <BigButton tone="secondary" disabled={busy} onClick={() => void load()} aria-label="โหลดใหม่">
              ↻
            </BigButton>
          </div>
        }
      >
        <div className="grid gap-x-6 gap-y-1 text-sm text-slate-600 sm:grid-cols-2">
          <div>
            Packing List <b className="font-mono text-slate-800">{c.plRef}</b> · {c.modelCode ?? '-'}
            {c.packages ? ` · ${c.packages}` : ''}
          </div>
          <div>
            Invoice <b className="font-mono text-slate-800">{c.invoiceNo ?? '–'}</b>
            {c.poNo ? ` · PO ${c.poNo}` : ''}
          </div>
          <div className="text-xs text-slate-500">
            สร้าง {when(c.createdAt)} โดย {c.createdCode ?? '-'}
            {c.replacement ? ' · รับของทดแทน' : ''}
          </div>
          {c.note && <div className="text-xs text-slate-500">หมายเหตุ: {c.note}</div>}
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${sum.lines ? (sum.checked / sum.lines) * 100 : 0}%` }} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <strong>
            ตรวจแล้ว {sum.checked}/{sum.lines} รายการ · {sum.casesDone}/{sum.cases} เคส
          </strong>
          {(Object.keys(ISSUE_LABEL) as LineIssue[])
            .filter((k) => sum.issues[k])
            .map((k) => (
              <Pill key={k} tone={ISSUE_TONE[k]}>
                {ISSUE_LABEL[k]} {sum.issues[k]}
              </Pill>
            ))}
          {offInv.length > 0 && <Pill tone="bad">ไม่ตรง Invoice {offInv.length} part</Pill>}
        </div>
        {c.status === 'done' && (
          <Alert tone="ok">
            ออกใบรับ {c.grnNo} แล้ว {when(c.doneAt)} โดย {c.doneCode} · พิมพ์ป้ายกล่อง (1 เคส = 1 ป้าย) ได้ที่หน้าป้าย หรือไม่พิมพ์ก็ได้ (ใช้เลข PL + เลขเคสค้นหาและย้ายของ)
            {sum.damagedQty > 0 && ` · ของเสียหาย ${fmt(sum.damagedQty)} ชิ้นแยกเป็นกล่อง NG แล้ว (งานวันนี้ → NG รอส่งคืน)`}
          </Alert>
        )}
        {c.status === 'cancelled' && (
          <Alert tone="warn">
            ยกเลิกแล้ว {when(c.cancelledAt)} โดย {c.cancelledCode}: {c.cancelReason}
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <BigButton tone="secondary" onClick={() => setReport(true)}>
            🖨️ รายงานผลตรวจรับ{sum.issueLines || offInv.length ? ' (ของไม่ตรง)' : ''}
          </BigButton>
          {c.status === 'done' && c.grnId && <BigButton onClick={() => onReceived(c.grnId!)}>ไปหน้าป้าย {c.grnNo} →</BigButton>}
          {editable && (
            <BigButton tone="ghost" disabled={busy} onClick={() => void cancel()}>
              ยกเลิกใบตรวจรับ
            </BigButton>
          )}
        </div>
      </Card>

      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <InvoiceBlock
        check={c}
        parts={parts}
        editable={editable}
        busy={busy}
        onSave={(patch) =>
          void run(async () => {
            await api.saveCheckHeader(c.id, patch)
            await load()
            return 'บันทึกข้อมูล Invoice แล้ว'
          })
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="แสดงเคส"
          value={filter}
          onChange={setFilter}
          options={[
            ['todo', `ยังไม่ครบ (${cases.filter((g) => g.checked < g.lines.length).length})`],
            ['issue', `มีของไม่ตรง (${cases.filter((g) => g.issues).length})`],
            ['all', `ทั้งหมด (${cases.length})`],
          ]}
        />
      </div>
      {shown.length === 0 && <p className="rounded-xl bg-white px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">{filter === 'todo' ? '✓ ตรวจครบทุกเคสแล้ว' : 'ไม่มีเคสในกลุ่มนี้'}</p>}
      <div className="flex flex-col gap-2">
        {shown.map((g) => (
          <CaseCard
            key={g.caseNo || '-'}
            g={g}
            open={open === g.caseNo || shown.length === 1}
            editable={editable}
            busy={busy}
            onToggle={() => setOpen((o) => (o === g.caseNo ? null : g.caseNo))}
            onCase={(mode) => void saveCase(g, mode)}
            onSave={(l, patch, text) => void saveLine(l, patch, text)}
            onAdd={(partNo, actual, note) => void addLine(g.caseNo, partNo, actual, note)}
            onPhoto={(l, file) =>
              void run(async () => {
                const path = await api.uploadDoc(file, 'check')
                if (!path) return void setMsg({ tone: 'warn', text: api.kind === 'demo' ? 'หน้าสาธิตไม่เก็บรูป · ระบบจริงเก็บรูปเป็นหลักฐานในรายงาน' : 'อัปโหลดรูปไม่สำเร็จ · ลองใหม่' })
                putLine(await api.saveCheckLine(l.id, l.version, { photos: [...l.photos, path] }))
                return 'แนบรูปแล้ว'
              })
            }
          />
        ))}
      </div>

      {editable && (
        <div className={`sticky bottom-2 z-20 flex flex-wrap items-center justify-between rounded-xl border-2 border-sky-700 bg-white shadow-lg ${mobile ? 'gap-2 px-3 py-2' : 'gap-3 px-4 py-3'}`}>
          <div className="text-sm">
            <strong className="text-base">{left ? `เหลือ ${left} รายการ` : '✓ ตรวจครบแล้ว'}</strong>
            <div className="text-xs text-slate-500">
              นับได้ {fmt(sum.actualQty)} / PL {fmt(sum.plQty)} ชิ้น{sum.issueLines ? ` · ไม่ตรง ${sum.issueLines} รายการ` : ''}
            </div>
          </div>
          <BigButton disabled={busy || left > 0} onClick={() => void complete()} className={`!py-3 text-base ${mobile ? 'w-full' : ''}`} title={left ? 'ตรวจให้ครบทุกรายการก่อน' : undefined}>
            ตรวจครบ → ออก GRN
          </BigButton>
        </div>
      )}

      <datalist id="wms-parts-all">
        {master.parts.map((p) => (
          <option key={p.partNo} value={p.partNo}>
            {p.name}
          </option>
        ))}
      </datalist>

      <PrintDialog open={report} onClose={() => setReport(false)} format="a4" title="รายงานผลตรวจรับ" subtitle={`${c.checkNo} · PL ${c.plRef}`} printLabel="พิมพ์รายงาน">
        <CheckReport detail={d} />
      </PrintDialog>
    </div>
  )
}

/** ข้อมูลเหมือนเดิม (ไม่ต้องวาดใหม่ระหว่างที่คนกำลังพิมพ์ยอด) */
const sameLines = (a: CheckDetail, b: CheckDetail) =>
  a.check.status === b.check.status && a.lines.length === b.lines.length && a.lines.every((l, i) => l.id === b.lines[i]?.id && l.version === b.lines[i]?.version)

function CaseCard({
  g,
  open,
  editable,
  busy,
  onToggle,
  onCase,
  onSave,
  onAdd,
  onPhoto,
}: {
  g: CaseGroup
  open: boolean
  editable: boolean
  busy: boolean
  onToggle: () => void
  onCase: (mode: 'ok' | 'missing') => void
  onSave: (l: CheckLine, patch: CheckLinePatch, text?: string) => void
  onAdd: (partNo: string, actual: number, note: string) => void
  onPhoto: (l: CheckLine, file: File) => void
}) {
  const [adding, setAdding] = useState(false)
  const pl = g.lines.reduce((s, l) => s + l.plQty, 0)
  const state = { todo: <Pill tone="muted">ยังไม่ตรวจ</Pill>, partial: <Pill tone="info">ตรวจแล้ว {g.checked}/{g.lines.length}</Pill>, ok: <Pill tone="ok">✓ ตรง</Pill>, issue: <Pill tone="bad">ไม่ตรง {g.issues}</Pill> }[g.state]
  const unchecked = g.lines.some((l) => l.actualQty === null && !l.extra)
  return (
    <section className={`rounded-xl bg-white shadow-sm ring-1 ${g.state === 'issue' ? 'ring-rose-200' : g.state === 'ok' ? 'ring-emerald-200' : 'ring-slate-200'}`}>
      <button className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left" onClick={onToggle} aria-expanded={open}>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold text-slate-800">{caseName(g.caseNo)}</span>
          <span className="block truncate text-xs text-slate-500">
            {g.lines.length} รายการ · PL {fmt(pl)} ชิ้น · {g.lines.map((l) => l.partNo).join(', ')}
          </span>
        </span>
        {state}
        <span className="text-slate-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-slate-100 px-3 pb-3 pt-2">
          {editable && unchecked && (
            <div className="grid grid-cols-2 gap-2">
              <BigButton disabled={busy} onClick={() => onCase('ok')}>
                ✓ ทั้งเคสตรงตาม PL
              </BigButton>
              <BigButton tone="secondary" disabled={busy} onClick={() => onCase('missing')}>
                ไม่มีเคสนี้มา
              </BigButton>
            </div>
          )}
          {g.lines.map((l) => (
            <LineRow key={`${l.id}-${l.version}`} l={l} editable={editable} busy={busy} onSave={onSave} onPhoto={onPhoto} />
          ))}
          {editable &&
            (adding ? (
              <AddLine
                busy={busy}
                onCancel={() => setAdding(false)}
                onAdd={(p, q, n) => {
                  onAdd(p, q, n)
                  setAdding(false)
                }}
              />
            ) : (
              <button className="min-h-[44px] self-start rounded-lg px-3 text-sm font-semibold text-sky-700 ring-1 ring-sky-200" onClick={() => setAdding(true)}>
                + พบของที่ไม่มีใน PL ในเคสนี้
              </button>
            ))}
        </div>
      )}
    </section>
  )
}

function LineRow({
  l,
  editable,
  busy,
  onSave,
  onPhoto,
}: {
  l: CheckLine
  editable: boolean
  busy: boolean
  onSave: (l: CheckLine, patch: CheckLinePatch, text?: string) => void
  onPhoto: (l: CheckLine, file: File) => void
}) {
  const [qty, setQty] = useState(l.actualQty === null ? '' : String(l.actualQty))
  const [more, setMore] = useState(l.damagedQty > 0 || !!l.note || l.photos.length > 0)
  const [damaged, setDamaged] = useState(String(l.damagedQty || ''))
  const [note, setNote] = useState(l.note ?? '')
  const [fix, setFix] = useState(false)
  const issues = lineIssues(l)
  const n = (v: string) => Math.max(0, Math.floor(Number(v) || 0))
  const changed = qty !== (l.actualQty === null ? '' : String(l.actualQty)) || n(damaged) !== l.damagedQty || note.trim() !== (l.note ?? '')
  const save = () => onSave(l, { actual: qty === '' ? null : n(qty), damaged: qty === '' ? 0 : n(damaged), note }, `${l.partNo}: บันทึกแล้ว`)
  return (
    <div className={`flex flex-col gap-2 rounded-lg p-2.5 ring-1 ${issues.length ? 'bg-rose-50/60 ring-rose-200' : l.actualQty !== null ? 'bg-emerald-50/50 ring-emerald-200' : 'ring-slate-200'}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm font-bold text-slate-800">
            {l.partNo}
            {l.extra && <span className="ml-2 align-middle"><Pill tone="warn">ไม่มีใน PL</Pill></span>}
          </div>
          <div className="truncate text-xs text-slate-500">{l.description ?? ''}</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-slate-500">ตาม PL</div>
          <div className="font-mono text-lg font-bold text-slate-800">{fmt(l.plQty)}</div>
        </div>
      </div>
      {editable ? (
        <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[minmax(0,180px)_auto_auto]">
          <input
            type="number"
            min={0}
            inputMode="numeric"
            className={`${inputCls} min-h-[48px] text-right font-mono text-lg font-semibold`}
            placeholder="นับได้"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && changed && !busy && save()}
            aria-label={`นับได้ ${l.partNo}`}
          />
          {changed && qty !== '' ? (
            <BigButton disabled={busy} onClick={save} className="min-h-[48px]">
              บันทึก
            </BigButton>
          ) : l.actualQty === null ? (
            // เสียหาย/หมายเหตุที่พิมพ์ไว้ไปพร้อมกัน
            <BigButton disabled={busy || l.extra} onClick={() => onSave(l, { actual: l.plQty, damaged: n(damaged), note }, `${l.partNo}: ตรงตาม PL`)} className="min-h-[48px]">
              {n(damaged) > 0 ? `✓ ครบ PL · เสียหาย ${n(damaged)}` : '✓ ตรง'}
            </BigButton>
          ) : (
            // ตรวจแล้ว: ไม่มีปุ่ม "ตรง" ให้กดทับยอดที่นับไว้โดยไม่ตั้งใจ · แก้ตัวเลขแล้วกดบันทึก
            <span className="grid min-h-[48px] place-items-center px-3 text-sm font-semibold text-emerald-700">บันทึกแล้ว</span>
          )}
          <button className="col-span-2 min-h-[40px] self-center justify-self-start text-sm font-semibold text-slate-600 sm:col-span-1" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            {more ? 'ซ่อน' : 'เสียหาย / หมายเหตุ / รูป'}
          </button>
        </div>
      ) : (
        <div className="text-sm">
          นับได้ <b className="font-mono">{fmt(l.actualQty)}</b>
          {l.damagedQty > 0 && ` · เสียหาย ${fmt(l.damagedQty)}`}
          {l.note && ` · ${l.note}`}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1">
        {issues.map((i) => (
          <Pill key={i} tone={ISSUE_TONE[i]}>
            {ISSUE_LABEL[i]}
            {i === 'short' || i === 'over' ? ` ${fmt(Math.abs((l.actualQty ?? 0) - l.plQty))}` : i === 'damaged' ? ` ${fmt(l.damagedQty)}` : ''}
          </Pill>
        ))}
        {l.actualQty !== null && !issues.length && <Pill tone="ok">ตรง</Pill>}
        {l.checkedCode && <span className="text-[11px] text-slate-400">ตรวจโดย {l.checkedCode} {when(l.checkedAt)}</span>}
      </div>
      {more && (
        <div className="flex flex-col gap-2 rounded-lg bg-white p-2 ring-1 ring-slate-100">
          {editable && (
            <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
              <Field label="เสียหาย (ชิ้น)">
                <input type="number" min={0} inputMode="numeric" className={`${inputCls} font-mono`} value={damaged} onChange={(e) => setDamaged(e.target.value)} />
              </Field>
              <Field label="หมายเหตุ">
                <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น กล่องบุบ ฉลากไม่ตรง" />
              </Field>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {l.photos.map((p) => (
              <DocThumb key={p} path={p} />
            ))}
            {editable && (
              <label className="flex min-h-[44px] cursor-pointer items-center gap-1 rounded-lg px-3 text-sm font-semibold text-sky-700 ring-1 ring-sky-200">
                📷 ถ่ายรูป
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => e.target.files?.[0] && onPhoto(l, e.target.files[0])} />
              </label>
            )}
          </div>
          {editable && (
            <div className="flex flex-wrap gap-3 text-sm">
              {changed && qty !== '' && (
                <BigButton disabled={busy} onClick={save}>
                  บันทึก
                </BigButton>
              )}
              {l.actualQty !== null && (
                <button className="min-h-[40px] font-semibold text-slate-500" disabled={busy} onClick={() => onSave(l, { actual: null }, `${l.partNo}: ยกเลิกผลตรวจ`)}>
                  ยกเลิกผลตรวจบรรทัดนี้
                </button>
              )}
              {!l.extra && (
                <button className="min-h-[40px] font-semibold text-slate-500" onClick={() => setFix((f) => !f)}>
                  ✎ แก้ข้อมูลจาก PL (AI อ่านผิด)
                </button>
              )}
            </div>
          )}
          {fix && editable && (
            <FixLine
              l={l}
              busy={busy}
              onSave={(patch) => {
                onSave(l, patch, `${l.partNo}: แก้ข้อมูล PL แล้ว`)
                setFix(false)
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** แก้ Part / ยอด PL / เลขเคสที่ AI อ่านผิด (ไม่แตะผลตรวจ) */
function FixLine({ l, busy, onSave }: { l: CheckLine; busy: boolean; onSave: (patch: { partNo?: string; plQty?: number; caseNo?: string }) => void }) {
  const [partNo, setPartNo] = useState(l.partNo)
  const [plQty, setPlQty] = useState(String(l.plQty))
  const [caseNo, setCaseNo] = useState(l.caseNo)
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_120px_120px_auto]">
      <Field label="Part No.">
        <input className={`${inputCls} font-mono`} list="wms-parts-all" value={partNo} onChange={(e) => setPartNo(e.target.value)} />
      </Field>
      <Field label="ยอด PL">
        <input type="number" min={0} inputMode="numeric" className={`${inputCls} font-mono`} value={plQty} onChange={(e) => setPlQty(e.target.value)} />
      </Field>
      <Field label="เคส">
        <input className={`${inputCls} font-mono uppercase`} value={caseNo} onChange={(e) => setCaseNo(e.target.value)} />
      </Field>
      <BigButton
        className="self-end"
        disabled={busy || !partNo.trim()}
        onClick={() =>
          onSave({
            ...(partNo.trim() !== l.partNo ? { partNo: partNo.trim() } : {}),
            ...(Math.max(0, Math.floor(Number(plQty) || 0)) !== l.plQty ? { plQty: Math.max(0, Math.floor(Number(plQty) || 0)) } : {}),
            ...(caseNo.trim().toUpperCase() !== l.caseNo ? { caseNo: caseNo.trim() } : {}),
          })
        }
      >
        บันทึกการแก้
      </BigButton>
    </div>
  )
}

function AddLine({ busy, onAdd, onCancel }: { busy: boolean; onAdd: (partNo: string, actual: number, note: string) => void; onCancel: () => void }) {
  const [partNo, setPartNo] = useState('')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-amber-50/60 p-2.5 ring-1 ring-amber-200">
      <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
        <Field label="Part No. ที่พบ">
          <input className={`${inputCls} font-mono`} list="wms-parts-all" value={partNo} onChange={(e) => setPartNo(e.target.value)} placeholder="เช่น RAT00566" />
        </Field>
        <Field label="นับได้">
          <input type="number" min={0} inputMode="numeric" className={`${inputCls} font-mono`} value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
      </div>
      <Field label="หมายเหตุ">
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ไม่มีใน Packing List" />
      </Field>
      <div className="flex gap-2">
        <BigButton disabled={busy || !partNo.trim() || qty === ''} onClick={() => onAdd(partNo.trim(), Math.max(0, Math.floor(Number(qty) || 0)), note)}>
          เพิ่ม
        </BigButton>
        <BigButton tone="secondary" onClick={onCancel}>
          ยกเลิก
        </BigButton>
      </div>
    </div>
  )
}

/** ภาพหลักฐาน (ลิงก์ชั่วคราวจากที่เก็บ) */
export function DocThumb({ path, size = 64 }: { path: string; size?: number }) {
  const { api } = useWms()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    api
      .docUrl(path)
      .then((u) => alive && setUrl(u))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [api, path])
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="รูปหลักฐาน" className="rounded object-cover ring-1 ring-slate-200" style={{ width: size, height: size }} />
    </a>
  ) : (
    <span className="grid place-items-center rounded bg-slate-100 text-xs text-slate-400" style={{ width: size, height: size }}>
      รูป
    </span>
  )
}

/** Invoice: เทียบยอดรวมต่อ part · AI อ่านรายการไม่ได้ ⇒ ใส่ยอดตาม Invoice เองได้ */
function InvoiceBlock({
  check,
  parts,
  editable,
  busy,
  onSave,
}: {
  check: ReceiptCheck
  parts: ReturnType<typeof compareParts>
  editable: boolean
  busy: boolean
  onSave: (patch: { invoiceNo?: string; invoiceLines?: InvoiceLine[] }) => void
}) {
  const noLines = check.invoiceLines.length === 0
  const [edit, setEdit] = useState(false)
  const [no, setNo] = useState(check.invoiceNo ?? '')
  const [rows, setRows] = useState<{ partNo: string; qty: string }[]>(() =>
    noLines ? parts.filter((p) => p.pl > 0).map((p) => ({ partNo: p.partNo, qty: '' })) : check.invoiceLines.map((l) => ({ partNo: l.partNo, qty: String(l.qty) })),
  )
  const off = offInvoice(parts)
  const body = (
    <>
      {!check.invoiceNo && !edit && <p className="text-sm text-slate-500">ไม่ได้ใส่เลข Invoice · เทียบได้เฉพาะกับ Packing List</p>}
      {check.invoiceNo && noLines && !edit && (
        <Alert tone="warn">Invoice {check.invoiceNo} ยังไม่มีรายการสินค้า (AI อ่านได้แค่หัวเอกสาร) · ใส่ยอดตาม Invoice เพื่อให้ระบบเทียบให้{editable ? ' กด "ใส่ยอด Invoice"' : ''}</Alert>
      )}
      {!noLines && !edit && (
        <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr>
                <th className={thCls}>Part</th>
                <th className={`${thCls} text-right`}>PL</th>
                <th className={`${thCls} text-right`}>นับได้</th>
                <th className={`${thCls} text-right`}>Invoice</th>
                <th className={thCls}>ผล</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => {
                const bad = p.invoice !== null && p.actual !== null && p.actual !== p.invoice
                return (
                  <tr key={p.partNo} className={bad ? 'bg-rose-50/60' : undefined}>
                    <td className={`${tdCls} font-mono`}>{p.partNo}</td>
                    <td className={`${tdCls} text-right font-mono`}>{fmt(p.pl)}</td>
                    <td className={`${tdCls} text-right font-mono font-semibold`}>{p.actual === null ? <span className="text-slate-400">กำลังตรวจ</span> : fmt(p.actual)}</td>
                    <td className={`${tdCls} text-right font-mono`}>{fmt(p.invoice)}</td>
                    <td className={tdCls}>{p.invoice === null ? <Pill tone="muted">ไม่มีใน Invoice</Pill> : p.actual === null ? null : bad ? <Pill tone="bad">ต่าง {fmt((p.actual ?? 0) - p.invoice)}</Pill> : <Pill tone="ok">ตรง</Pill>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <div className="flex flex-col gap-2">
          <Field label="เลข Invoice">
            <input className={`${inputCls} font-mono`} value={no} onChange={(e) => setNo(e.target.value)} />
          </Field>
          <p className="text-xs text-slate-500">ยอดรวมต่อ part ตาม Invoice (เว้นว่าง = ไม่มีใน Invoice)</p>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px_auto] gap-2">
              <input className={`${inputCls} font-mono`} value={r.partNo} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, partNo: e.target.value } : x)))} aria-label="Part No. ใน Invoice" />
              <input type="number" min={0} inputMode="numeric" className={`${inputCls} text-right font-mono`} value={r.qty} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} aria-label={`จำนวนใน Invoice ${r.partNo}`} />
              <button className="min-h-[44px] rounded-lg px-3 text-slate-400 ring-1 ring-slate-200" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="ลบแถว">
                ✕
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button className="min-h-[44px] rounded-lg px-3 text-sm font-semibold text-sky-700 ring-1 ring-sky-200" onClick={() => setRows((rs) => [...rs, { partNo: '', qty: '' }])}>
              + เพิ่มแถว
            </button>
            <BigButton
              disabled={busy}
              onClick={() => {
                onSave({
                  invoiceNo: no,
                  invoiceLines: rows.filter((r) => r.partNo.trim() && r.qty !== '').map((r, i) => ({ lineNo: i + 1, partNo: r.partNo.trim(), description: null, qty: Math.max(0, Math.floor(Number(r.qty) || 0)) })),
                })
                setEdit(false)
              }}
            >
              บันทึกยอด Invoice
            </BigButton>
            <BigButton tone="secondary" onClick={() => setEdit(false)}>
              ยกเลิก
            </BigButton>
          </div>
        </div>
      )}
      {editable && !edit && (
        <button className="min-h-[44px] self-start rounded-lg px-3 text-sm font-semibold text-sky-700 ring-1 ring-sky-200" onClick={() => setEdit(true)}>
          {noLines ? 'ใส่ยอด Invoice' : 'แก้ยอด Invoice'}
        </button>
      )}
    </>
  )
  const title = `เทียบ Invoice${off.length ? ` · ไม่ตรง ${off.length} part` : ''}`
  // พับไว้ (ตารางยาวเท่าจำนวน part) ให้รายการเคสอยู่ใกล้ด้านบน · เปิดเองเมื่อยังต้องใส่ยอด Invoice
  return (
    <details className="rounded-xl border border-slate-200 bg-white px-4 py-2 shadow-sm" open={noLines && !!check.invoiceNo}>
      <summary className="min-h-[44px] cursor-pointer py-2.5 text-base font-bold text-slate-800">{title}</summary>
      <div className="mb-2 mt-1 flex flex-col gap-2">{body}</div>
    </details>
  )
}
