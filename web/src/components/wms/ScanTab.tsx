import { useCallback, useEffect, useRef, useState } from 'react'
import { errorText } from '../../wms/api'
import { fmt, lpnFromScan, TX_LABEL, txSummary } from '../../wms/logic'
import type { Grn, Lpn, Perm, ScanIssuePayload, Tx } from '../../wms/types'
import { useApprovals } from '../../wms/useApprovals'
import { useWms } from '../../wms/useWms'
import { zoneHeadOf } from '../../wms/labels'
import { useIsMobile } from '../../lib/viewMode'
import { QrScanner } from './QrScanner'
import { Alert, BigButton, Card, Field, inputCls, Pill, type Tone } from './ui'

type Mode = 'PUT' | 'MOVE' | 'ISSUE' | 'COUNT' | 'QI' | 'VIEW'

// 1 งาน = 1 โหมด: เบิกทุกแบบเป็นใบเบิก (FM-P-005 นับรวม) · ตรวจนับกับแก้ไขยอดรวมเป็นโหมดเดียว
const MODES: { k: Mode; name: string; hint: string; perm: Perm | null }[] = [
  { k: 'PUT', name: 'จัดเก็บเข้าที่', hint: 'สแกนกล่อง แล้วเลือกช่องเก็บ', perm: 'scan.put' },
  { k: 'MOVE', name: 'ย้ายที่', hint: 'ย้ายกล่องไปช่องใหม่ ยอดไม่เปลี่ยน', perm: 'scan.move' },
  { k: 'ISSUE', name: 'เบิก', hint: 'เข้าไลน์ / QC / NG · เป็นใบเบิก นับรวมใน FM-P-005', perm: 'scan.issue' },
  { k: 'COUNT', name: 'ตรวจนับ / แก้ไขยอด', hint: 'นับแล้วไม่ตรง ส่งขอปรับยอดได้ทันที', perm: 'scan.count' },
  { k: 'QI', name: 'ผลตรวจ MI3', hint: 'บันทึกจำนวนดี / NG ของ Rim, Hub', perm: 'scan.qi' },
  { k: 'VIEW', name: 'ดูข้อมูล', hint: 'ดูอย่างเดียว ไม่เปลี่ยนอะไร', perm: null },
]

const ISSUE_KINDS: { k: ScanIssuePayload['kind']; name: string; col: string }[] = [
  { k: 'line', name: 'เข้าไลน์', col: 'เบิก' },
  { k: 'qc', name: 'QC เบิก', col: 'QC เบิก' },
  { k: 'ng', name: 'NG / ส่งคืน', col: 'NG' },
]

const MODE_KEY = 'uam-scan-mode'
const loadMode = (): Mode => {
  try {
    const saved = localStorage.getItem(MODE_KEY)
    // โหมด "แก้ไขยอด" เดิมรวมอยู่ใน "ตรวจนับ / แก้ไขยอด"
    const m = saved === 'ADJ' ? 'COUNT' : saved
    return MODES.find((x) => x.k === m)?.k ?? 'PUT'
  } catch {
    return 'PUT'
  }
}
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0')

const TX_TONE: Record<Tx['kind'], Tone> = { RECEIVE: 'info', PUT: 'ok', MOVE: 'ok', ISSUE: 'info', ADJ: 'warn', COUNT: 'muted', QI: 'mi3', MERGE: 'muted', UNMERGE: 'muted', SPLIT: 'muted', RETURN: 'info' }
const time = (iso: string) => new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

interface Current {
  lpn: Lpn
  grn: Grn | null
  homeLocation: string | null
}

