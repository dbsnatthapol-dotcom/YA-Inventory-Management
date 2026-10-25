import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { errorText } from '../../wms/api'
import { checkSummary, caseName, ISSUE_LABEL, lineIssues } from '../../wms/checkSheet'
import { ledgerDelta } from '../../wms/ledger'
import { fmt, reconcile, TX_LABEL, txSummary } from '../../wms/logic'
import {
  closingText,
  GONE_LABEL,
  loadTrace,
  PLACE_LABEL,
  receiptSteps,
  REQ_KIND,
  reqSteps,
  traceQuery,
  type BoxPlace,
  type ChainStep,
  type ClosingRef,
  type PartTrace,
  type ReceiptTrace,
  type ReqTrace,
  type ReqUse,
  type StepKey,
  type StepTone,
  type TraceBox,
  type TraceOption,
  type TraceResult,
} from '../../wms/trace'
import type { Grn, LedgerCol, TxKind } from '../../wms/types'
import { useWms } from '../../wms/useWms'
import { QrScanner } from './QrScanner'
import { Alert, BigButton, Card, inputCls, Pill, tdCls, thCls, type Tone } from './ui'

/** ปุ่มไปหน้าจอที่ทำงานกับเอกสารนั้น (ไม่ใส่ = ไม่แสดงปุ่ม) */
export interface TraceLinks {
  /** เปิดใบตรวจรับในหน้ารับสินค้า */
  check?: (id: string) => void
  /** เปิดหน้าป้ายของใบรับ */
  grn?: (id: string) => void
  /** เปิดกล่องในหน้าสแกน */
  box?: (lpnNo: string) => void
  /** จอคอม: แท็บงานคลัง */
  tab?: (tab: 'invoice' | 'issue' | 'ledger') => void
}

type OnTrace = (query: string) => void

const when = (iso: string) =>
  new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })

const RECENT_KEY = 'uam-trace-recent'
const readRecent = (): string[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 8) : []
  } catch {
    return []
  }
}

/**
 * ตามรอยเอกสาร/กล่อง: พิมพ์หรือสแกนเลขอะไรก็ได้ในสาย แล้วเห็นทั้งสายเป็นภาพ
 * Packing List → ใบตรวจรับ → GRN (+ Invoice) → กล่อง → ใบเบิก → FM-P-005 → บัญชีคุม FM-P-537
 * แตะเลขเอกสารในผลเพื่อตามต่อ · ปุ่มย้อนกลับไปเลขก่อนหน้า
 */
export function TracePage({ start, compact = false, links = {} }: { start?: { query: string; key: number } | null; compact?: boolean; links?: TraceLinks }) {
  const { api, master, ready } = useWms()
  const [input, setInput] = useState(start?.query ?? '')
  const [trail, setTrail] = useState<string[]>([])
  const [result, setResult] = useState<TraceResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [camera, setCamera] = useState(false)
  const [recent, setRecent] = useState<string[]>(readRecent)
  const [latest, setLatest] = useState<Grn[]>([])
  const seq = useRef(0)

  const remember = (q: string) =>
    setRecent((r) => {
      const next = [q, ...r.filter((x) => x !== q)].slice(0, 8)
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      } catch {
        // ไม่มีที่เก็บ: จำเฉพาะรอบนี้
      }
      return next
    })

  /** new = เริ่มสายใหม่ · push = ตามต่อจากผลเดิม · back = ย้อนกลับ */
  const run = useCallback(
    async (text: string, mode: 'new' | 'push' | 'back' = 'push') => {
      const q = traceQuery(text)
      if (!q) return
      const n = ++seq.current
      setInput(q)
      setBusy(true)
      setError(null)
      setCamera(false)
      try {
        const r = await loadTrace(api, master, q)
        if (n !== seq.current) return
        setResult(r)
        setTrail((t) => (mode === 'back' ? t.slice(0, -1) : mode === 'new' ? [q] : t.at(-1) === q ? t : [...t, q]))
        if (r.type !== 'none') remember(q)
      } catch (e) {
        if (n === seq.current) setError(errorText(e))
      } finally {
        if (n === seq.current) setBusy(false)
      }
    },
    [api, master],
  )

  // เปิดจากหน้าอื่น (ปุ่มตามรอย) ⇒ ค้นทันที
  const startKey = start?.key
  const startQuery = start?.query
  useEffect(() => {
    if (ready && startQuery) queueMicrotask(() => void run(startQuery, 'new'))
  }, [ready, startKey, startQuery, run])

  // ตัวอย่างให้กดลอง: ใบรับล่าสุด
  useEffect(() => {
    if (!ready) return
    let alive = true
    api
      .listGrns(6)
      .then((g) => alive && setLatest(g.filter((x) => x.status !== 'void')))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [api, ready])

  const follow: OnTrace = (q) => void run(q, 'push')
  const prev = trail.length > 1 ? trail[trail.length - 2] : null

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <header>
          <h2 className="text-lg font-bold text-slate-800">ตามรอยเอกสาร / กล่อง</h2>
          <p className="text-sm text-slate-500">พิมพ์หรือสแกนเลขอะไรก็ได้ในสาย แล้วดูว่าของมาจากไหน อยู่ที่ไหน ไปไหนต่อ</p>
        </header>
        {camera && <QrScanner onCode={(t) => void run(t, 'new')} onClose={() => setCamera(false)} />}
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void run(input, 'new')
          }}
        >
          <input
            className={`${inputCls} min-w-0 flex-1 basis-56 font-mono`}
            placeholder="LPN-… / GRN-… / CHK-… / RQ-… / เลข PL / Invoice / ใบเบิก / Part"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoComplete="off"
            enterKeyHint="search"
            aria-label="เลขที่จะตามรอย"
          />
          <BigButton type="submit" disabled={busy || !input.trim()}>
            ↔ ตามรอย
          </BigButton>
          {!camera && (
            <BigButton type="button" tone="secondary" onClick={() => setCamera(true)}>
              📷 สแกน
            </BigButton>
          )}
        </form>
        {(recent.length > 0 || latest.length > 0) && (
          <div className="flex flex-col gap-1.5 text-xs text-slate-500">
            {recent.length > 0 && <QuickRow label="ค้นล่าสุด" items={recent} onPick={(q) => void run(q, 'new')} />}
            {latest.length > 0 && <QuickRow label="ใบรับล่าสุด" items={latest.map((g) => g.grnNo)} onPick={(q) => void run(q, 'new')} />}
          </div>
        )}
      </Card>

      {prev && (
        <button className="self-start text-sm font-semibold text-sky-700" onClick={() => void run(prev, 'back')}>
          ← กลับไป {prev}
        </button>
      )}
      {busy && <p className="py-6 text-center text-slate-500">กำลังตามรอย…</p>}
      {error && <Alert tone="bad">ตามรอยไม่สำเร็จ: {error}</Alert>}
      {!busy && !result && !error && <Intro compact={compact} />}
      {!busy && result && <ResultView r={result} compact={compact} links={links} onTrace={follow} />}
    </div>
  )
}

