import { useCallback, useEffect, useRef, useState } from 'react'
import { errorText } from '../../wms/api'
import { fmt, lpnFromScan, TX_LABEL, txSummary } from '../../wms/logic'
import type { Grn, Lpn, Perm, ScanIssuePayload, Tx } from '../../wms/types'
import { RELOAD_FAILED, saveThenReload } from '../../wms/afterSave'
import { useApprovals } from '../../wms/useApprovals'
import { useWms } from '../../wms/useWms'
import { zoneHeadOf } from '../../wms/labels'
import { useIsMobile } from '../../lib/viewMode'
import { cue, setSoundOn, soundOn } from '../../lib/scanFeedback'
import { QrScanner } from './QrScanner'
import { TraceButton } from './TraceButton'
import { Alert, BigButton, Card, Field, inputCls, Pill, type Tone } from './ui'

export type ScanMode = 'PUT' | 'MOVE' | 'ISSUE' | 'COUNT' | 'QI' | 'VIEW'
type Mode = ScanMode

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
const saveMode = (m: Mode) => {
  try {
    localStorage.setItem(MODE_KEY, m)
  } catch {
    // ไม่มีที่เก็บ
  }
}
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0')

const TX_TONE: Record<Tx['kind'], Tone> = { RECEIVE: 'info', PUT: 'ok', MOVE: 'ok', ISSUE: 'info', ADJ: 'warn', COUNT: 'muted', QI: 'mi3', MERGE: 'muted', UNMERGE: 'muted', SPLIT: 'muted', RETURN: 'info' }
const time = (iso: string) => new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })

interface Current {
  lpn: Lpn
  grn: Grn | null
  homeLocation: string | null
}

