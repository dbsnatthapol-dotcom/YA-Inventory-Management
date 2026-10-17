import { useCallback, useEffect, useMemo, useState } from 'react'
import { errorText } from '../../wms/api'
import { fmt } from '../../wms/logic'
import { bomQty, fgOfModel, partsOfModel, resolvePart, stockByPart } from '../../wms/partCodes'
import type { FgItem, Lpn, PartMaster, Requisition } from '../../wms/types'
import { useWms } from '../../wms/useWms'
import { PrintDialog } from './Print'
import { PlanningPage } from './ReportPages'
import { Alert, BigButton, Card, Field, inputCls, Pill, Segmented, tdCls, thCls } from './ui'

type Mode = 'sub' | 'fm005' | 'report'

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
const MODEL_KEY = 'uam-issue-model'
const loadModel = () => {
  try {
    return localStorage.getItem(MODEL_KEY) ?? ''
  } catch {
    return ''
  }
}
const int = (v: string) => Math.max(0, Math.floor(Number(v) || 0))

/** แถวกรอกจำนวนต่อ part */
interface Line {
  partNo: string
  qty: number
}

/**
 * เบิกเข้าไลน์ประกอบ: ใบเบิกย่อยของ MRA ตัดสต็อกทันที (FIFO) → จบวันกรอก FM-P-005 ระบบกระทบกับใบย่อยของวัน
 * → สรุปส่ง Planning (ยอดเบิก + คงเหลือ)
 */
export function IssueTab() {
  const { api, master, can } = useWms()
  const [mode, setMode] = useState<Mode>('sub')
  const [lpns, setLpns] = useState<Lpn[]>([])
  const [reqs, setReqs] = useState<Requisition[]>([])
  const [day, setDay] = useState(today)
  const [model, setModelState] = useState(() => loadModel() || master.models[0]?.code || '')
  const setModel = (m: string) => {
    setModelState(m)
    try {
      localStorage.setItem(MODEL_KEY, m)
    } catch {
      // ไม่มีที่เก็บ
    }
  }

  const refresh = useCallback(async () => {
    const [l, r] = await Promise.all([api.activeLpns(), api.listRequisitions(day, day)])
    setLpns(l)
    setReqs(r)
  }, [api, day])
  useEffect(() => {
    let alive = true
    Promise.all([api.activeLpns(), api.listRequisitions(day, day)]).then(([l, r]) => {
      if (!alive) return
      setLpns(l)
      setReqs(r)
    })
    return () => {
      alive = false
    }
  }, [api, day])

  const stock = useMemo(() => stockByPart(lpns), [lpns])
  const canIssue = can('scan.issue')

  return (
    <div className="flex flex-col gap-4 pb-28">
      <div className="flex flex-wrap items-end gap-3">
        <Segmented
          label="งานเบิก"
          value={mode}
          onChange={setMode}
          options={[
            ['sub', 'ใบเบิกย่อย (ทยอยเบิก)'],
            ['fm005', 'FM-P-005 ยอดรวมจบวัน'],
            ['report', 'สรุปส่ง Planning'],
          ]}
        />
        {mode !== 'report' && (
          <>
            <Field label="วันที่">
              <input type="date" className={inputCls} value={day} onChange={(e) => setDay(e.target.value || today())} />
            </Field>
            <Field label="Model">
              <select className={inputCls} value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">— เลือก Model —</option>
                {master.models.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.code}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
      </div>

      {!canIssue && mode !== 'report' && <Alert tone="warn">บัญชีนี้ดูได้อย่างเดียว · ต้องมีสิทธิ์ "เบิก" จึงจะบันทึกได้</Alert>}

      {mode === 'sub' && <SubForm key={`${day}-${model}`} day={day} model={model} stock={stock} reqs={reqs} canIssue={canIssue} onDone={refresh} />}
      {mode === 'fm005' && <Fm005Form key={`${day}-${model}`} day={day} model={model} stock={stock} reqs={reqs} canIssue={canIssue} onDone={refresh} />}
      {mode === 'report' && <PlanningReport />}
    </div>
  )
}

type Stock = Map<string, { total: number; available: number }>

/** ช่องเพิ่ม part ที่ไม่อยู่ในรายการของ Model: พิมพ์/ยิงรหัสลูกค้า (มีหรือไม่มี revision) หรือรหัส UAM */
function AddPart({ onAdd }: { onAdd: (p: PartMaster) => void }) {
  const { master } = useWms()
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const p = resolvePart(master.parts, code)
        if (!p) return setErr(`ไม่พบ "${code}" ใน Master (ใช้รหัสลูกค้า หรือรหัส UAM)`)
        onAdd(p)
        setCode('')
        setErr(null)
      }}
    >
      <input list="issue-parts" className={`${inputCls} max-w-xs font-mono`} placeholder="+ เพิ่ม part: รหัสลูกค้า / รหัส UAM" value={code} onChange={(e) => setCode(e.target.value)} />
      <datalist id="issue-parts">
        {master.parts.map((p) => (
          <option key={p.partNo} value={p.partNo}>
            {[p.uamCode, p.name].filter(Boolean).join(' · ')}
          </option>
        ))}
      </datalist>
      <BigButton type="submit" tone="secondary" disabled={!code.trim()}>
        เพิ่ม
      </BigButton>
      {err && <span className="text-sm text-rose-600">{err}</span>}
    </form>
  )
}