function QuickRow({ label, items, onPick }: { label: string; items: string[]; onPick: (q: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-20 shrink-0">{label}</span>
      {items.map((q) => (
        <button key={q} className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-[12px] text-slate-700 hover:bg-sky-50 hover:text-sky-800" onClick={() => onPick(q)}>
          {q}
        </button>
      ))}
    </div>
  )
}

/** ก่อนค้น: อธิบายว่าเลขเอกสารผูกกันเป็นสายอย่างไร */
function Intro({ compact }: { compact: boolean }) {
  const steps: ChainStep[] = [
    { key: 'pl', title: 'Packing List', code: 'เลข PL', lines: ['มากับรถ · AI อ่านจากรูป'], tone: 'ok' },
    { key: 'check', title: 'ใบตรวจรับ', code: 'CHK-…', lines: ['ตรวจทีละเคส'], tone: 'ok' },
    { key: 'grn', title: 'ใบรับสินค้า', code: 'GRN-…', lines: ['คู่กับ Invoice'], tone: 'ok' },
    { key: 'boxes', title: 'กล่อง & ป้าย QR', code: 'LPN-…', lines: ['1 เคส = 1 กล่อง'], tone: 'ok' },
    { key: 'issue', title: 'ใบเบิก', code: 'RQ-…', lines: ['ตัดกล่องเก่าก่อน'], tone: 'ok' },
    { key: 'fm005', title: 'FM-P-005', code: 'ยอดรวมจบวัน', lines: ['กระทบใบย่อย'], tone: 'ok' },
    { key: 'ledger', title: 'บัญชีคุม', code: 'FM-P-537', lines: ['ปิดยอดสิ้นเดือน'], tone: 'ok' },
  ]
  return (
    <Card title="เลขเอกสารทุกใบผูกกันเป็นสายเดียว" eyebrow="วิธีใช้">
      <Chain steps={steps} compact={compact} />
      <p className="text-sm text-slate-600">
        ค้นจากเลขไหนก็ได้ในสาย ระบบต่อให้ครบทั้งไปข้างหน้าและย้อนกลับ เช่น สแกนป้ายกล่องเพื่อดูว่ามาจาก PL ไหน หรือค้นเลขใบเบิกเพื่อดูว่าของมาจากใบรับไหน
      </p>
    </Card>
  )
}

function ResultView({ r, compact, links, onTrace }: { r: TraceResult; compact: boolean; links: TraceLinks; onTrace: OnTrace }) {
  switch (r.type) {
    case 'none':
      return <Alert tone="warn">ไม่พบ "{r.query}" · ลองเลขกล่อง LPN-…, GRN-…, ใบตรวจรับ CHK-…, ใบเบิก RQ-…, เลข Packing List, เลข Invoice, เลขใบเบิกกระดาษ หรือรหัส Part</Alert>
    case 'pick':
      return (
        <Card title="เลขนี้ตรงกับหลายเอกสาร" eyebrow="เลือกใบที่ต้องการ">
          <Options options={r.options} onTrace={onTrace} />
        </Card>
      )
    case 'receipt':
      return <ReceiptView t={r} compact={compact} links={links} onTrace={onTrace} />
    case 'req':
      return <ReqView t={r} compact={compact} links={links} onTrace={onTrace} />
    case 'part':
      return <PartView t={r} onTrace={onTrace} />
  }
}

function Options({ options, onTrace }: { options: TraceOption[]; onTrace: OnTrace }) {
  return (
    <ul className="flex flex-col divide-y divide-slate-100">
      {options.map((o) => (
        <li key={`${o.kind}-${o.id}`}>
          <button className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-slate-50" onClick={() => onTrace(o.query)}>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-slate-800">{o.title}</span>
              <span className="block truncate text-xs text-slate-500">{o.sub}</span>
            </span>
            {!o.active && <Pill tone="bad">ยกเลิก</Pill>}
            <span className="shrink-0 text-sm font-semibold text-sky-700">ตามรอย →</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

// ===== ภาพสายเอกสาร =====
const STEP_TONE: Record<StepTone, { card: string; dot: string; label: string }> = {
  ok: { card: 'border-emerald-300 bg-white', dot: 'bg-emerald-500', label: 'เรียบร้อย' },
  work: { card: 'border-sky-300 bg-sky-50', dot: 'bg-sky-500', label: 'กำลังดำเนินการ / รอทำต่อ' },
  warn: { card: 'border-amber-300 bg-amber-50', dot: 'bg-amber-500', label: 'มีเรื่องต้องดู' },
  bad: { card: 'border-rose-300 bg-rose-50', dot: 'bg-rose-600', label: 'ยกเลิก' },
  none: { card: 'border-dashed border-slate-300 bg-slate-50', dot: 'bg-slate-300', label: 'ไม่มีขั้นนี้' },
}

function Chain({ steps, compact, onStep }: { steps: ChainStep[]; compact: boolean; onStep?: (key: StepKey) => void }) {
  return (
    <ol className={compact ? 'flex flex-col' : 'flex items-stretch gap-1 overflow-x-auto pb-1'} aria-label="สายเอกสาร">
      {steps.map((s, i) => (
        <Fragment key={s.key}>
          {i > 0 &&
            (compact ? (
              <li aria-hidden className="ml-5 h-3 border-l-2 border-slate-300" />
            ) : (
              <li aria-hidden className="flex shrink-0 items-center text-lg font-bold text-slate-300">
                →
              </li>
            ))}
          <li className={compact ? '' : 'min-w-[132px] flex-1'}>
            <button
              type="button"
              disabled={!onStep}
              onClick={() => onStep?.(s.key)}
              className={`flex h-full w-full flex-col gap-0.5 rounded-lg border-2 p-2.5 text-left transition enabled:hover:shadow-md disabled:cursor-default ${STEP_TONE[s.tone].card}`}
            >
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                <i className={`h-2 w-2 shrink-0 rounded-full ${STEP_TONE[s.tone].dot}`} />
                {s.title}
              </span>
              <span className="break-all font-mono text-sm font-bold text-slate-800">{s.code ?? '—'}</span>
              {s.lines.filter(Boolean).map((l) => (
                <span key={l} className="text-xs leading-snug text-slate-600">
                  {l}
                </span>
              ))}
            </button>
          </li>
        </Fragment>
      ))}
    </ol>
  )
}

function ChainLegend() {
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
      {(Object.keys(STEP_TONE) as StepTone[]).map((k) => (
        <span key={k} className="inline-flex items-center gap-1">
          <i className={`h-2 w-2 rounded-full ${STEP_TONE[k].dot}`} />
          {STEP_TONE[k].label}
        </span>
      ))}
      <span>· แตะขั้นเพื่อดูรายละเอียด · แตะเลขเอกสารเพื่อตามต่อ</span>
    </p>
  )
}

/** เลื่อนไปที่รายละเอียดของขั้น (ขั้นที่ไม่มีการ์ดของตัวเองไปการ์ดที่ใกล้ที่สุด) */
const jump = (key: StepKey, fallback: StepKey[]) => {
  for (const k of [key, ...fallback]) {
    const el = document.getElementById(`trace-${k}`)
    if (el) return el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

const Anchor = ({ id, children }: { id: StepKey; children: ReactNode }) => (
  <div id={`trace-${id}`} className="min-w-0 scroll-mt-3">
    {children}
  </div>
)

const DocLink = ({ q, onTrace, children }: { q: string | null | undefined; onTrace: OnTrace; children?: ReactNode }) =>
  q ? (
    <button type="button" className="font-mono font-semibold text-sky-700 underline decoration-sky-200 underline-offset-2 hover:decoration-sky-500" onClick={() => onTrace(q)}>
      {children ?? q}
    </button>
  ) : (
    <span className="text-slate-400">-</span>
  )

// ===== ใบรับ: PL → ใบตรวจรับ → GRN → Invoice → กล่อง → ใบเบิก → บัญชีคุม =====
function ReceiptView({ t, compact, links, onTrace }: { t: ReceiptTrace; compact: boolean; links: TraceLinks; onTrace: OnTrace }) {
  const title = t.grn ? `ใบรับ ${t.grn.grnNo}` : t.check ? `ใบตรวจรับ ${t.check.checkNo}` : 'ใบรับ'
  const plRef = t.grn?.plRef ?? t.check?.plRef
  return (
    <>
      <Card title={title} eyebrow={plRef ? `สายเอกสารของ Packing List ${plRef}` : 'สายเอกสาร'}>
        <Chain steps={receiptSteps(t)} compact={compact} onStep={(k) => jump(k, k === 'pl' ? ['check', 'grn'] : ['grn'])} />
        <ChainLegend />
      </Card>
      {t.others.length > 0 && (
        <Card title="เลขนี้ยังตรงกับเอกสารอื่น" eyebrow="เช่น ใบที่ยกเลิกไปแล้ว">
          <Options options={t.others} onTrace={onTrace} />
        </Card>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {t.check && (
          <Anchor id="check">
            <CheckCard t={t} links={links} />
          </Anchor>
        )}
        {t.grn && (
          <Anchor id="grn">
            <GrnCard t={t} links={links} />
          </Anchor>
        )}
        {t.invoice && (
          <Anchor id="invoice">
            <InvoiceCard t={t} links={links} onTrace={onTrace} />
          </Anchor>
        )}
        <Anchor id="ledger">
          <ClosingCard closing={t.closing} links={links} />
        </Anchor>
      </div>
      <Anchor id="boxes">
        <BoxesCard boxes={t.boxes} focus={t.focus} links={links} onTrace={onTrace} />
      </Anchor>
      <Anchor id="issue">
        <ReqsCard reqs={t.reqs} onTrace={onTrace} />
      </Anchor>
    </>
  )
}

const CHECK_STATUS: Record<string, [string, Tone]> = { open: ['กำลังตรวจ', 'info'], done: ['ตรวจเสร็จ', 'ok'], cancelled: ['ยกเลิก', 'bad'] }

function CheckCard({ t, links }: { t: ReceiptTrace; links: TraceLinks }) {
  const c = t.check!
  const sum = checkSummary(t.checkLines)
  const issues = t.checkLines.filter((l) => lineIssues(l).length)
  const [label, tone] = CHECK_STATUS[c.status]
  return (
    <Card title={<span className="font-mono">{c.checkNo}</span>} eyebrow="ใบตรวจรับ" action={<Pill tone={tone}>{label}</Pill>}>
      <p className="text-sm text-slate-600">
        PL {c.plRef}
        {c.packages ? ` · ${c.packages}` : ''} · {c.modelCode ?? '-'}
        {c.replacement ? ' · รับของทดแทน' : ''}
        <br />
        <span className="text-xs text-slate-500">
          เปิดใบ {when(c.createdAt)} โดย {c.createdCode ?? '-'}
          {c.doneAt ? ` · ออก GRN ${when(c.doneAt)} โดย ${c.doneCode ?? '-'}` : ''}
          {c.cancelledAt ? ` · ยกเลิก ${when(c.cancelledAt)}: ${c.cancelReason ?? '-'}` : ''}
        </span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Pill tone="muted">
          เคส {sum.casesDone}/{sum.cases}
        </Pill>
        <Pill tone="muted">
          บรรทัด {sum.checked}/{sum.lines}
        </Pill>
        <Pill tone="muted">
          PL {fmt(sum.plQty)} · นับได้ {fmt(sum.actualQty)}
        </Pill>
        {sum.damagedQty > 0 && <Pill tone="warn">เสียหาย {fmt(sum.damagedQty)}</Pill>}
        {sum.issueLines > 0 ? <Pill tone="warn">ไม่ตรง PL {sum.issueLines} บรรทัด</Pill> : sum.checked === sum.lines && <Pill tone="ok">ตรง PL ทุกบรรทัด</Pill>}
      </div>
      {issues.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {issues.slice(0, 8).map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-amber-50 px-2 py-1">
              <span className="text-xs text-slate-500">{caseName(l.caseNo)}</span>
              <span className="font-mono font-semibold">{l.partNo}</span>
              <span className="tabular-nums">
                PL {fmt(l.plQty)} → จริง {fmt(l.actualQty)}
              </span>
              {lineIssues(l).map((i) => (
                <Pill key={i} tone="warn">
                  {ISSUE_LABEL[i]}
                </Pill>
              ))}
              {l.note && <span className="text-xs text-slate-500">{l.note}</span>}
            </li>
          ))}
          {issues.length > 8 && <li className="text-xs text-slate-500">และอีก {issues.length - 8} บรรทัด</li>}
        </ul>
      )}
      {links.check && (
        <BigButton tone="secondary" className="self-start" onClick={() => links.check!(c.id)}>
          เปิดใบตรวจรับ →
        </BigButton>
      )}
    </Card>
  )
}

function GrnCard({ t, links }: { t: ReceiptTrace; links: TraceLinks }) {
  const g = t.grn!
  const voided = g.status === 'void'
  return (
    <Card
      title={<span className="font-mono">{g.grnNo}</span>}
      eyebrow={g.grnNo.startsWith('CNT-') ? 'เอกสารกล่องใหม่จากการตรวจนับ' : 'ใบรับสินค้า (GRN)'}
      action={voided ? <Pill tone="bad">ยกเลิกแล้ว</Pill> : g.replacement ? <Pill tone="info">รับของทดแทน</Pill> : <Pill tone="ok">ใช้งาน</Pill>}
    >
      <p className="text-xs text-slate-500">
        รับ {when(g.receivedAt)} โดย {g.receiverCode ?? '-'} · {g.modelCode ?? '-'}
        {g.invoiceNo ? ` · Invoice ${g.invoiceNo}` : ''}
        {voided ? ` · ยกเลิก ${g.voidedAt ? when(g.voidedAt) : ''} โดย ${g.voidedCode ?? '-'}: ${g.voidReason ?? '-'}` : ''}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={thCls}>Part</th>
              <th className={thCls}>เคส</th>
              <th className={`${thCls} text-right`}>PL</th>
              <th className={`${thCls} text-right`}>นับได้</th>
              <th className={`${thCls} text-right`}>เสียหาย→NG</th>
            </tr>
          </thead>
          <tbody>
            {t.grnLines.map((l) => (
              <tr key={l.id}>
                <td className={`${tdCls} font-mono`}>
                  {l.partNo}
                  {l.needsQi && (
                    <span className="ml-1">
                      <Pill tone="mi3">MI3</Pill>
                    </span>
                  )}
                </td>
                <td className={tdCls}>{l.caseNo || '-'}</td>
                <td className={`${tdCls} text-right tabular-nums`}>{fmt(l.plQty)}</td>
                <td className={`${tdCls} text-right font-semibold tabular-nums ${l.countedQty !== l.plQty ? 'text-amber-700' : ''}`}>{fmt(l.countedQty)}</td>
                <td className={`${tdCls} text-right tabular-nums`}>{l.damagedQty ? fmt(l.damagedQty) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {links.grn && !voided && (
        <BigButton tone="secondary" className="self-start" onClick={() => links.grn!(g.id)}>
          ป้าย QR & พิมพ์ →
        </BigButton>
      )}
    </Card>
  )
}

const INVOICE_STATUS: Record<string, [string, Tone]> = {
  open: ['ยังไม่ปิด', 'info'],
  complete: ['รับครบแล้ว', 'ok'],
  discrepancy_reported: ['แจ้งความต่างแล้ว', 'warn'],
  closed: ['ปิดแล้ว', 'muted'],
}

function InvoiceCard({ t, links, onTrace }: { t: ReceiptTrace; links: TraceLinks; onTrace: OnTrace }) {
  const v = t.invoice!
  const off = reconcile(v).filter((r) => r.diff !== 0)
  const [label, tone] = INVOICE_STATUS[v.invoice.status]
  return (
    <Card title={<span className="font-mono">{v.invoice.invoiceNo}</span>} eyebrow="Invoice (กระทบยอดทุกใบรับรวมกัน)" action={<Pill tone={tone}>{label}</Pill>}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
        ใบรับของ Invoice นี้:
        {v.grns.map((g) => (
          <DocLink key={g.id} q={g.grnNo} onTrace={onTrace} />
        ))}
      </p>
      {off.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={thCls}>Part</th>
                <th className={`${thCls} text-right`}>Invoice</th>
                <th className={`${thCls} text-right`}>รับจริง</th>
                <th className={`${thCls} text-right`}>ต่าง</th>
              </tr>
            </thead>
            <tbody>
              {off.map((r) => (
                <tr key={`${r.lineNo}-${r.partNo}`}>
                  <td className={`${tdCls} font-mono`}>{r.partNo}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{fmt(r.invoiceQty)}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{fmt(r.receivedQty)}</td>
                  <td className={`${tdCls} text-right font-semibold tabular-nums ${r.diff < 0 ? 'text-rose-700' : 'text-amber-700'}`}>
                    {r.diff > 0 ? '+' : ''}
                    {fmt(r.diff)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Alert tone="ok">ยอดรับรวมทุกใบรับตรงกับ Invoice</Alert>
      )}
      {links.tab && (
        <BigButton tone="secondary" className="self-start" onClick={() => links.tab!('invoice')}>
          กระทบยอด Invoice →
        </BigButton>
      )}
    </Card>
  )
}

function ClosingCard({ closing, links }: { closing: ClosingRef | null; links: TraceLinks }) {
  const c = closingText(closing)
  const r = closing?.row
  return (
    <Card title={closing ? `${closing.model} · ${closing.month}` : 'บัญชีคุม'} eyebrow="บัญชีคุม FM-P-537">
      <p className="text-sm text-slate-700">{c.text}</p>
      {r && (
        <ul className="text-xs text-slate-500">
          {r.closedAt && (
            <li>
              ปิดยอด {when(r.closedAt)} โดย {r.closedBy ?? '-'}
            </li>
          )}
          <li>Planning รับทราบ: {r.planningAt ? `${when(r.planningAt)} · ${r.planningBy ?? '-'}` : 'ยัง'}</li>
          <li>บัญชีรับทราบ: {r.accountAt ? `${when(r.accountAt)} · ${r.accountBy ?? '-'}` : 'ยัง'}</li>
        </ul>
      )}
      {links.tab && closing && (
        <BigButton tone="secondary" className="self-start" onClick={() => links.tab!('ledger')}>
          เปิดบัญชีคุม →
        </BigButton>
      )}
    </Card>
  )
}

const PLACE_TONE: Record<BoxPlace, Tone> = { store: 'ok', staging: 'warn', mi3: 'mi3', ng: 'bad', gone: 'muted' }

const placeText = (b: TraceBox) =>
  b.place === 'gone' ? (b.lpn.status === 'active' ? PLACE_LABEL.gone : GONE_LABEL[b.lpn.status]) : `${PLACE_LABEL[b.place]} · ${b.lpn.locationCode}`

function BoxesCard({ boxes, focus, links, onTrace }: { boxes: TraceBox[]; focus: string | null; links: TraceLinks; onTrace: OnTrace }) {
  const [open, setOpen] = useState<string | null>(focus)
  const count = (p: BoxPlace) => boxes.filter((b) => b.place === p).length
  // กล่องที่ค้นมา: เลื่อนมาให้เห็น
  const focusRef = useRef<HTMLLIElement | null>(null)
  useEffect(() => {
    if (focus) focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focus])
  return (
    <Card title={`กล่องจากใบนี้ ${boxes.length} กล่อง`} eyebrow="ป้าย QR · อยู่ที่ไหนตอนนี้ · ประวัติทุกครั้งที่สแกน">
      {boxes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(['store', 'staging', 'mi3', 'ng', 'gone'] as BoxPlace[])
            .filter((p) => count(p))
            .map((p) => (
              <Pill key={p} tone={PLACE_TONE[p]}>
                {PLACE_LABEL[p]} {count(p)}
              </Pill>
            ))}
        </div>
      )}
      {!boxes.length ? (
        <p className="text-sm text-slate-500">ยังไม่มีกล่อง (ยังไม่ออก GRN หรือใบรับถูกยกเลิก)</p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100">
          {boxes.map((b) => {
            const isOpen = open === b.lpn.lpnNo
            const items = b.lpn.items.filter((i) => i.qty > 0)
            return (
              <li key={b.lpn.id} ref={b.lpn.lpnNo === focus ? focusRef : undefined} className={b.lpn.lpnNo === focus ? 'rounded-lg ring-2 ring-sky-300' : ''}>
                <button
                  className="flex w-full items-center gap-3 px-1 py-2.5 text-left hover:bg-slate-50"
                  onClick={() => setOpen(isOpen ? null : b.lpn.lpnNo)}
                  aria-expanded={isOpen}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-sm font-semibold text-slate-800">
                      {b.lpn.lpnNo}
                      {b.lpn.caseNo ? <span className="ml-1.5 font-sans text-xs font-normal text-slate-500">เคส {b.lpn.caseNo}</span> : null}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {items.length ? items.map((i) => `${i.partNo} × ${fmt(i.qty)}`).join(' · ') : 'ไม่มีของเหลือ'}
                      {b.issued ? ` · เบิกไปแล้ว ${fmt(b.issued)}` : ''}
                      {b.mergedInto ? ` · รวมเข้า ${b.mergedInto}` : ''}
                    </span>
                  </span>
                  <Pill tone={PLACE_TONE[b.place]}>{placeText(b)}</Pill>
                  <span className="shrink-0 text-slate-400">{isOpen ? '▲' : '▼'}</span>
                </button>
                {isOpen && <BoxTimeline box={b} links={links} onTrace={onTrace} />}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

const TX_DOT: Record<TxKind, string> = {
  RECEIVE: 'bg-sky-500',
  PUT: 'bg-emerald-500',
  MOVE: 'bg-emerald-400',
  ISSUE: 'bg-indigo-500',
  RETURN: 'bg-indigo-300',
  ADJ: 'bg-amber-500',
  COUNT: 'bg-slate-400',
  QI: 'bg-violet-500',
  MERGE: 'bg-slate-500',
  UNMERGE: 'bg-slate-500',
  SPLIT: 'bg-slate-500',
}

function BoxTimeline({ box, links, onTrace }: { box: TraceBox; links: TraceLinks; onTrace: OnTrace }) {
  return (
    <div className="mb-3 ml-2 flex flex-col gap-2">
      {box.events.length ? (
        <ol className="relative ml-1.5 border-l-2 border-slate-200 pl-4">
          {box.events.map((e) => (
            <li key={e.id} className="relative pb-3 last:pb-0">
              <i className={`absolute -left-[23px] top-1 h-3 w-3 rounded-full ring-2 ring-white ${TX_DOT[e.kind]}`} aria-hidden />
              <div className="text-[11px] text-slate-500">
                {when(e.createdAt)} · {e.createdCode ?? '-'}
                {e.status === 'pending' ? ' · รออนุมัติ' : e.status === 'rejected' ? ' · ไม่อนุมัติ' : ''}
              </div>
              <div className="text-sm text-slate-700">
                <b>{TX_LABEL[e.kind]}</b> {txSummary(e)}
              </div>
              {e.req && (
                <div className="text-xs text-slate-500">
                  {REQ_KIND[e.req.kind]} <DocLink q={e.req.reqNo} onTrace={onTrace} />
                  {e.req.docNo ? ` · ใบ ${e.req.docNo}` : ''}
                  {e.req.modelCode ? ` · ${e.req.modelCode}` : ''}
                  {e.req.status === 'void' ? ' · ยกเลิกแล้ว' : ''}
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-slate-500">ยังไม่มีความเคลื่อนไหว</p>
      )}
      {links.box && box.lpn.status === 'active' && (
        <BigButton tone="secondary" className="self-start !min-h-[40px] text-sm" onClick={() => links.box!(box.lpn.lpnNo)}>
          เปิดกล่องนี้ในหน้าสแกน →
        </BigButton>
      )}
    </div>
  )
}

function ReqsCard({ reqs, onTrace }: { reqs: ReqUse[]; onTrace: OnTrace }) {
  return (
    <Card title={`ใบเบิกที่ใช้ของจากใบนี้ ${reqs.length} ใบ`} eyebrow="เบิกเข้าไลน์ / QC / NG · กระทบ FM-P-005">
      {!reqs.length ? (
        <p className="text-sm text-slate-500">ยังไม่มีการเบิกของจากใบรับนี้</p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100">
          {reqs.map((u) => (
            <li key={u.key}>
              <button className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-slate-50" onClick={() => onTrace(u.reqNo)}>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-sm font-semibold text-slate-800">
                    {u.reqNo}
                    {u.docNo ? <span className="ml-1.5 font-sans text-xs font-normal text-slate-500">ใบ {u.docNo}</span> : null}
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {u.kind ? REQ_KIND[u.kind] : 'เบิก'} · {u.model ?? '-'} · {u.day} · {u.parts.join(', ')} · {u.boxes.length} กล่อง
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{fmt(u.qty)} ชิ้น</span>
                {u.void ? <Pill tone="bad">ยกเลิก</Pill> : u.kind === 'line' ? <Pill tone={u.reconciled ? 'ok' : 'warn'}>{u.reconciled ? 'กระทบแล้ว' : 'รอกระทบ'}</Pill> : null}
                <span className="shrink-0 text-sky-700">→</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ===== ใบเบิก: ย้อนกลับไปหาที่มา =====
function ReqView({ t, compact, links, onTrace }: { t: ReqTrace; compact: boolean; links: TraceLinks; onTrace: OnTrace }) {
  const r = t.req
  return (
    <>
      <Card
        title={
          <>
            {REQ_KIND[r.kind]} <span className="font-mono">{r.reqNo}</span>
          </>
        }
        eyebrow="ตามรอยย้อนกลับ: ของในใบเบิกนี้มาจากไหน"
        action={r.status === 'void' ? <Pill tone="bad">ยกเลิกแล้ว</Pill> : <Pill tone="ok">บันทึกแล้ว</Pill>}
      >
        <Chain steps={reqSteps(t)} compact={compact} onStep={(k) => jump(k, ['boxes'])} />
        <ChainLegend />
      </Card>
      {t.others.length > 0 && (
        <Card title="เลขนี้ยังตรงกับเอกสารอื่น">
          <Options options={t.others} onTrace={onTrace} />
        </Card>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <Anchor id="issue">
          <Card title="รายการในใบเบิก" eyebrow={`${r.docNo ? `ใบ ${r.docNo} · ` : ''}${r.modelCode ?? '-'} · ${r.docDate}`}>
            <p className="text-xs text-slate-500">
              บันทึก {when(r.createdAt)} โดย {r.createdCode ?? '-'}
              {r.toDept ? ` · ไป ${r.toDept}` : ''}
              {r.fgCode ? ` · FG ${r.fgCode}${r.fgQty ? ` × ${fmt(r.fgQty)} วง` : ''}` : ''}
              {r.note ? ` · ${r.note}` : ''}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={thCls}>Part</th>
                    <th className={`${thCls} text-right`}>{r.kind === 'fm005' ? 'ใบย่อยรวม' : 'ขอเบิก'}</th>
                    <th className={`${thCls} text-right`}>{r.kind === 'fm005' ? 'ในเอกสาร' : 'จ่ายจริง'}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l) => (
                    <tr key={l.partNo}>
                      <td className={`${tdCls} font-mono`}>
                        <DocLink q={l.partNo} onTrace={onTrace} />
                      </td>
                      <td className={`${tdCls} text-right tabular-nums`}>{fmt(l.reqQty)}</td>
                      <td className={`${tdCls} text-right font-semibold tabular-nums`}>{fmt(l.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </Anchor>
        <Anchor id="fm005">
          <Card title="FM-P-005" eyebrow="ยอดรวมจบวันกระทบกับใบย่อย">
            {r.kind === 'fm005' ? (
              <>
                <p className="text-sm text-slate-600">ใบย่อยที่กระทบ {t.subs.length} ใบ · ส่วนต่างตัดเพิ่มหรือคืนเข้าสต็อก</p>
                <ul className="flex flex-wrap gap-1.5">
                  {t.subs.map((s) => (
                    <li key={s.id}>
                      <DocLink q={s.reqNo} onTrace={onTrace} />
                      {s.docNo ? <span className="ml-1 text-xs text-slate-500">({s.docNo})</span> : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : r.kind !== 'line' ? (
              <p className="text-sm text-slate-500">ใบเบิก {REQ_KIND[r.kind]} ไม่ต้องกระทบกับ FM-P-005</p>
            ) : t.fm005 ? (
              <p className="text-sm text-slate-600">
                กระทบแล้วกับ <DocLink q={t.fm005.reqNo} onTrace={onTrace} />
                {t.fm005.docNo ? ` (ใบ ${t.fm005.docNo})` : ''}
              </p>
            ) : (
              <p className="text-sm text-amber-700">
                ยังไม่กระทบ · ธุรการกรอก FM-P-005 ของวัน {r.docDate} Model {r.modelCode ?? '-'} ตอนจบวัน
              </p>
            )}
            {links.tab && (
              <BigButton tone="secondary" className="self-start" onClick={() => links.tab!('issue')}>
                ไปหน้าเบิกเข้าไลน์ →
              </BigButton>
            )}
          </Card>
        </Anchor>
      </div>
      <Anchor id="boxes">
        <Card title="ของที่เบิกมาจากไหน" eyebrow="กล่อง → ใบรับ → Packing List / Invoice (ตัดกล่องที่รับเข้าก่อน)">
          {!t.sources.length ? (
            <p className="text-sm text-slate-500">ใบนี้ไม่ได้ตัดสต็อก (ยกเลิกแล้ว หรือ FM-P-005 ตรงกับใบย่อยพอดี)</p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100">
              {t.sources.map((s) => (
                <li key={`${s.lpnNo}-${s.partNo}-${s.reqNo}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="font-mono font-semibold">{s.partNo}</span>
                  <span className="font-semibold tabular-nums">{fmt(s.qty)} ชิ้น</span>
                  <span className="text-xs text-slate-500">จากกล่อง</span>
                  <DocLink q={s.lpnNo} onTrace={onTrace} />
                  {s.caseNo && <span className="text-xs text-slate-500">เคส {s.caseNo}</span>}
                  <span className="text-xs text-slate-500">← ใบรับ</span>
                  <DocLink q={s.grnNo} onTrace={onTrace} />
                  <span className="text-xs text-slate-500">← PL</span>
                  <DocLink q={s.plRef} onTrace={onTrace} />
                  {s.invoiceNo && (
                    <>
                      <span className="text-xs text-slate-500">· Invoice</span>
                      <DocLink q={s.invoiceNo} onTrace={onTrace} />
                    </>
                  )}
                  {r.kind === 'fm005' && s.reqNo !== r.reqNo && <span className="text-xs text-slate-400">(ใบย่อย {s.reqNo})</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Anchor>
      <Anchor id="ledger">
        <ClosingCard closing={t.closing} links={links} />
      </Anchor>
    </>
  )
}

// ===== Part: อยู่ที่ไหนตอนนี้ + เข้า-ออกล่าสุด =====
const COL_LABEL: Record<LedgerCol, string> = { recv: 'รับเข้า', recv_rep: 'รับทดแทน', issue: 'เบิก', ng: 'NG', qc: 'QC เบิก', adj: 'ปรับยอด' }

function PartView({ t, onTrace }: { t: PartTrace; onTrace: OnTrace }) {
  const p = t.part
  const total = t.boxes.reduce((s, b) => s + b.qty, 0)
  return (
    <>
      <Card
        title={
          <>
            <span className="font-mono">{p.partNo}</span> <span className="text-sm font-normal text-slate-500">{p.name}</span>
          </>
        }
        eyebrow="ตามรอย Part: อยู่ที่ไหนตอนนี้ และเข้า-ออกล่าสุด"
        action={p.uamCode ? <Pill tone="muted">UAM {p.uamCode}</Pill> : undefined}
      >
        <p className="text-sm text-slate-600">
          {p.type ?? '-'} · Model {p.models.join(', ') || '-'} · ในคลังทั้งหมด <b>{fmt(total)}</b> ชิ้น ใน {t.boxes.length} กล่อง
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(['store', 'staging', 'mi3', 'ng'] as BoxPlace[]).map((k) => (
            <Pill key={k} tone={t.byPlace[k] ? PLACE_TONE[k] : 'muted'}>
              {PLACE_LABEL[k]} {fmt(t.byPlace[k])}
            </Pill>
          ))}
        </div>
      </Card>
      <Card title={`กล่องที่มีของตอนนี้ ${t.boxes.length} กล่อง`} eyebrow="เรียงตามรับเข้าก่อน (ลำดับที่จะถูกเบิก)">
        {!t.boxes.length ? (
          <p className="text-sm text-slate-500">ไม่มีของในคลังตอนนี้</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100">
            {t.boxes.map((b) => (
              <li key={b.lpn.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <DocLink q={b.lpn.lpnNo} onTrace={onTrace} />
                <Pill tone={PLACE_TONE[b.place]}>
                  {PLACE_LABEL[b.place]} · {b.lpn.locationCode}
                </Pill>
                <span className="font-semibold tabular-nums">{fmt(b.qty)} ชิ้น</span>
                <span className="text-xs text-slate-500">ใบรับ</span>
                <DocLink q={b.lpn.grnNo} onTrace={onTrace} />
                {b.lpn.plRef && <span className="text-xs text-slate-500">PL {b.lpn.plRef}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="เข้า-ออกล่าสุด" eyebrow="จากบัญชีคุม FM-P-537 (ใหม่ → เก่า)">
        {!t.rows.length ? (
          <p className="text-sm text-slate-500">ยังไม่มีความเคลื่อนไหว</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={thCls}>เมื่อ</th>
                  <th className={thCls}>รายการ</th>
                  <th className={`${thCls} text-right`}>จำนวน</th>
                  <th className={thCls}>เอกสาร</th>
                  <th className={thCls}>Lot (ใบรับ)</th>
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r, i) => {
                  const d = ledgerDelta(r)
                  return (
                    <tr key={`${r.at}-${i}`}>
                      <td className={`${tdCls} whitespace-nowrap text-xs`}>{when(r.at)}</td>
                      <td className={tdCls}>{COL_LABEL[r.col]}</td>
                      <td className={`${tdCls} text-right font-semibold tabular-nums ${d < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                        {d > 0 ? '+' : ''}
                        {fmt(d)}
                      </td>
                      <td className={tdCls}>
                        <DocLink q={r.docNo} onTrace={onTrace} />
                        {r.invNo && <span className="ml-1 text-xs text-slate-500">Inv {r.invNo}</span>}
                      </td>
                      <td className={tdCls}>
                        <DocLink q={r.lot} onTrace={onTrace} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