export function ScanTab({
  initialCode,
  initialMode,
  onOpenApprovals,
  onChanged,
}: {
  initialCode: string | null
  /** เปิดมาที่งานนี้ (จากหน้างานวันนี้) แทนงานที่จำไว้ */
  initialMode?: ScanMode
  onOpenApprovals?: () => void
  onChanged?: () => void
}) {
  const { api, master, can } = useWms()
  const mobile = useIsMobile()
  const [mode, setModeState] = useState<Mode>(() => {
    if (!initialMode) return loadMode()
    // เปิดดูกล่องจากหน้าอื่น (ตามรอย) ไม่เปลี่ยนงานที่จำไว้
    if (initialMode !== 'VIEW') saveMode(initialMode)
    return initialMode
  })
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
  // ตรวจนับแบบไม่เห็นยอด: ผลการนับล่าสุดที่ไม่ตรงกับระบบ (ใช้ส่งขอปรับยอด)
  // นับไม่ตรง: revealed = บอกยอดระบบแล้ว (นับครั้งที่ 2 ขึ้นไป) · first = ยอดที่นับครั้งก่อน
  const [miss, setMiss] = useState<{ itemId: string; partNo: string; counted: number; system: number; revealed: boolean; first?: number } | null>(null)
  const [sound, setSound] = useState(soundOn)
  const scanInput = useRef<HTMLInputElement>(null)
  const boxCard = useRef<HTMLDivElement>(null)
  const mobileRef = useRef(mobile)
  useEffect(() => {
    mobileRef.current = mobile
  }, [mobile])
  // กล่องในพื้นที่กัก NG: ไม่แนะนำช่องเก็บของดี และเบิกเข้าไลน์ไม่ได้
  const inNg = useCallback((code: string | undefined) => master.locations.find((l) => l.code === code)?.kind === 'ng', [master.locations])

  const setMode = (m: Mode) => {
    setModeState(m)
    setMsg(null)
    setMiss(null)
    saveMode(m)
  }

  const refreshLists = useCallback(async () => {
    setTx(await api.recentTx(25))
    setVer((v) => v + 1)
  }, [api])

  /**
   * quiet = โหลดกล่องเดิมซ้ำหลังบันทึก (ไม่มีเสียงสแกน คง part ที่เลือกไว้ ไม่ล้างข้อความผลบันทึก)
   * โหลดไม่สำเร็จตอน quiet ⇒ โยน error ให้ผู้เรียกตัดสิน (การบันทึกสำเร็จไปแล้ว ห้ามขึ้นว่าล้มเหลว)
   */
  const lookup = useCallback(
    async (raw: string, quiet = false) => {
      const no = lpnFromScan(raw)
      if (!no) return
      setCode(no)
      try {
        const found = await api.findLpn(no)
        if (!found) {
          setCur(null)
          if (quiet) return
          setMsg({ tone: 'bad', text: `ไม่พบป้าย ${no} · ตรวจเลขบนป้าย หรือป้ายนี้อาจอยู่ในโหมดทดลองรอบก่อน` })
          cue('bad')
          return
        }
        setCur(found)
        if (!quiet) {
          setMsg(null)
          cue('scan')
          // มือถือ: เลื่อนให้เห็นกล่องกับปุ่มยืนยันทันที (ไม่ต้องเลื่อนหาเอง)
          if (mobileRef.current) requestAnimationFrame(() => boxCard.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
        }
        const item = found.lpn.items[0]
        const inBox = (id: string) => found.lpn.items.some((i) => i.id === id)
        setForm((f) => {
          const itemId = quiet && inBox(f.item) ? f.item : (item?.id ?? '')
          const qty = found.lpn.items.find((i) => i.id === itemId)?.qty ?? 0
          return { item: itemId, qty: '', note: '', loc: found.lpn.hold || inNg(found.lpn.locationCode) ? '' : (found.homeLocation ?? ''), reason: '', pass: String(qty), ng: '0' }
        })
        setMiss((m) => (quiet && m && inBox(m.itemId) ? m : null))
        // Model ของการเบิก: คงค่าเดิมถ้า part อยู่ใน Model นั้น ไม่งั้นใช้ Model ของใบรับสินค้า
        const pm = master.parts.find((p) => p.partNo === item?.partNo)?.models ?? []
        const fits = (m: string | null | undefined): m is string => !!m && (!pm.length || pm.includes(m))
        const grnModel = found.grn?.modelCode
        setIssue((s) => (fits(s.model) ? s : { ...s, model: fits(grnModel) ? grnModel : pm.length === 1 ? pm[0] : '' }))
      } catch (e) {
        if (quiet) throw e
        setMsg({ tone: 'bad', text: errorText(e) })
        cue('bad')
      }
    },
    [api, master.parts, inNg],
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
  const canAdjust = can('scan.adjust')
  const missHere = miss && miss.itemId === item?.id ? miss : null

  /** fn คืนข้อความยืนยัน (หรือ tone warn เมื่อต้องตรวจเพิ่ม) */
  const run = async (fn: () => Promise<string | { tone: 'ok' | 'warn'; text: string }>) => {
    setBusy(true)
    setMsg(null)
    try {
      // บันทึกสำเร็จ ⇒ บอกผลทันที · โหลดกล่อง/รายการใหม่พลาด ไม่ใช่การบันทึกล้มเหลว (กันกดซ้ำแล้วตัดสต็อกซ้ำ)
      let boxStale = false
      const { value: done, reloadFailed } = await saveThenReload(
        async () => {
          const r = await fn()
          return typeof r === 'string' ? { tone: 'ok' as const, text: r } : r
        },
        (d) => {
          setMsg(d)
          cue(d.tone)
          onChanged?.()
        },
        [
          () =>
            cur &&
            lookup(cur.lpn.lpnNo, true).catch((e: unknown) => {
              boxStale = true
              throw e
            }),
          refreshLists,
        ],
      )
      if (reloadFailed) {
        // ยอดกล่องบนจอเป็นยอดก่อนบันทึก ⇒ ซ่อนไว้ ไม่ให้ทำรายการต่อจากยอดเก่า
        if (boxStale) setCur(null)
        setMsg({ tone: done.tone, text: `${done.text} · ${RELOAD_FAILED} · สแกนกล่องอีกครั้งเพื่อดูยอดล่าสุด` })
      }
      scanInput.current?.focus()
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
      cue('bad')
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
        // นับแบบไม่เห็นยอด: ครั้งแรกไม่ตรงบอกแค่ "นับซ้ำ" (ไม่บอกยอดระบบ ให้นับซ้ำจริง ๆ) · ครั้งที่ 2 ค่อยบอกยอดระบบ แล้วส่งขอปรับยอด
        return run(async () => {
          const c = form.qty === '' ? NaN : n(form.qty)
          const diff = await api.scanCountItem(item!.id, c)
          const prev = miss && miss.itemId === item!.id ? miss : null
          if (diff === 0) {
            setMiss(null)
            return `${item!.partNo} นับได้ ${fmt(c)} · ตรงกับระบบ${prev ? ` (ครั้งก่อนนับได้ ${fmt(prev.counted)})` : ''}`
          }
          if (!prev) {
            setMiss({ itemId: item!.id, partNo: item!.partNo, counted: c, system: c - diff, revealed: false })
            return { tone: 'warn', text: `${item!.partNo} นับได้ ${fmt(c)} · ไม่ตรงกับระบบ · นับซ้ำอีกครั้งตั้งแต่ต้น (ระบบบอกยอดหลังนับครั้งที่ 2)` }
          }
          setMiss({ itemId: item!.id, partNo: item!.partNo, counted: c, system: c - diff, revealed: true, first: prev.counted })
          const twice = prev.counted === c ? 'สองครั้งได้เท่ากัน' : `ครั้งก่อนได้ ${fmt(prev.counted)} · สองครั้งไม่เท่ากัน นับอีกรอบให้แน่ก่อน`
          return { tone: 'warn', text: `${item!.partNo} นับซ้ำได้ ${fmt(c)} (${twice}) · ระบบมี ${fmt(c - diff)} (ต่าง ${signed(diff)}) · ${canAdjust ? 'ส่งขอปรับยอดด้านล่าง' : 'แจ้งหัวหน้าโซน'}` }
        })
      case 'QI':
        return run(async () => {
          const doc = await api.scanQi(lpn.id, n(form.pass), n(form.ng), form.note.trim())
          return `${doc} บันทึกแล้ว · ปลดล็อกให้เบิกได้${cur?.homeLocation ? ` · ใช้โหมด "${can('scan.put') ? 'จัดเก็บเข้าที่' : 'ย้ายที่'}" ย้ายไป ${cur.homeLocation}` : ''}`
        })
    }
  }

  const requestAdjust = (m: NonNullable<typeof miss>) =>
    run(async () => {
      const doc = await api.scanAdjustRequest(m.itemId, m.counted, form.reason)
      setMiss(null)
      return `${m.partNo} ส่ง ${doc} ขอปรับยอดเป็น ${fmt(m.counted)} แล้ว · ยอดเปลี่ยนหลังผู้มีสิทธิ์อนุมัติ (งานคลัง › 7 ตรวจนับ & อนุมัติ)`
    })

  /** กล้อง/เครื่องยิงอ่านได้ป้ายช่องเก็บ ⇒ ใส่เป็นช่องปลายทาง (จัดเก็บ / ย้าย) แทนการค้นกล่อง */
  const onScanText = (raw: string) => {
    const slot = master.locations.find((l) => l.code === raw.trim().toUpperCase())
    if (!slot) return void lookup(raw)
    if (lpn && (mode === 'PUT' || mode === 'MOVE')) {
      setForm((f) => ({ ...f, loc: slot.code }))
      setMsg({ tone: 'info', text: `ช่องปลายทาง ${slot.code} · ตรวจแล้วกดยืนยัน` })
      cue('scan')
    } else {
      setMsg({ tone: 'warn', text: `${slot.code} เป็นป้ายช่องเก็บ · สแกนป้ายกล่องก่อน${mode === 'PUT' || mode === 'MOVE' ? ' แล้วค่อยสแกนป้ายช่อง' : ''}` })
      cue('warn')
    }
  }

  const home = inNg(lpn?.locationCode) ? null : (cur?.homeLocation ?? null)
  // กล่องในพื้นที่ NG ออกไปช่องของดีได้เฉพาะ MI3 (ตรวจซ้ำแล้วผ่าน) · ช่องปลายทางต้องมีและเปิดใช้ (scan_move 0024)
  const ngBox = !!lpn && inNg(lpn.locationCode) && !can('scan.qi')
  const destCode = form.loc.trim().toUpperCase()
  const destLoc = master.locations.find((l) => l.code === destCode)
  const destBad = !!destCode && (!destLoc || !destLoc.active || destLoc.blocked)
  const ngLocked = ngBox && !!destLoc && destLoc.kind !== 'ng'
  const locChoices = [home, 'MI3-QC', 'NG-HOLD', 'RCV-01'].filter((x, i, a): x is string => !!x && a.indexOf(x) === i && x !== lpn?.locationCode && (!ngBox || inNg(x)))

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-4">
        {mobile ? (
          <Card eyebrow="1 · เลือกงาน (ระบบจำไว้)">
            <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="งานที่จะสแกน">
              {MODES.map((m) => {
                const ok = m.perm === null || can(m.perm)
                return (
                  <button
                    key={m.k}
                    role="radio"
                    aria-checked={mode === m.k}
                    onClick={() => setMode(m.k)}
                    className={`min-h-[48px] rounded-xl px-1.5 text-[13px] font-semibold leading-tight ring-1 ${mode === m.k ? 'bg-sky-700 text-white ring-sky-700' : 'bg-white text-slate-700 ring-slate-300'} ${ok ? '' : 'opacity-40'}`}
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
                  <span className={`text-sm font-bold ${mode === m.k ? 'text-sky-800' : 'text-slate-800'}`}>{m.name}</span>
                  <span className="text-[11px] leading-tight text-slate-500">{ok ? m.hint : 'ไม่มีสิทธิ์'}</span>
                </button>
              )
            })}
          </div>
        </Card>
        )}

        <Card eyebrow={mobile ? '2 · สแกน QR ที่กล่อง' : 'ขั้นที่ 2 · สแกน QR ที่กล่อง'}>
          {camera && (
            <QrScanner onCode={onScanText}
              onClose={() => setCamera(false)}
            />
          )}
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              onScanText(code)
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
            <button
              type="button"
              aria-pressed={sound}
              title="เสียงและสั่นตอนสแกน (จำไว้ในเครื่องนี้)"
              onClick={() => {
                setSoundOn(!sound)
                setSound(!sound)
                if (!sound) queueMicrotask(() => cue('scan'))
              }}
              className="min-h-[44px] rounded-lg px-3 text-sm font-semibold text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
            >
              {sound ? '🔊 เสียงเปิด' : '🔇 ปิดเสียง'}
            </button>
          </form>
        </Card>

        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

        {lpn && (
          <div ref={boxCard} className="scroll-mt-2">
          <Card
            eyebrow={`งาน: ${modeInfo.name}`}
            title={<span className="font-mono text-xl">{lpn.lpnNo}</span>}
            action={
              mode === 'COUNT' ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">นับแบบไม่เห็นยอด</span>
              ) : (
                <div className="text-right">
                  <div className="font-mono text-2xl font-bold">{fmt(total)}</div>
                  <div className="text-xs text-slate-500">ชิ้นในกล่อง</div>
                </div>
              )
            }
          >
            <div className="text-sm text-slate-600">{lpn.items.map((i) => (mode === 'COUNT' ? i.partNo : `${i.partNo} × ${fmt(i.qty)}`)).join(' · ') || 'กล่องว่าง'}</div>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate-500">อยู่ที่</dt>
              <dd className="font-mono font-semibold">{lpn.locationCode}</dd>
              <dt className="text-slate-500">ช่องเก็บแนะนำ</dt>
              <dd className="font-mono">{home ?? '–'}</dd>
              <dt className="text-slate-500">หัวหน้าโซน</dt>
              <dd>{zoneHeadOf(master, lpn.locationCode)}</dd>
              <dt className="text-slate-500">สถานะ</dt>
              <dd>{lpn.status === 'merged' ? <Pill tone="muted">ถูกรวมเข้ากล่องอื่นแล้ว</Pill> : lpn.status === 'void' ? <Pill tone="muted">{cur?.grn?.status === 'void' ? `ใบรับ ${cur.grn.grnNo} ถูกยกเลิก · แกะป้ายนี้ออก` : 'ยกเลิกแล้ว (ใช้ป้ายเดิมก่อนรวม)'}</Pill> : lpn.status === 'empty' ? <Pill tone="muted">ใช้หมดแล้ว</Pill> : lpn.hold ? <Pill tone="mi3">รอตรวจ MI3 · ห้ามเบิก</Pill> : inNg(lpn.locationCode) ? <Pill tone="bad">พื้นที่กัก NG · ห้ามเข้าไลน์</Pill> : <Pill tone="ok">พร้อมใช้</Pill>}</dd>
              <dt className="text-slate-500">ที่มา</dt>
              <dd className="font-mono text-xs">
                {cur?.grn ? `${cur.grn.grnNo} · PL ${cur.grn.plRef}${lpn.caseNo ? ` · เคส ${lpn.caseNo}` : ''}${cur.grn.invoiceNo ? ` · INV ${cur.grn.invoiceNo}` : ''}` : '–'}
              </dd>
            </dl>
            <TraceButton query={lpn.lpnNo} label="ตามรอยกล่องนี้ (มาจากไหน · ไปไหน)" className="self-start" />

            {!allowed && mode !== 'VIEW' && <Alert tone="warn">บัญชีนี้ไม่มีสิทธิ์ทำโหมดนี้ · ให้ผู้ดูแลระบบเปิดสิทธิ์ในหน้าหลังบ้าน</Alert>}

            {allowed && lpn.items.length > 1 && (mode === 'ISSUE' || mode === 'COUNT') && (
              <Field label="Part ในกล่อง">
                <select id="scan-item" className={inputCls} value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })}>
                  {lpn.items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {mode === 'COUNT' ? i.partNo : `${i.partNo} · ${fmt(i.qty)}`}
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
                    <button key={l} type="button" onClick={() => setForm({ ...form, loc: l })} className="min-h-[44px] rounded-full bg-slate-100 px-4 font-mono text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-sky-50">
                      {l === home ? `แนะนำ ${l}` : l}
                    </button>
                  ))}
                </div>
                {lpn.hold && <Alert tone="warn">กล่องนี้รอตรวจ MI3 · ย้ายได้ แต่ยังเบิกไม่ได้จนกว่าจะผ่าน</Alert>}
                {destBad && <Alert tone="warn">ไม่พบช่อง {destCode} หรือช่องนี้ปิดใช้อยู่ · สแกน QR ที่ช่อง หรือเลือกจากรายการ</Alert>}
                {ngBox && (
                  <Alert tone={ngLocked ? 'bad' : 'warn'}>กล่องนี้อยู่พื้นที่กัก NG · ย้ายได้เฉพาะในพื้นที่ NG · ออกไปช่องของดีได้เฉพาะ MI3 (ตรวจซ้ำแล้วผ่าน) · ส่งคืน/ตัดทิ้งใช้ใบเบิก NG</Alert>
                )}
                <BigButton disabled={busy || !destCode || destBad || ngLocked} onClick={submit}>
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
                  {issue.kind === 'line' && inNg(lpn.locationCode) && <Alert tone="warn">กล่องนี้อยู่พื้นที่กัก NG · เบิกเข้าไลน์ไม่ได้ เลือก "NG / ส่งคืน" หรือ "QC เบิก"</Alert>}
                  <BigButton disabled={busy || !(Number(form.qty) > 0) || (issue.kind === 'line' && (!issueModel || inNg(lpn.locationCode)))} onClick={submit}>
                    ยืนยันเบิก
                  </BigButton>
                </>
              ))}

            {allowed && mode === 'COUNT' && (
              <>
                <p className="text-xs text-slate-500">นับของจริงแล้วใส่จำนวน ระบบบอกผลหลังบันทึก · ไม่ตรง ⇒ นับซ้ำอีกครั้งก่อนส่งขอปรับยอด</p>
                <Field label={lpn.items.length > 1 && item ? `${item.partNo} นับได้กี่ชิ้น` : 'นับได้กี่ชิ้น'}>
                  <input id="scan-qty" type="number" min={0} inputMode="numeric" className={`${inputCls} font-mono`} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
                </Field>
                <BigButton disabled={busy || form.qty === ''} onClick={submit}>
                  บันทึกการนับ
                </BigButton>
                {missHere && !missHere.revealed && (
                  <Alert tone="warn">ครั้งแรกนับได้ {fmt(missHere.counted)} ไม่ตรงกับระบบ · นับใหม่ทั้งกล่องโดยไม่ดูตัวเลขเดิม แล้วใส่ยอดที่นับได้อีกครั้ง</Alert>
                )}
                {missHere?.revealed && (
                  <div className="flex flex-col gap-2 rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
                    <p className="text-sm font-medium text-amber-900">
                      นับได้ {fmt(missHere.counted)} · ระบบมี {fmt(missHere.system)} (ต่าง {signed(missHere.counted - missHere.system)})
                    </p>
                    {canAdjust ? (
                      <>
                        <Field label="นับซ้ำแล้วได้เท่าเดิม: เหตุผลที่ไม่ตรง">
                          <select id="scan-reason" className={inputCls} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                            <option value="">— เลือก —</option>
                            <option>นับใหม่แล้วไม่ตรง</option>
                            <option>ของเสียหาย</option>
                            <option>บันทึกผิด</option>
                            <option>อื่น ๆ</option>
                          </select>
                        </Field>
                        <BigButton disabled={busy || !form.reason} onClick={() => void requestAdjust(missHere)}>
                          ส่งขอปรับยอดเป็น {fmt(missHere.counted)}
                        </BigButton>
                        <p className="text-xs text-amber-900">ยอดเปลี่ยนหลังผู้มีสิทธิ์อนุมัติ · คนขอกับคนอนุมัติต้องเป็นคนละคน</p>
                      </>
                    ) : (
                      <p className="text-xs text-amber-900">บัญชีนี้ส่งขอปรับยอดไม่ได้ · บันทึกการนับไว้แล้ว แจ้งหัวหน้าโซน</p>
                    )}
                  </div>
                )}
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
          </div>
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
                  {/* ระหว่างตรวจนับไม่โชว์ยอดในระบบจากการนับครั้งก่อน (นับแบบไม่เห็นยอด) */}
                  <span className="font-mono font-semibold">{t.lpnNo ?? ''}</span> {mode === 'COUNT' && (t.kind === 'COUNT' || t.kind === 'ADJ') ? `${t.partNo ?? ''} · ${t.kind === 'COUNT' ? 'นับแล้ว' : 'ขอปรับยอด'}` : txSummary(t)}
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