/** เลือกชุดวงล้อ (FG) ของ Model + จำนวนวง → คำนวณจำนวนเบิกจาก BOM */
function FgPicker({ model, fg, onFg, wheels, onWheels, onCalc }: { model: string; fg: FgItem | null; onFg: (f: FgItem | null) => void; wheels: string; onWheels: (v: string) => void; onCalc: () => void }) {
  const { master } = useWms()
  const list = fgOfModel(master, model)
  return (
    <>
      <Field label="ชุดวงล้อ (FG)" hint={list.length ? 'เลือกแล้วแสดงเฉพาะ part ใน BOM ของชุดนี้' : 'ยังไม่มีชุดของ Model นี้ · ตั้งที่หลังบ้าน → ข้อมูลหลัก → ชุดวงล้อ'}>
        <select className={inputCls} value={fg?.code ?? ''} onChange={(e) => onFg(list.find((f) => f.code === e.target.value) ?? null)}>
          <option value="">— ทุก part ของ {model} —</option>
          {list.map((f) => (
            <option key={f.code} value={f.code}>
              {f.code} · {f.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="จำนวนวง">
        <div className="flex gap-2">
          <input type="number" min={0} inputMode="numeric" className={`${inputCls} font-mono`} value={wheels} onChange={(e) => onWheels(e.target.value)} placeholder="เช่น 28" />
          <BigButton type="button" tone="secondary" disabled={!fg || !int(wheels)} onClick={onCalc} title={fg ? 'จำนวนวง × BOM' : 'เลือกชุดวงล้อก่อน'}>
            คำนวณ
          </BigButton>
        </div>
      </Field>
    </>
  )
}

function PartCell({ part }: { part: PartMaster | undefined }) {
  if (!part) return null
  return (
    <>
      <div className="font-mono font-semibold">{part.partNo}</div>
      <div className="text-xs text-slate-500">{[part.uamCode && `UAM ${part.uamCode}`, part.name].filter(Boolean).join(' · ')}</div>
    </>
  )
}

/** ใบเบิกย่อย: เลือก Model → ใส่จำนวนวง ระบบคำนวณทุก part → แก้เฉพาะที่ต่าง → บันทึกตัดสต็อก */
function SubForm({ day, model, stock, reqs, canIssue, onDone }: { day: string; model: string; stock: Stock; reqs: Requisition[]; canIssue: boolean; onDone: () => Promise<void> }) {
  const { api, master } = useWms()
  const [fgItem, setFgItem] = useState<FgItem | null>(() => fgOfModel(master, model)[0] ?? null)
  const base = useMemo(() => {
    if (!model) return []
    if (!fgItem) return partsOfModel(master, model)
    return fgItem.lines.map((l) => master.parts.find((p) => p.partNo === l.partNo) ?? { partNo: l.partNo, name: '', type: null, customerId: null, models: [] })
  }, [master, model, fgItem])
  const [extra, setExtra] = useState<PartMaster[]>([])
  const parts = [...base, ...extra.filter((p) => !base.some((b) => b.partNo === p.partNo))]
  const perWheel = (no: string) => fgItem?.lines.find((l) => l.partNo === no)?.qtyPer ?? null
  const [qty, setQty] = useState<Record<string, number>>({})
  const [fg, setFg] = useState('')
  const [head, setHead] = useState({ docNo: '', fromDept: 'MRA', note: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const fill = (wheels: number) => fgItem && setQty({ ...qty, ...bomQty(fgItem, wheels) })
  const lines: Line[] = parts.map((p) => ({ partNo: p.partNo, qty: qty[p.partNo] ?? 0 })).filter((l) => l.qty > 0)
  const short = lines.filter((l) => l.qty > (stock.get(l.partNo)?.available ?? 0))
  const total = lines.reduce((s, l) => s + l.qty, 0)
  const todays = reqs.filter((r) => r.kind === 'line' && r.modelCode === model)

  const post = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await api.postRequisition({
        kind: 'line',
        docDate: day,
        modelCode: model,
        fgCode: fgItem?.code,
        fgQty: fg ? int(fg) : null,
        docNo: head.docNo.trim() || undefined,
        fromDept: head.fromDept.trim() || undefined,
        toDept: 'W/H ASSY',
        note: head.note.trim() || undefined,
        lines: lines.map((l) => ({ ...l, reqQty: l.qty })),
      })
      setMsg({ tone: 'ok', text: `บันทึก ${res.reqNo} แล้ว · ตัดสต็อก ${lines.length} รายการ ${fmt(total)} ชิ้น` })
      setQty({})
      setFg('')
      setHead({ ...head, docNo: '', note: '' })
      await onDone()
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  if (!model) return <Alert tone="info">เลือก Model ก่อน ระบบจะดึงรายการ part ของรุ่นนั้นมาให้</Alert>

  return (
    <>
      <Card title={`ใบเบิกย่อย ${model}`} eyebrow="ทยอยเบิกตามรอบประกอบ · ตัดสต็อกทันทีที่บันทึก (กล่องที่รับเข้าก่อน ออกก่อน)">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <FgPicker
            model={model}
            fg={fgItem}
            onFg={(f) => {
              setFgItem(f)
              setQty({})
            }}
            wheels={fg}
            onWheels={setFg}
            onCalc={() => fill(int(fg))}
          />
          <Field label="เลขที่ใบเบิกย่อย (ถ้ามี)">
            <input className={`${inputCls} font-mono`} value={head.docNo} onChange={(e) => setHead({ ...head, docNo: e.target.value })} />
          </Field>
          <Field label="แผนกที่ขอเบิก">
            <input className={inputCls} value={head.fromDept} onChange={(e) => setHead({ ...head, fromDept: e.target.value })} />
          </Field>
          <Field label="หมายเหตุ / รอบเวลา">
            <input className={inputCls} value={head.note} onChange={(e) => setHead({ ...head, note: e.target.value })} placeholder="เช่น รอบ 9:00" />
          </Field>
        </div>
        {parts.length === 0 && <Alert tone="warn">Model นี้ยังไม่มี part ใน Master · เพิ่มได้ด้านล่าง หรือตั้งในหน้าหลังบ้าน → ข้อมูลหลัก → Part</Alert>}
        {!fgItem && parts.length > 12 && <Alert tone="info">แสดงทุก part ของ {model} ({parts.length} รายการ) · เลือกชุดวงล้อด้านบนเพื่อแสดงเฉพาะ part ที่ใช้ และคำนวณจากจำนวนวง</Alert>}
        <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr>
                <th className={thCls}>Part</th>
                <th className={`${thCls} text-right`}>ต่อวง</th>
                <th className={`${thCls} text-right`}>พร้อมเบิก</th>
                <th className={`${thCls} text-right`}>จำนวนเบิก</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => {
                const v = qty[p.partNo] ?? 0
                const avail = stock.get(p.partNo)?.available ?? 0
                return (
                  <tr key={p.partNo} className={v > avail ? 'bg-rose-50/70' : undefined}>
                    <td className={tdCls}>
                      <PartCell part={p} />
                    </td>
                    <td className={`${tdCls} text-right font-mono text-slate-500`}>{fmt(perWheel(p.partNo))}</td>
                    <td className={`${tdCls} text-right font-mono`}>{fmt(avail)}</td>
                    <td className={`${tdCls} text-right`}>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        className={`w-28 rounded-md border-2 px-2 py-1.5 text-right font-mono font-semibold ${v > avail ? 'border-rose-400' : 'border-sky-300'}`}
                        value={v || ''}
                        placeholder="0"
                        onChange={(e) => setQty({ ...qty, [p.partNo]: int(e.target.value) })}
                        aria-label={`จำนวนเบิก ${p.partNo}`}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <AddPart onAdd={(p) => setExtra((x) => [...x, p])} />
      </Card>

      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <TodayList title={`ใบเบิกย่อย ${model} วันนี้ (${todays.length})`} reqs={todays} canIssue={canIssue} onDone={onDone} />

      <div className="sticky bottom-2 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-sky-700 bg-white px-4 py-3 shadow-lg">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <strong className="text-base">
            {lines.length} รายการ · {fmt(total)} ชิ้น
          </strong>
          {short.length > 0 && <Pill tone="bad">สต็อกไม่พอ {short.length} รายการ</Pill>}
        </div>
        <BigButton disabled={!canIssue || busy || !lines.length || short.length > 0} onClick={() => void post()} className="!py-3 text-base">
          {busy ? 'กำลังบันทึก…' : 'บันทึกใบเบิก → ตัดสต็อก'}
        </BigButton>
      </div>
    </>
  )
}

/** ใบเบิกของวัน: ดูรายการ และยกเลิกใบที่คีย์ผิด (ก่อนกระทบ FM-P-005) */
function TodayList({ title, reqs, canIssue, onDone }: { title: string; reqs: Requisition[]; canIssue: boolean; onDone: () => Promise<void> }) {
  const { api } = useWms()
  const [msg, setMsg] = useState<string | null>(null)
  if (!reqs.length) return null
  const cancel = async (r: Requisition) => {
    const reason = prompt(`ยกเลิก ${r.reqNo}? ของจะคืนเข้ากล่องเดิม · ระบุเหตุผล`)
    if (!reason) return
    try {
      await api.voidRequisition(r.id, reason)
      setMsg(null)
      await onDone()
    } catch (e) {
      setMsg(errorText(e))
    }
  }
  return (
    <Card title={title}>
      {msg && <Alert tone="bad">{msg}</Alert>}
      <ul className="flex flex-col divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
        {reqs.map((r) => (
          <li key={r.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 text-sm ${r.status === 'void' ? 'opacity-50' : ''}`}>
            <b className="font-mono">{r.reqNo}</b>
            {r.docNo && <span className="font-mono text-slate-500">({r.docNo})</span>}
            <span className="text-slate-500">
              {new Date(r.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} · {r.lines.length} รายการ · {fmt(r.lines.reduce((s, l) => s + l.qty, 0))} ชิ้น
              {r.fgQty ? ` · ${fmt(r.fgQty)} วง` : ''}
              {r.note ? ` · ${r.note}` : ''}
            </span>
            {r.status === 'void' ? <Pill tone="muted">ยกเลิก</Pill> : r.reconciledBy ? <Pill tone="ok">กระทบ FM-P-005 แล้ว</Pill> : <Pill tone="warn">รอ FM-P-005</Pill>}
            {canIssue && r.status === 'posted' && !r.reconciledBy && (
              <button className="ml-auto rounded-md px-2 py-1 text-xs text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50" onClick={() => void cancel(r)}>
                ยกเลิกใบนี้
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** FM-P-005 จบวัน: ยอดตั้งต้น = ผลรวมใบย่อยของวัน แก้ให้ตรงเอกสาร → ระบบตัดเพิ่ม/คืนส่วนต่าง */
function Fm005Form({ day, model, stock, reqs, canIssue, onDone }: { day: string; model: string; stock: Stock; reqs: Requisition[]; canIssue: boolean; onDone: () => Promise<void> }) {
  const { api, master } = useWms()
  const subs = reqs.filter((r) => r.kind === 'line' && r.status === 'posted' && !r.reconciledBy && r.modelCode === model)
  const done = reqs.filter((r) => r.kind === 'fm005' && r.status === 'posted' && r.modelCode === model)
  const subSum = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of subs) for (const l of r.lines) m.set(l.partNo, (m.get(l.partNo) ?? 0) + l.qty)
    return m
  }, [subs])
  const fgUsed = useMemo(() => [...new Set(subs.map((r) => r.fgCode).filter(Boolean))] as string[], [subs])
  const [fgItem, setFgItem] = useState<FgItem | null>(() => fgOfModel(master, model).find((f) => fgUsed.includes(f.code)) ?? null)
  const [extra, setExtra] = useState<PartMaster[]>([])
  // รายการตั้งต้น: part ในใบย่อยของวัน + BOM ของชุดที่เลือก (ไม่มีทั้งคู่ = ทุก part ของ Model)
  const base = fgItem ? fgItem.lines.map((l) => l.partNo) : subSum.size ? [] : model ? partsOfModel(master, model).map((p) => p.partNo) : []
  const partNos = [...new Set([...base, ...subSum.keys(), ...extra.map((p) => p.partNo)])]
  const partOf = (no: string) => master.parts.find((p) => p.partNo === no)
  const [qty, setQty] = useState<Record<string, number>>({})
  const val = (no: string) => qty[no] ?? subSum.get(no) ?? 0
  const [fg, setFg] = useState('')
  const [head, setHead] = useState({ docNo: '', fromDept: 'MRA', toDept: 'W/H ASSY', note: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const rows = partNos.map((no) => {
    const sub = subSum.get(no) ?? 0
    const fm = val(no)
    return { no, sub, fm, diff: fm - sub }
  })
  const short = rows.filter((r) => r.diff > (stock.get(r.no)?.available ?? 0))
  const changed = rows.filter((r) => r.diff !== 0)

  const post = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await api.reconcileFm005({
        docNo: head.docNo.trim(),
        docDate: day,
        modelCode: model,
        fgCode: fgItem?.code,
        fgQty: fg ? int(fg) : null,
        fromDept: head.fromDept.trim() || undefined,
        toDept: head.toDept.trim() || undefined,
        note: head.note.trim() || undefined,
        lines: rows.filter((r) => r.fm > 0 || r.sub > 0).map((r) => ({ partNo: r.no, qty: r.fm })),
      })
      setMsg({ tone: 'ok', text: `บันทึก FM-P-005 ${head.docNo} (${res.reqNo}) แล้ว · กระทบใบย่อย ${res.subs} ใบ · ปรับส่วนต่าง ${changed.length} รายการ` })
      setQty({})
      setHead({ ...head, docNo: '', note: '' })
      await onDone()
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  if (!model) return <Alert tone="info">เลือก Model ก่อน</Alert>

  return (
    <>
      <Card title={`FM-P-005 ใบเบิกสินค้า ${model}`} eyebrow="ยอดรวมทางการจบวัน · ตั้งต้นจากใบย่อยของวัน แก้เฉพาะที่เอกสารต่าง">
        {done.length > 0 && <Alert tone="info">วันนี้บันทึก FM-P-005 ของ {model} แล้ว: {done.map((r) => r.docNo).join(', ')} · ถ้ามีใบย่อยเพิ่มหลังจากนั้น บันทึก FM-P-005 ใบใหม่ได้</Alert>}
        {subs.length === 0 && <Alert tone="warn">ยังไม่มีใบเบิกย่อยที่รอกระทบของ {model} วันที่ {day} · ระบบจะตัดสต็อกตาม FM-P-005 ทั้งหมด</Alert>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Field label="เลขที่ FM-P-005 *">
            <input className={`${inputCls} font-mono`} value={head.docNo} onChange={(e) => setHead({ ...head, docNo: e.target.value })} placeholder="เช่น 292333" />
          </Field>
          <FgPicker model={model} fg={fgItem} onFg={setFgItem} wheels={fg} onWheels={setFg} onCalc={() => fgItem && setQty({ ...qty, ...bomQty(fgItem, int(fg)) })} />
          <Field label="จาก">
            <input className={inputCls} value={head.fromDept} onChange={(e) => setHead({ ...head, fromDept: e.target.value })} />
          </Field>
          <Field label="ถึง">
            <input className={inputCls} value={head.toDept} onChange={(e) => setHead({ ...head, toDept: e.target.value })} />
          </Field>
          <Field label="หมายเหตุ (เช่น Invoice)">
            <input className={inputCls} value={head.note} onChange={(e) => setHead({ ...head, note: e.target.value })} />
          </Field>
        </div>
        <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr>
                <th className={thCls}>Part</th>
                <th className={`${thCls} text-right`}>รวมใบย่อยวันนี้</th>
                <th className={`${thCls} text-right`}>ยอดใน FM-P-005</th>
                <th className={`${thCls} text-right`}>ส่วนต่าง</th>
                <th className={`${thCls} text-right`}>คงเหลือหลังบันทึก</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const after = (stock.get(r.no)?.total ?? 0) - r.diff
                return (
                  <tr key={r.no} className={r.diff ? 'bg-amber-50/60' : undefined}>
                    <td className={tdCls}>{partOf(r.no) ? <PartCell part={partOf(r.no)} /> : <span className="font-mono font-semibold">{r.no}</span>}</td>
                    <td className={`${tdCls} text-right font-mono`}>{fmt(r.sub)}</td>
                    <td className={`${tdCls} text-right`}>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        className="w-28 rounded-md border-2 border-sky-300 px-2 py-1.5 text-right font-mono font-semibold"
                        value={r.fm || ''}
                        placeholder="0"
                        onChange={(e) => setQty({ ...qty, [r.no]: int(e.target.value) })}
                        aria-label={`FM-P-005 ${r.no}`}
                      />
                    </td>
                    <td className={`${tdCls} text-right font-mono font-semibold ${r.diff > 0 ? 'text-rose-700' : r.diff < 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                      {r.diff > 0 ? `ตัดเพิ่ม ${fmt(r.diff)}` : r.diff < 0 ? `คืน ${fmt(-r.diff)}` : 'ตรง'}
                    </td>
                    <td className={`${tdCls} text-right font-mono ${after < 0 ? 'text-rose-600' : ''}`}>{fmt(after)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <AddPart onAdd={(p) => setExtra((x) => [...x, p])} />
      </Card>

      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <div className="sticky bottom-2 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-sky-700 bg-white px-4 py-3 shadow-lg">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <strong className="text-base">กระทบใบย่อย {subs.length} ใบ</strong>
          <Pill tone={changed.length ? 'warn' : 'ok'}>{changed.length ? `ต่างจากใบย่อย ${changed.length} รายการ` : 'ตรงกับใบย่อยทุกรายการ'}</Pill>
          {short.length > 0 && <Pill tone="bad">สต็อกไม่พอตัดเพิ่ม {short.length} รายการ</Pill>}
        </div>
        <BigButton disabled={!canIssue || busy || !head.docNo.trim() || short.length > 0 || !rows.some((r) => r.fm > 0 || r.sub > 0)} onClick={() => void post()} className="!py-3 text-base">
          {busy ? 'กำลังบันทึก…' : 'บันทึก FM-P-005 → กระทบยอด'}
        </BigButton>
      </div>
    </>
  )
}

/** สรุปส่ง Planning: FM-P-005 แต่ละใบ (ยอดเบิก + คงเหลือ) และใบย่อยที่ยังรอ FM-P-005 */
function PlanningReport() {
  const { api, master } = useWms()
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [reqs, setReqs] = useState<Requisition[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    let alive = true
    api.listRequisitions(from, to).then((r) => alive && setReqs(r))
    return () => {
      alive = false
    }
  }, [api, from, to])

  const fm = (reqs ?? []).filter((r) => r.kind === 'fm005' && r.status === 'posted').sort((a, b) => a.docDate.localeCompare(b.docDate) || a.createdAt.localeCompare(b.createdAt))
  const pending = (reqs ?? []).filter((r) => r.kind === 'line' && r.status === 'posted' && !r.reconciledBy)
  const partOf = (no: string) => master.parts.find((p) => p.partNo === no)

  const exportXlsx = async () => {
    setBusy(true)
    try {
      const { exportPlanning } = await import('../../wms/ledgerExcel')
      await exportPlanning(fm, master.parts, from, to)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card
        title="สรุปยอดเบิกส่ง Planning"
        eyebrow="จาก FM-P-005 ที่บันทึกแล้ว · คงเหลือ = สต็อกหลังตัดยอดใบนั้น"
        action={
          <div className="flex gap-2">
            <BigButton tone="secondary" disabled={!fm.length} onClick={() => setPrinting(true)}>
              พิมพ์
            </BigButton>
            <BigButton disabled={busy || !fm.length} onClick={() => void exportXlsx()}>
              {busy ? 'กำลังสร้างไฟล์…' : 'Export Excel'}
            </BigButton>
          </div>
        }
      >
        <div className="flex flex-wrap gap-3">
          <Field label="ตั้งแต่">
            <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value || today())} />
          </Field>
          <Field label="ถึง">
            <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value || today())} />
          </Field>
        </div>
        {reqs && !fm.length && <p className="text-sm text-slate-500">ยังไม่มี FM-P-005 ในช่วงนี้</p>}
      </Card>

      <PrintDialog open={printing} onClose={() => setPrinting(false)} format="a4" title="ตัวอย่างก่อนพิมพ์ · สรุปส่ง Planning" subtitle={`FM-P-005 ${fm.length} ใบ`} printLabel="พิมพ์">
        <PlanningPage fm={fm} parts={master.parts} from={from} to={to} />
      </PrintDialog>
      {pending.length > 0 && (
        <Alert tone="warn">
          มีใบเบิกย่อยรอ FM-P-005 {pending.length} ใบ:{' '}
          {[...new Set(pending.map((r) => `${r.docDate} ${r.modelCode ?? ''}`))].join(', ')} · ยอดของใบเหล่านี้ตัดสต็อกแล้ว แต่ยังไม่อยู่ในสรุปนี้
        </Alert>
      )}

      {fm.map((r) => (
        <Card
          key={r.id}
          title={
            <span>
              FM-P-005 <span className="font-mono">{r.docNo}</span> · {r.modelCode} · {r.docDate}
            </span>
          }
          eyebrow={[r.fgQty ? `${fmt(r.fgQty)} วง` : null, r.fromDept && `${r.fromDept} → ${r.toDept ?? ''}`, r.note, `ระบบ ${r.reqNo} · ${r.createdCode ?? ''}`].filter(Boolean).join(' · ')}
        >
          <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr>
                  <th className={thCls}>Part No.</th>
                  <th className={thCls}>รหัส UAM</th>
                  <th className={thCls}>รายการ</th>
                  <th className={`${thCls} text-right`}>รวมใบย่อย</th>
                  <th className={`${thCls} text-right`}>FM-P-005</th>
                  <th className={`${thCls} text-right`}>ส่วนต่าง</th>
                  <th className={`${thCls} text-right`}>คงเหลือ</th>
                </tr>
              </thead>
              <tbody>
                {r.lines.map((l) => {
                  const d = l.qty - (l.reqQty ?? 0)
                  return (
                    <tr key={l.partNo}>
                      <td className={`${tdCls} font-mono font-semibold`}>{l.partNo}</td>
                      <td className={`${tdCls} font-mono text-slate-500`}>{partOf(l.partNo)?.uamCode ?? '–'}</td>
                      <td className={tdCls}>{partOf(l.partNo)?.name ?? ''}</td>
                      <td className={`${tdCls} text-right font-mono`}>{fmt(l.reqQty)}</td>
                      <td className={`${tdCls} text-right font-mono font-semibold`}>{fmt(l.qty)}</td>
                      <td className={`${tdCls} text-right font-mono ${d ? 'text-amber-700' : 'text-slate-400'}`}>{d ? (d > 0 ? `+${fmt(d)}` : fmt(d)) : '0'}</td>
                      <td className={`${tdCls} text-right font-mono`}>{fmt(l.balance)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </>
  )
}