export function ScanTab({ initialCode, onOpenApprovals, onChanged }: { initialCode: string | null; onOpenApprovals?: () => void; onChanged?: () => void }) {
  const { api, master, can } = useWms()
  const mobile = useIsMobile()
  const [mode, setModeState] = useState<Mode>(loadMode)
  const [cur, setCur] = useState<Current | null>(null)
  const [code, setCode] = useState('')
  const [camera, setCamera] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'bad' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [tx, setTx] = useState<Tx[]>([])
  const [ver, setVer] = useState(0)
  const approvals = useApprovals(can('scan.adjust.approve'), ver)
  const [form, setForm] = useState({ item: '', qty: '', note: '', loc: '', reason: '', pass: '', ng: '0' })
  // ค่าการเบิกคงไว้ข้ามกล่อง: สแกนหลายกล่องของใบเบิกเดียวกันได้ต่อเนื่อง
  const [issue, setIssue] = useState<{ kind: ScanIssuePayload['kind']; model: string; doc: string; to: string }>({ kind: 'line', model: '', doc: '', to: '' })
  const scanInput = useRef<HTMLInputElement>(null)

  const setMode = (m: Mode) => {
    setModeState(m)
    setMsg(null)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      // ไม่มีที่เก็บ
    }
  }

  const refreshLists = useCallback(async () => {
    setTx(await api.recentTx(25))
    setVer((v) => v + 1)
  }, [api])

  const lookup = useCallback(
    async (raw: string) => {
      const no = lpnFromScan(raw)
      if (!no) return
      setCode(no)
      try {
        const found = await api.findLpn(no)
        if (!found) {
          setCur(null)
          setMsg({ tone: 'bad', text: `ไม่พบป้าย ${no} · ตรวจเลขบนป้าย หรือป้ายนี้อาจอยู่ในโหมดทดลองรอบก่อน` })
          return
        }
        setCur(found)
        setMsg(null)
        const item = found.lpn.items[0]
        setForm({ item: item?.id ?? '', qty: '', note: '', loc: found.lpn.hold ? '' : (found.homeLocation ?? ''), reason: '', pass: String(item?.qty ?? 0), ng: '0' })
        // Model ของการเบิก: คงค่าเดิมถ้า part อยู่ใน Model นั้น ไม่งั้นใช้ Model ของใบรับสินค้า
        const pm = master.parts.find((p) => p.partNo === item?.partNo)?.models ?? []
        const fits = (m: string | null | undefined): m is string => !!m && (!pm.length || pm.includes(m))
        const grnModel = found.grn?.modelCode
        setIssue((s) => (fits(s.model) ? s : { ...s, model: fits(grnModel) ? grnModel : pm.length === 1 ? pm[0] : '' }))
      } catch (e) {
        setMsg({ tone: 'bad', text: errorText(e) })
      }
    },
    [api, master.parts],
  )

  useEffect(() => {
    let alive = true
    api
      .recentTx(25)
      .then((t) => alive && setTx(t))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [api])

  useEffect(() => {
    if (initialCode) queueMicrotask(() => void lookup(initialCode))
  }, [initialCode, lookup])

  const lpn = cur?.lpn
  const item = lpn?.items.find((i) => i.id === form.item) ?? lpn?.items[0]
  const total = lpn?.items.reduce((s, i) => s + i.qty, 0) ?? 0
  const modeInfo = MODES.find((m) => m.k === mode)!
  const allowed = modeInfo.perm === null || can(modeInfo.perm)
  // เบิก: เลือก Model ได้เฉพาะ Model ของ part (part ที่ไม่ผูก Model เลือกได้ทุก Model)
  const partModels = item ? (master.parts.find((p) => p.partNo === item.partNo)?.models ?? []) : []
  const modelChoices = partModels.length ? [...partModels].sort() : master.models.map((m) => m.code)
  const issueModel = modelChoices.includes(issue.model) ? issue.model : ''
  const issueKind = ISSUE_KINDS.find((k) => k.k === issue.kind)!
  // ตรวจนับ: ส่วนต่างระหว่างที่นับกับยอดในระบบ
  const counted = form.qty === '' ? null : Math.floor(Number(form.qty))
  const countDiff = counted === null || !item ? 0 : counted - item.qty
  const canAdjust = can('scan.adjust')

  const run = async (fn: () => Promise<string>) => {
    setBusy(true)
    setMsg(null)
    try {
      const text = await fn()
      // โหลดกล่องใหม่ก่อน (lookup ล้างข้อความ) แล้วค่อยแสดงผล ไม่งั้นข้อความยืนยันหายทันที
      if (cur) await lookup(cur.lpn.lpnNo)
      await refreshLists()
      onChanged?.()
      setMsg({ tone: 'ok', text })
      scanInput.current?.focus()
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  const submit = () => {
    if (!lpn) return
    const n = (v: string) => Math.floor(Number(v))
    switch (mode) {
      case 'PUT':
      case 'MOVE':
        return run(async () => {
          await api.scanMove(lpn.id, form.loc, mode)
          return `${mode === 'PUT' ? 'จัดเก็บ' : 'ย้าย'} ${lpn.lpnNo} เข้า ${form.loc.toUpperCase()} แล้ว`
        })
      case 'ISSUE':
        return run(async () => {
          const q = n(form.qty)
          const r = await api.scanIssue({ itemId: item!.id, qty: q, kind: issue.kind, modelCode: issueModel || null, docNo: issue.doc.trim(), toDept: issue.to.trim() })
          const where = issue.kind === 'line' ? `${issueModel} · ตอนเย็น FM-P-005 นับรวมแล้ว ไม่ตัดซ้ำ` : `ลงช่อง ${issueKind.col} ในบัญชีคุม`
          return `${r.appended ? 'เพิ่มในใบเบิก' : 'ออกใบเบิก'} ${r.reqNo}${r.docNo ? ` (เลขใบเบิก ${r.docNo})` : ''} · ${item!.partNo} −${fmt(q)} · ${where}`
        })
      case 'COUNT':
        return run(async () => {
          const c = form.qty === '' ? NaN : n(form.qty)
          const diff = await api.scanCountItem(item!.id, c)
          if (diff === 0) return `${item!.partNo} นับได้ ${fmt(c)} · ตรงกับระบบ`
          if (!canAdjust) return `${item!.partNo} ต่างจากระบบ ${signed(diff)} · บันทึกการนับแล้ว · บัญชีนี้ส่งขอปรับยอดไม่ได้ แจ้งหัวหน้า`
          const doc = await api.scanAdjustRequest(item!.id, c, form.reason)
          return `${item!.partNo} ต่างจากระบบ ${signed(diff)} · ส่ง ${doc} ขออนุมัติแล้ว · ยอดเปลี่ยนหลังอนุมัติ (งานคลัง › 7 ตรวจนับ & อนุมัติ)`
        })
      case 'QI':
        return run(async () => {
          const doc = await api.scanQi(lpn.id, n(form.pass), n(form.ng), form.note.trim())
          return `${doc} บันทึกแล้ว · ปลดล็อกให้เบิกได้${cur?.homeLocation ? ` · ใช้โหมด "จัดเก็บเข้าที่" ย้ายไป ${cur.homeLocation}` : ''}`
        })
    }
  }

  const locChoices = [cur?.homeLocation, 'MI3-QC', 'NG-HOLD', 'RCV-01'].filter((x, i, a): x is string => !!x && a.indexOf(x) === i && x !== lpn?.locationCode)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-4">
        {mobile ? (
          <Card eyebrow="1 · เลือกงาน (ระบบจำไว้)">
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="radiogroup" aria-label="งานที่จะสแกน">
              {MODES.map((m) => {
                const ok = m.perm === null || can(m.perm)
                return (
                  <button
                    key={m.k}
                    role="radio"
                    aria-checked={mode === m.k}
                    onClick={() => setMode(m.k)}
                    className={`min-h-[44px] shrink-0 rounded-full px-4 text-sm font-semibold ring-1 ${mode === m.k ? 'bg-sky-700 text-white ring-sky-700' : 'bg-white text-slate-700 ring-slate-300'} ${ok ? '' : 'opacity-40'}`}
                  >
                    {m.name}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-slate-500">{MODES.find((m) => m.k === mode)?.hint}</p>
          </Card>
        ) : (
        <Card eyebrow="ขั้นที่ 1 · เลือกงานก่อนสแกน (ระบบจำโหมดไว้ สแกนกล่องถัดไปได้เลย)">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {MODES.map((m) => {
              const ok = m.perm === null || can(m.perm)
              return (
                <button
                  key={m.k}
                  aria-pressed={mode === m.k}
                  onClick={() => setMode(m.k)}
                  className={`flex min-h-[84px] flex-col items-start gap-0.5 rounded-xl border-2 p-2.5 text-left transition ${mode === m.k ? 'border-sky-700 bg-sky-50' : 'border-slate-200 bg-white hover:bg-slate-50'} ${ok ? '' : 'opacity-50'}`}
                >
                  <span className={`font-mono text-[11px] tracking-wider ${mode === m.k ? 'text-sky-700' : 'text-slate-400'}`}>{m.k}</span>
                  <span className="text-sm font-bold text-slate-800">{m.name}</span>
                  <span className="text-[11px] leading-tight text-slate-500">{ok ? m.hint : 'ไม่มีสิทธิ์'}</span>
                </button>
              )
            })}
          </div>
        </Card>
        )}

        <Card eyebrow={mobile ? '2 · สแกน QR ที่กล่อง' : 'ขั้นที่ 2 · สแกน QR ที่กล่อง'}>
          {camera && (
            <QrScanner
              onCode={(t) => {
                void lookup(t)
              }}
              onClose={() => setCamera(false)}
            />
          )}
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void lookup(code)
            }}
          >
            {!camera && (
              <BigButton type="button" onClick={() => setCamera(true)}>
                📷 เปิดกล้องสแกน
              </BigButton>
            )}
            <input
              ref={scanInput}
              id="scan-code"
              className={`${inputCls} min-w-[200px] flex-1 font-mono`}
              placeholder="หรือพิมพ์/ยิงเลขป้าย เช่น LPN-2610-000001"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
            />
            <BigButton type="submit" tone="secondary">
              ค้นหา
            </BigButton>
          </form>
        </Card>

        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

        {lpn && (
          <Card
            eyebrow={`โหมด ${mode} · ${modeInfo.name}`}
            title={<span className="font-mono text-xl">{lpn.lpnNo}</span>}
            action={
              <div className="text-right">
                <div className="font-mono text-2xl font-bold">{fmt(total)}</div>
                <div className="text-xs text-slate-500">ชิ้นในกล่อง</div>
              </div>
            }
          >
            <div className="text-sm text-slate-600">{lpn.items.map((i) => `${i.partNo} × ${fmt(i.qty)}`).join(' · ') || 'กล่องว่าง'}</div>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate-500">อยู่ที่</dt>
              <dd className="font-mono font-semibold">{lpn.locationCode}</dd>
              <dt className="text-slate-500">ช่องเก็บแนะนำ</dt>
              <dd className="font-mono">{cur?.homeLocation ?? '–'}</dd>
              <dt className="text-slate-500">หัวหน้าโซน</dt>
              <dd>{zoneHeadOf(master, lpn.locationCode)}</dd>
              <dt className="text-slate-500">สถานะ</dt>
              <dd>{lpn.status === 'merged' ? <Pill tone="muted">ถูกรวมเข้ากล่องอื่นแล้ว</Pill> : lpn.status === 'void' ? <Pill tone="muted">ยกเลิกแล้ว (ใช้ป้ายเดิมก่อนรวม)</Pill> : lpn.status === 'empty' ? <Pill tone="muted">ใช้หมดแล้ว</Pill> : lpn.hold ? <Pill tone="mi3">รอตรวจ MI3 · ห้ามเบิก</Pill> : <Pill tone="ok">พร้อมใช้</Pill>}</dd>
              <dt className="text-slate-500">ที่มา</dt>
              <dd className="font-mono text-xs">
                {cur?.grn ? `${cur.grn.grnNo} · PL ${cur.grn.plRef}${cur.grn.invoiceNo ? ` · INV ${cur.grn.invoiceNo}` : ''}` : '–'}
              </dd>
            </dl>

            {!allowed && mode !== 'VIEW' && <Alert tone="warn">บัญชีนี้ไม่มีสิทธิ์ทำโหมดนี้ · ให้ผู้ดูแลระบบเปิดสิทธิ์ในหน้าหลังบ้าน</Alert>}

            {allowed && lpn.items.length > 1 && (mode === 'ISSUE' || mode === 'COUNT') && (
              <Field label="Part ในกล่อง">
                <select id="scan-item" className={inputCls} value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })}>
                  {lpn.items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.partNo} · {fmt(i.qty)}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {allowed && (mode === 'PUT' || mode === 'MOVE') && (
              <>
                <Field label="ช่องปลายทาง (สแกน QR ที่ช่อง / พิมพ์ / เลือก)">
                  <input id="scan-loc" list="wms-locs" className={`${inputCls} font-mono uppercase`} value={form.loc} onChange={(e) => setForm({ ...form, loc: e.target.value })} placeholder="เช่น RK-C-01-1" />
                </Field>
                <div className="flex flex-wrap gap-2">
                  {locChoices.map((l) => (
                    <button key={l} type="button" onClick={() => setForm({ ...form, loc: l })} className="rounded-full bg-slate-100 px-3 py-1.5 font-mono text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-sky-50">
                      {l === cur?.homeLocation ? `แนะนำ ${l}` : l}
                    </button>
                  ))}
                </div>
                {lpn.hold && <Alert tone="warn">กล่องนี้รอตรวจ MI3 · ย้ายได้ แต่ยังเบิกไม่ได้จนกว่าจะผ่าน</Alert>}
                <BigButton disabled={busy || !form.loc.trim()} onClick={submit}>
                  ยืนยัน{modeInfo.name}
                </BigButton>
              </>
            )}

            {allowed && mode === 'ISSUE' &&
              (lpn.hold ? (
                <Alert tone="bad">เบิกไม่ได้ · กล่องนี้ยังไม่ผ่านการตรวจ MI3</Alert>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="เบิกไปที่">
                    {ISSUE_KINDS.map((k) => (
                      <button
                        key={k.k}
                        type="button"
                        role="radio"
                        aria-checked={issue.kind === k.k}
                        onClick={() => setIssue({ ...issue, kind: k.k })}
                        className={`min-h-[44px] rounded-full px-4 text-sm font-semibold ring-1 ${issue.kind === k.k ? 'bg-sky-700 text-white ring-sky-700' : 'bg-white text-slate-700 ring-slate-300'}`}
                      >
                        {k.name}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label={issue.kind === 'line' ? 'Model' : 'Model (ถ้ามี)'}>
                      <select id="scan-model" className={inputCls} value={issueModel} onChange={(e) => setIssue({ ...issue, model: e.target.value })}>
                        <option value="">{issue.kind === 'line' ? '— เลือก Model —' : '— ไม่ระบุ —'}</option>
                        {modelChoices.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={`จำนวนที่เบิก (มี ${fmt(item?.qty)})`}>
                      <input id="scan-qty" type="number" min={1} inputMode="numeric" className={`${inputCls} font-mono`} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
                    </Field>
                    <Field label="เลขใบเบิก (กระดาษ)">
                      <input id="scan-ref" className={inputCls} value={issue.doc} onChange={(e) => setIssue({ ...issue, doc: e.target.value })} placeholder="ว่าง = ระบบออกเลข RQ ให้" />
                    </Field>
                    <Field label="ปลายทาง">
                      <input
                        id="scan-note"
                        list="wms-lines"
                        className={inputCls}
                        value={issue.to}
                        onChange={(e) => setIssue({ ...issue, to: e.target.value })}
                        placeholder={issue.kind === 'line' ? 'เช่น ไลน์ประกอบ Bigbike ชั้น 2' : issue.kind === 'qc' ? 'เช่น QC ตรวจสอบ' : 'เช่น ส่งคืน supplier'}
                      />
                    </Field>
                  </div>
                  <p className="text-xs text-slate-500">
                    {issue.kind === 'line' ? 'บันทึกเป็นใบเบิกย่อยของ Model นี้ · ตอนเย็น FM-P-005 นับรวม ไม่ตัดซ้ำ' : `ลงช่อง "${issueKind.col}" ในบัญชีคุม FM-P-537`} · สแกนกล่องถัดไปด้วยเลขใบเบิกเดิม = ต่อท้ายใบเดียวกัน
                  </p>
                  <BigButton disabled={busy || !(Number(form.qty) > 0) || (issue.kind === 'line' && !issueModel)} onClick={submit}>
                    ยืนยันเบิก
                  </BigButton>
                </>
              ))}

            {allowed && mode === 'COUNT' && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={`นับได้ / ยอดที่ถูกต้อง (ระบบ ${fmt(item?.qty)})`}>
                    <input id="scan-qty" type="number" min={0} inputMode="numeric" className={`${inputCls} font-mono`} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
                  </Field>
                  {countDiff !== 0 && canAdjust && (
                    <Field label="เหตุผลที่ไม่ตรง">
                      <select id="scan-reason" className={inputCls} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                        <option value="">— เลือก —</option>
                        <option>นับใหม่แล้วไม่ตรง</option>
                        <option>ของเสียหาย</option>
                        <option>บันทึกผิด</option>
                        <option>อื่น ๆ</option>
                      </select>
                    </Field>
                  )}
                </div>
                {counted !== null &&
                  (countDiff === 0 ? (
                    <Alert tone="ok">ตรงกับระบบ</Alert>
                  ) : (
                    <Alert tone="warn">
                      ต่างจากระบบ {signed(countDiff)} ชิ้น ·{' '}
                      {canAdjust ? 'กดปุ่มด้านล่างเพื่อบันทึกการนับและส่งขอปรับยอดในครั้งเดียว · ยอดเปลี่ยนหลังผู้มีสิทธิ์อนุมัติ (คนขอกับคนอนุมัติต้องเป็นคนละคน)' : 'บัญชีนี้ส่งขอปรับยอดไม่ได้ · บันทึกการนับไว้ แล้วแจ้งหัวหน้า'}
                    </Alert>
                  ))}
                <BigButton disabled={busy || counted === null || (countDiff !== 0 && canAdjust && !form.reason)} onClick={submit}>
                  {countDiff !== 0 && canAdjust ? 'บันทึกการนับ + ส่งขอปรับยอด' : 'บันทึกการนับ'}
                </BigButton>
              </>
            )}

            {allowed && mode === 'QI' &&
              (!lpn.hold ? (
                <Alert tone="ok">กล่องนี้ไม่ต้องตรวจ หรือผ่านการตรวจแล้ว</Alert>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="ผ่าน (ดี)">
                      <input id="scan-pass" type="number" min={0} inputMode="numeric" className={`${inputCls} font-mono`} value={form.pass} onChange={(e) => setForm({ ...form, pass: e.target.value })} />
                    </Field>
                    <Field label="NG">
                      <input id="scan-ng" type="number" min={0} inputMode="numeric" className={`${inputCls} font-mono`} value={form.ng} onChange={(e) => setForm({ ...form, ng: e.target.value })} />
                    </Field>
                    <Field label="อาการ NG / หมายเหตุ">
                      <input id="scan-qi-note" className={inputCls} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                    </Field>
                  </div>
                  <p className="text-xs text-slate-500">ผ่าน + NG ต้องเท่ากับ {fmt(total)} ชิ้น · ของดีปลดล็อกให้เบิกได้</p>
                  <BigButton disabled={busy || Number(form.pass) + Number(form.ng) !== total} onClick={submit}>
                    บันทึกผลตรวจ
                  </BigButton>
                </>
              ))}
          </Card>
        )}

        <datalist id="wms-locs">
          {master.locations
            .filter((l) => l.active)
            .map((l) => (
              <option key={l.code} value={l.code} />
            ))}
        </datalist>
        <datalist id="wms-lines">
          <option value="ไลน์ประกอบ Bigbike ชั้น 2" />
        </datalist>
      </div>

      <div className="flex flex-col gap-4">
        {can('scan.adjust.approve') && approvals.total > 0 && (
          <Card title={`รออนุมัติปรับยอด (${approvals.total})`}>
            <p className="text-sm text-slate-600">
              คำขอจากหน้าสแกน {approvals.adj.length} · ใบตรวจนับ Excel {approvals.pendingSheets.length}
            </p>
            {onOpenApprovals ? (
              <BigButton onClick={onOpenApprovals}>ไปหน้าอนุมัติ</BigButton>
            ) : (
              <p className="text-xs text-slate-500">อนุมัติได้ที่หน้าคอม: งานคลัง › 7 ตรวจนับ & อนุมัติ</p>
            )}
          </Card>
        )}
        <Card title="ความเคลื่อนไหวล่าสุด">
          <div className="flex max-h-[70vh] flex-col overflow-y-auto">
            {tx.length === 0 && <p className="text-sm text-slate-500">ยังไม่มีรายการ · ทุกการสแกนบันทึกผู้ทำและเวลา</p>}
            {tx.map((t) => (
              <button key={t.id} onClick={() => t.lpnNo && void lookup(t.lpnNo)} className="grid grid-cols-[auto_1fr] gap-x-2 border-b border-slate-100 py-2 text-left text-xs last:border-0 hover:bg-slate-50">
                <Pill tone={TX_TONE[t.kind]}>{TX_LABEL[t.kind]}</Pill>
                <span className="min-w-0">
                  <span className="font-mono font-semibold">{t.lpnNo ?? ''}</span> {txSummary(t)}
                  <span className="block text-slate-400">
                    {time(t.createdAt)} · {t.createdCode}
                    {t.docNo ? ` · ${t.docNo}` : ''}
                    {t.status === 'pending' ? ' · รออนุมัติ' : t.status === 'approved' ? ` · อนุมัติโดย ${t.decidedCode}` : t.status === 'rejected' ? ' · ไม่อนุมัติ' : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
