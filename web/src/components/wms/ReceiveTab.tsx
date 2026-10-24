import { useMemo, useRef, useState } from 'react'
import { errorText } from '../../wms/api'
import { aiReaderAvailable, readInvoicePhoto, readPackingListPhoto } from '../../wms/docReader'
import { useIsMobile } from '../../lib/viewMode'
import { zoneCodeOf } from '../../wms/locations'
import { fmt, needsQi, suggestedZone } from '../../wms/logic'
import { invoiceLinesFromRows } from '../../wms/invoiceLines'
import { basePartNo, resolvePart } from '../../wms/partCodes'
import { SAMPLE_INVOICE, SAMPLE_MODEL, SAMPLE_PACKING_LIST } from '../../wms/sampleDocs'
import { useWms } from '../../wms/useWms'
import { Alert, BigButton, Card, Field, inputCls, Pill, Segmented, tdCls, thCls } from './ui'

interface Row {
  key: string
  /** เลขเคส/พาเลทจาก Packing List (เคสเดียวกัน = กล่อง/ป้ายเดียวกัน) */
  caseNo: string
  partNo: string
  description: string
  plQty: number
  counted: number
  invQty: number | null
  invLine: number | null
  /** โซนเก็บที่เลือกเอง (null = ตามที่ระบบแนะนำ) */
  zoneId: string | null
}

let seq = 0
const newKey = () => `r${++seq}`

/** ช่องถ่ายภาพเอกสาร: แตะเพื่อเปิดกล้อง (มือถือ/Tablet) หรือเลือกไฟล์ */
function PhotoPick({ id, label, file, onFile }: { id: string; label: string; file: File | null; onFile: (f: File) => void }) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-3 hover:border-sky-400 hover:bg-sky-50">
      {url ? <img src={url} alt="" className="h-16 w-12 rounded object-cover ring-1 ring-slate-200" /> : <span className="grid h-16 w-12 place-items-center rounded bg-white text-2xl text-slate-400 ring-1 ring-slate-200">📷</span>}
      <span className="text-sm">
        <span className="block font-semibold text-slate-700">{file ? 'ถ่ายใหม่ / เปลี่ยนภาพ' : label}</span>
        <span className="text-slate-500">{file ? file.name : 'แตะเพื่อเปิดกล้อง หรือเลือกไฟล์ภาพ'}</span>
      </span>
      <input id={id} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
    </label>
  )
}

export function ReceiveTab({ onCreated, onCheckCreated }: { onCreated: (grnId: string) => void; onCheckCreated: (checkId: string) => void }) {
  const { api, master, settings, can } = useWms()
  const mobile = useIsMobile()
  /** check = สร้างใบตรวจรับแล้วตรวจทีละเคส (หลายคนช่วยกันได้) · direct = กรอกยอดนับที่นี่แล้วออก GRN เลย */
  const [how, setHow] = useState<'check' | 'direct'>('check')
  const direct = how === 'direct'
  const [modelCode, setModelCode] = useState('')
  const [replacement, setReplacement] = useState(false)
  const [pl, setPl] = useState({ refDoc: '', soNo: '', packages: '' })
  const [inv, setInv] = useState({ invoiceNo: '', poNo: '', docDate: '', movementType: '' })
  const [existing, setExisting] = useState<{ grnCount: number } | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  /** รหัสในระบบ: เลขฐาน (ไม่สน /A /B) · เลข 0 นำหน้าหายก็หาเจอ (RAT1088 → RAT01088) */
  const canon = (code: string) => resolvePart(master.parts, code)?.partNo ?? basePartNo(code)
  const [plFile, setPlFile] = useState<File | null>(null)
  const [invFile, setInvFile] = useState<File | null>(null)
  const [reading, setReading] = useState<'pl' | 'invoice' | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'bad' | 'info'; text: string } | null>(null)
  const tableRef = useRef<HTMLDivElement>(null)

  const customerId = master.models.find((m) => m.code === modelCode)?.customerId
  // โซนที่มีช่องเก็บ (พาเลท/rack/เต็นท์) ให้เลือกเก็บเอง
  const storageZones = useMemo(() => {
    const byZone = new Map<string, string>()
    for (const l of master.locations) if (l.active && (l.kind === 'bin' || l.kind === 'floor') && !byZone.has(l.zoneId)) byZone.set(l.zoneId, zoneCodeOf(l.code))
    return [...byZone].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [master.locations])
  const zoneLabel = useMemo(() => new Map(storageZones.map((z) => [z.id, z.label])), [storageZones])
  const allowed = can('receive.create')

  const checkInvoice = async (no: string) => {
    if (!no.trim()) return setExisting(null)
    const found = await api.findInvoiceNo(no).catch(() => null)
    setExisting(found)
    if (found) {
      // invoice เดิม: ใช้จำนวนตามที่บันทึกไว้ครั้งแรก
      const view = await api.invoiceView(no).catch(() => null)
      if (view) {
        setRows((rs) => rs.map((r) => ({ ...r, invQty: view.lines.find((l) => canon(l.partNo) === canon(r.partNo))?.qty ?? null, invLine: view.lines.find((l) => canon(l.partNo) === canon(r.partNo))?.lineNo ?? null })))
        setInv((v) => ({ ...v, poNo: view.invoice.poNo ?? v.poNo, docDate: view.invoice.docDate ?? v.docDate, movementType: view.invoice.movementType ?? v.movementType }))
      }
    }
  }

  const useSample = () => {
    setModelCode(SAMPLE_MODEL)
    setPl({ refDoc: SAMPLE_PACKING_LIST.refDoc, soNo: SAMPLE_PACKING_LIST.soNo, packages: SAMPLE_PACKING_LIST.packages })
    setInv({ invoiceNo: SAMPLE_INVOICE.invoiceNo, poNo: SAMPLE_INVOICE.poNo, docDate: SAMPLE_INVOICE.docDate, movementType: SAMPLE_INVOICE.movementType })
    setRows(
      SAMPLE_PACKING_LIST.lines.map((l) => {
        const il = SAMPLE_INVOICE.lines.find((x) => canon(x.partNo) === canon(l.partNo))
        return { key: newKey(), caseNo: '', partNo: canon(l.partNo), description: l.description, plQty: l.qty, counted: l.qty, invQty: il?.qty ?? null, invLine: il?.lineNo ?? null, zoneId: null }
      }),
    )
    setMsg({ tone: 'info', text: 'ใส่เอกสารตัวอย่าง RE TWIN แล้ว (Packing List 55035596 + Invoice 4957930126) · ยอดนับจริงตั้งต้นเท่ากับ Packing List แก้ได้ทุกช่อง' })
    void checkInvoice(SAMPLE_INVOICE.invoiceNo)
  }

  const readPl = async (file: File) => {
    setPlFile(file)
    if (!aiReaderAvailable) return
    setReading('pl')
    setMsg(null)
    try {
      const d = await readPackingListPhoto(file)
      setPl({ refDoc: d.refDoc, soNo: d.soNo, packages: d.packages })
      setRows(d.lines.map((l) => ({ key: newKey(), caseNo: (l.caseNo ?? '').trim(), partNo: canon(l.partNo), description: l.description, plQty: l.qty, counted: l.qty, invQty: null, invLine: l.invoiceLineNo, zoneId: null })))
      const cases = new Set(d.lines.map((l) => l.caseNo?.trim()).filter(Boolean)).size
      setMsg({ tone: 'ok', text: `AI อ่าน Packing List ได้ ${d.lines.length} รายการ${cases ? ` ใน ${cases} เคส` : ' (ไม่พบเลขเคส · ใส่เองได้ในช่อง "เคส")'} · ตรวจทานกับเอกสารก่อน` })
    } catch (e) {
      setMsg({ tone: 'warn', text: `อ่านภาพอัตโนมัติไม่ได้ (${errorText(e)}) · กรอกเอง หรือถ่ายใหม่ให้ตรงและชัดขึ้น` })
    } finally {
      setReading(null)
    }
  }

  const readInv = async (file: File) => {
    setInvFile(file)
    if (!aiReaderAvailable) return
    setReading('invoice')
    setMsg(null)
    try {
      const d = await readInvoicePhoto(file)
      setInv({ invoiceNo: d.invoiceNo, poNo: d.poNo, docDate: d.docDate, movementType: d.movementType })
      setRows((rs) => {
        const next = rs.map((r) => {
          const il = d.lines.find((l) => canon(l.partNo) === canon(r.partNo))
          return il ? { ...r, invQty: il.qty, invLine: il.lineNo } : r
        })
        // part ที่มีใน invoice แต่ไม่มีใน packing list → เพิ่มเป็นแถว (รับจริง 0)
        for (const l of d.lines) if (!next.some((r) => canon(r.partNo) === canon(l.partNo))) next.push({ key: newKey(), caseNo: '', partNo: canon(l.partNo), description: l.description, plQty: 0, counted: 0, invQty: l.qty, invLine: l.lineNo, zoneId: null })
        return next
      })
      setMsg(
        d.lines.length
          ? { tone: 'ok', text: `AI อ่าน Invoice ${d.invoiceNo} ได้ ${d.lines.length} รายการ` }
          : { tone: 'warn', text: `AI อ่าน Invoice ${d.invoiceNo} ได้แค่หัวเอกสาร ไม่มีรายการสินค้า · ถ่ายหน้าที่มีรายการเพิ่ม หรือใส่ยอด Invoice เองในช่อง "Invoice" (ใส่ทีหลังในใบตรวจรับก็ได้)` },
      )
      void checkInvoice(d.invoiceNo)
    } catch (e) {
      setMsg({ tone: 'warn', text: `อ่านภาพอัตโนมัติไม่ได้ (${errorText(e)}) · กรอกเอง หรือถ่ายใหม่` })
    } finally {
      setReading(null)
    }
  }

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)))
  // ยอด Invoice เป็นยอดทั้ง part (ไม่ใช่รายเคส) ⇒ แก้แถวเดียว ทุกเคสของ part เดียวกันเปลี่ยนตาม
  const setInvQty = (r: Row, invQty: number | null) => {
    const part = canon(r.partNo)
    setRows((rs) => rs.map((x) => (x.key === r.key || (part && canon(x.partNo) === part) ? { ...x, invQty } : x)))
  }
  const pickPart = (key: string, partNo: string) => {
    const part = resolvePart(master.parts, partNo)
    patch(key, { partNo: partNo.trimStart(), ...(part ? { description: part.name } : {}) })
  }
  // พิมพ์เสร็จ: เปลี่ยนเป็นรหัสหลัก (RAT00586/B → RAT00586)
  const settlePart = (key: string, partNo: string) => patch(key, { partNo: canon(partNo) })

  const offPl = direct ? rows.filter((r) => r.counted !== r.plQty).length : 0
  // part เดียวกันหลายเคส: เทียบยอด Invoice กับยอดรวมทุกเคสของ part (ไม่ใช่รายแถว)
  const byPart = new Map<string, { rows: number; counted: number; pl: number }>()
  for (const r of rows) {
    const k = canon(r.partNo)
    if (!k) continue
    const t = byPart.get(k) ?? { rows: 0, counted: 0, pl: 0 }
    byPart.set(k, { rows: t.rows + 1, counted: t.counted + r.counted, pl: t.pl + r.plQty })
  }
  const partTotal = (r: Row) => byPart.get(canon(r.partNo)) ?? { rows: 1, counted: r.counted, pl: r.plQty }
  const offInvoice = (r: Row) => r.invQty !== null && (direct ? partTotal(r).counted : partTotal(r).pl) !== r.invQty
  const offInv = new Set(rows.filter(offInvoice).map((r) => canon(r.partNo))).size
  const invoiceLines = () => invoiceLinesFromRows(rows.map((r) => ({ ...r, partNo: canon(r.partNo) })))
  const mi3 = rows.filter((r) => needsQi(master, settings.qiPartTypes, modelCode, canon(r.partNo))).length
  const unknown = rows.filter((r) => r.partNo && !resolvePart(master.parts, r.partNo)).length
  const total = rows.reduce((s, r) => s + (direct ? r.counted : r.plQty), 0)
  const caseCount = new Set(rows.filter((r) => r.plQty > 0 || r.invQty === null).map((r) => r.caseNo.trim().toUpperCase() || r.key)).size
  const problems = [
    !modelCode && 'เลือก Model',
    !pl.refDoc.trim() && 'ใส่เลข REF ของ Packing List',
    !rows.length && 'เพิ่มรายการอย่างน้อย 1 รายการ',
    rows.some((r) => !r.partNo.trim()) && 'มีแถวที่ยังไม่ใส่ Part No.',
  ].filter(Boolean) as string[]

  const submit = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const res = await api.createGrn({
        modelCode,
        replacement,
        packingList: { refDoc: pl.refDoc.trim(), soNo: pl.soNo.trim(), packages: pl.packages.trim() },
        invoice: inv.invoiceNo.trim()
          ? {
              invoiceNo: inv.invoiceNo.trim(),
              customerId,
              poNo: inv.poNo.trim(),
              docDate: inv.docDate.trim(),
              movementType: inv.movementType.trim(),
              lines: invoiceLines(),
            }
          : undefined,
        lines: rows.map((r) => ({ partNo: canon(r.partNo), description: r.description, plQty: r.plQty, countedQty: r.counted, ...(r.zoneId ? { zoneId: r.zoneId } : {}), ...(r.caseNo.trim() ? { caseNo: r.caseNo.trim() } : {}) })),
      })
      // ภาพเอกสารเป็นหลักฐาน: อัปโหลดหลังบันทึก GRN แล้ว (ถ้าเน็ตช้า/ล้ม การรับของยังสำเร็จ)
      const [plPath, invPath] = await Promise.all([plFile ? api.uploadDoc(plFile, 'pl') : null, invFile ? api.uploadDoc(invFile, 'invoice') : null])
      if (plPath || invPath) await api.attachImages(res.grnId, plPath ? [plPath] : [], invPath ? [invPath] : []).catch(() => undefined)
      onCreated(res.grnId)
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  // ใบตรวจรับ: ภาพเอกสารอัปโหลดก่อน (เก็บไว้ที่ใบ แล้วติดไปกับ GRN ตอนตรวจครบ) · ภาพล้มก็สร้างใบได้
  const submitCheck = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const [plPath, invPath] = await Promise.all([plFile ? api.uploadDoc(plFile, 'pl') : null, invFile ? api.uploadDoc(invFile, 'invoice') : null])
      // part ที่มีแต่ใน Invoice (ยอด PL 0) ไม่ต้องตรวจ แต่ยังใช้เทียบยอด Invoice
      const toCheck = rows.filter((r) => r.plQty > 0 || r.invQty === null)
      const res = await api.createCheck({
        modelCode,
        replacement,
        packingList: { refDoc: pl.refDoc.trim(), soNo: pl.soNo.trim(), packages: pl.packages.trim(), imagePaths: plPath ? [plPath] : [] },
        invoice: inv.invoiceNo.trim()
          ? {
              invoiceNo: inv.invoiceNo.trim(),
              poNo: inv.poNo.trim(),
              docDate: inv.docDate.trim(),
              movementType: inv.movementType.trim(),
              lines: invoiceLines(),
              imagePaths: invPath ? [invPath] : [],
            }
          : undefined,
        lines: toCheck.map((r) => ({ caseNo: r.caseNo.trim(), partNo: canon(r.partNo), description: r.description, plQty: r.plQty, invLine: r.invLine, zoneId: r.zoneId })),
      })
      onCheckCreated(res.id)
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  /** ช่องกรอกของแต่ละรายการ: ใช้ทั้งตาราง (จอคอม) และการ์ด (มือถือ) */
  const cells = (r: Row, wide: boolean) => {
    const partNo = canon(r.partNo)
    const qi = needsQi(master, settings.qiPartTypes, modelCode, partNo)
    const known = !!resolvePart(master.parts, r.partNo)
    const zone = suggestedZone(master, customerId, partNo)
    const bad = direct && (r.counted !== r.plQty || offInvoice(r))
    const cases = partTotal(r).rows
    const num = `rounded-md px-2 text-right font-mono ${wide ? 'w-full py-2.5 text-base' : 'w-24 py-1.5'}`
    return {
      bad,
      caseNo: (
        <input
          id={`case-${r.key}`}
          className={`rounded-md border border-slate-300 px-2 font-mono uppercase ${wide ? 'w-full py-2.5 text-base' : 'w-24 py-1.5 text-sm'}`}
          value={r.caseNo}
          onChange={(e) => patch(r.key, { caseNo: e.target.value })}
          placeholder="–"
          aria-label="เคส / พาเลท"
        />
      ),
      part: (
        <input
          id={`part-${r.key}`}
          list="wms-parts"
          className={`rounded-md border border-slate-300 px-2 font-mono ${wide ? 'w-full py-2.5 text-base' : 'w-36 py-1.5 text-sm'}`}
          value={r.partNo}
          onChange={(e) => pickPart(r.key, e.target.value)}
          onBlur={(e) => settlePart(r.key, e.target.value)}
          aria-label="Part No."
        />
      ),
      pl: (
        <input id={`pl-${r.key}`} type="number" min={0} inputMode="numeric" className={`${num} border border-slate-300`} value={r.plQty} onChange={(e) => patch(r.key, { plQty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} aria-label="จำนวน Packing List" />
      ),
      counted: (
        <input id={`cnt-${r.key}`} type="number" min={0} inputMode="numeric" className={`${num} border-2 border-sky-300 font-semibold`} value={r.counted} onChange={(e) => patch(r.key, { counted: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} aria-label="นับได้จริง" />
      ),
      inv: (
        <>
          {existing ? (
            <span className={`block font-mono ${wide ? 'py-2.5 text-right text-base' : ''}`}>{fmt(r.invQty)}</span>
          ) : (
            <input id={`inv-${r.key}`} type="number" min={0} inputMode="numeric" className={`${num} border border-slate-300`} value={r.invQty ?? ''} placeholder="–" onChange={(e) => setInvQty(r, e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)))} aria-label="จำนวนใน Invoice" />
          )}
          {r.invLine !== null && <div className="text-[10px] text-slate-400">บรรทัด {r.invLine}</div>}
          {r.invQty !== null && cases > 1 && <div className="text-[10px] text-slate-400">ยอดรวม {cases} เคส</div>}
        </>
      ),
      zone: (
        <>
          <select
            className={`rounded-md border px-1.5 font-mono ${wide ? 'w-full py-2.5 text-sm' : 'w-32 py-1.5 text-xs'} ${r.zoneId ? 'border-sky-400 bg-sky-50' : 'border-slate-300'}`}
            value={r.zoneId ?? ''}
            onChange={(e) => patch(r.key, { zoneId: e.target.value || null })}
            aria-label="โซนเก็บ"
            title={qi ? 'ตรวจ MI3 ก่อน แล้วจึงเก็บเข้าโซนนี้' : undefined}
          >
            <option value="">{zone ? `${zoneLabel.get(zone) ?? zone} (แนะนำ)` : 'ระบบเลือก (–)'}</option>
            {storageZones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label}
              </option>
            ))}
          </select>
          {qi && <div className="text-[10px] text-slate-400">ผ่าน MI3-QC ก่อน</div>}
        </>
      ),
      pills: (
        <>
          {direct && (r.counted === r.plQty ? <Pill tone="ok">ตรง PL</Pill> : r.counted < r.plQty ? <Pill tone="bad">ขาด {fmt(r.plQty - r.counted)}</Pill> : <Pill tone="warn">เกิน {fmt(r.counted - r.plQty)}</Pill>)}
          {direct && offInvoice(r) && <Pill tone="bad">{cases > 1 ? `รวม ${cases} เคสไม่ตรง Invoice` : 'ไม่ตรง Invoice'}</Pill>}
          {!direct && offInvoice(r) && <Pill tone="warn">{cases > 1 ? `PL รวม ${cases} เคสไม่ตรง Invoice` : 'PL ไม่ตรง Invoice'}</Pill>}
          {!direct && r.plQty === 0 && r.invQty !== null && <Pill tone="muted">มีแค่ใน Invoice</Pill>}
          {qi && <Pill tone="mi3">ส่ง MI3</Pill>}
          {r.partNo && !known && <Pill tone="warn">ไม่มีใน Master</Pill>}
        </>
      ),
      remove: (
        <button className={`rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600 ${wide ? 'h-11 w-11 ring-1 ring-slate-200' : 'px-2 py-1'}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="ลบแถว">
          ✕
        </button>
      ),
    }
  }

  if (!allowed) return <Alert tone="warn">บัญชีนี้ยังไม่มีสิทธิ์รับของ · ให้ผู้ดูแลระบบเปิดสิทธิ์ "รับของ / ออก GRN" ในหน้าหลังบ้าน</Alert>

  return (
    <div className={`flex flex-col gap-4 ${mobile ? 'pb-4' : 'pb-28'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5 text-xs">
          {(direct ? ['1 ถ่าย/กรอกเอกสาร', '2 นับจริง', '3 ยืนยัน → ออก GRN', '4 ติดป้าย'] : ['1 ถ่าย/กรอกเอกสาร', '2 สร้างใบตรวจรับ', '3 ตรวจทีละเคส', '4 ออก GRN']).map((s, i) => (
            <span key={s} className={`rounded-full px-3 py-1 font-medium ${i < (rows.length ? 2 : 1) ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-500'}`}>
              {s}
            </span>
          ))}
        </div>
        {/* เอกสารตัวอย่างใช้ได้เฉพาะหน้าสาธิตและโหมดทดลอง (กันใบรับปลอมเข้าระบบจริง) */}
        {(api.kind === 'demo' || settings.mode === 'trial') && (
          <BigButton tone="secondary" onClick={useSample}>
            ใช้เอกสารตัวอย่าง (RE TWIN)
          </BigButton>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card eyebrow="ใบที่มากับรถ · บังคับ" title="Packing List">
          <PhotoPick id="pl-photo" label="ถ่าย Packing List" file={plFile} onFile={readPl} />
          {reading === 'pl' && <Alert tone="info">AI กำลังอ่าน Packing List…</Alert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="เลขที่ Packing List (REF. Document No.) *">
              <input id="pl-ref" className={inputCls} value={pl.refDoc} onChange={(e) => setPl({ ...pl, refDoc: e.target.value })} placeholder="เช่น 55035596" />
            </Field>
            <Field label="Model *">
              <select id="pl-model" className={inputCls} value={modelCode} onChange={(e) => setModelCode(e.target.value)}>
                <option value="">— เลือก Model —</option>
                {master.models.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.code} {m.requiresInspection ? '· ต้องผ่าน MI3 (Rim/Hub)' : '· ไม่ต้องตรวจ'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="เลขที่ SO">
              <input id="pl-so" className={inputCls} value={pl.soNo} onChange={(e) => setPl({ ...pl, soNo: e.target.value })} />
            </Field>
            <Field label="หีบห่อ (Packing Type)">
              <input id="pl-pack" className={inputCls} value={pl.packages} onChange={(e) => setPl({ ...pl, packages: e.target.value })} placeholder="เช่น F28-F40" />
            </Field>
          </div>
          <label className="flex min-h-[44px] items-center gap-2 rounded-lg bg-slate-50 px-3 text-sm text-slate-700">
            <input type="checkbox" className="h-5 w-5" checked={replacement} onChange={(e) => setReplacement(e.target.checked)} />
            รับของทดแทน (แทนของ NG ที่ส่งคืน) · ลงช่อง "ทดแทน" ในบัญชีคุม FM-P-537
          </label>
        </Card>

        <Card eyebrow="ใช้อ้างอิงและกระทบยอด" title="Invoice">
          <PhotoPick id="inv-photo" label="ถ่าย Invoice" file={invFile} onFile={readInv} />
          {reading === 'invoice' && <Alert tone="info">AI กำลังอ่าน Invoice…</Alert>}
          {existing && <Alert tone="info">Invoice นี้มีในระบบแล้ว (รับไปแล้ว {existing.grnCount} เที่ยว) · เที่ยวนี้จะผูกกับใบเดิม ไม่สร้างซ้ำ</Alert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="เลขที่ Invoice">
              <input id="inv-no" className={inputCls} value={inv.invoiceNo} onChange={(e) => setInv({ ...inv, invoiceNo: e.target.value })} onBlur={(e) => void checkInvoice(e.target.value)} placeholder="เช่น 4957930126" />
            </Field>
            <Field label="เลขที่ PO">
              <input id="inv-po" className={inputCls} value={inv.poNo} onChange={(e) => setInv({ ...inv, poNo: e.target.value })} />
            </Field>
            <Field label="วันที่เอกสาร">
              <input id="inv-date" type="date" className={inputCls} value={inv.docDate} onChange={(e) => setInv({ ...inv, docDate: e.target.value })} />
            </Field>
            <Field label="ประเภทรายการ (Movement Type)">
              <input id="inv-mvt" className={inputCls} value={inv.movementType} onChange={(e) => setInv({ ...inv, movementType: e.target.value })} placeholder="เช่น 541" />
            </Field>
          </div>
        </Card>
      </div>

      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <Card
        title={direct ? 'นับจริงเทียบ Packing List และ Invoice' : 'รายการตาม Packing List (ตรวจนับในใบตรวจรับ)'}
        action={
          <BigButton tone="secondary" onClick={() => setRows((rs) => [...rs, { key: newKey(), caseNo: rs.at(-1)?.caseNo ?? '', partNo: '', description: '', plQty: 0, counted: 0, invQty: null, invLine: null, zoneId: null }])}>
            + เพิ่มรายการ
          </BigButton>
        }
      >
        <Segmented
          label="วิธีตรวจรับ"
          value={how}
          onChange={setHow}
          options={[
            ['check', 'ตรวจทีละเคสในใบตรวจรับ (แนะนำ)'],
            ['direct', 'กรอกยอดนับที่นี่แล้วรับเลย'],
          ]}
        />
        <p className="text-xs text-slate-500">
          {direct
            ? 'จับคู่ด้วย Part No. ไม่ใช้ลำดับบรรทัด · ยอดที่เข้าสต็อกคือ "นับได้จริง" · ช่องเก็บจริงระบบเลือกให้ตอนยืนยัน'
            : 'ใบตรวจรับเปิดได้ทั้งมือถือและคอม หลายคนแบ่งเคสกันตรวจได้ · ช่องนับเริ่มว่าง กด "ตรง" หรือใส่ยอดที่นับได้ · ตรวจครบแล้วออก GRN (1 เคส = 1 ป้าย)'}
        </p>
        <div ref={tableRef} className={mobile ? 'flex flex-col gap-2' : 'overflow-x-auto rounded-lg ring-1 ring-slate-200'}>
          {mobile ? (
            <>
              {rows.length === 0 && <p className="py-6 text-center text-sm text-slate-500">ถ่าย Packing List ให้ AI อ่าน หรือกด "+ เพิ่มรายการ" เพื่อกรอกเอง</p>}
              {rows.map((r, i) => {
                const c = cells(r, true)
                return (
                  <div key={r.key} className={`flex flex-col gap-2 rounded-xl border p-3 ${c.bad ? 'border-rose-200 bg-rose-50/60' : 'border-slate-200 bg-white'}`}>
                    <div className="flex items-center gap-2">
                      <span className="w-6 shrink-0 text-right font-mono text-xs text-slate-400">{i + 1}</span>
                      <div className="min-w-0 flex-1">{c.part}</div>
                      {c.remove}
                    </div>
                    {r.description && <p className="text-sm text-slate-600">{r.description}</p>}
                    <div className={`grid ${direct ? 'grid-cols-4' : 'grid-cols-3'} gap-2 text-xs text-slate-500`}>
                      <label className="flex flex-col gap-1">
                        เคส
                        {c.caseNo}
                      </label>
                      <label className="flex flex-col gap-1">
                        Packing List
                        {c.pl}
                      </label>
                      {direct && (
                        <label className="flex flex-col gap-1 font-semibold text-sky-800">
                          นับได้จริง
                          {c.counted}
                        </label>
                      )}
                      <label className="flex flex-col gap-1">
                        Invoice
                        {c.inv}
                      </label>
                    </div>
                    <label className="flex flex-col gap-1 text-xs text-slate-500">
                      โซนเก็บ
                      {c.zone}
                    </label>
                    <div className="flex flex-wrap gap-1">{c.pills}</div>
                  </div>
                )
              })}
            </>
          ) : (
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr>
                <th className={thCls}>#</th>
                <th className={thCls}>เคส</th>
                <th className={thCls}>Part No.</th>
                <th className={thCls}>รายการ</th>
                <th className={`${thCls} text-right`}>Packing List</th>
                {direct && <th className={`${thCls} text-right`}>นับได้จริง</th>}
                <th className={`${thCls} text-right`}>Invoice</th>
                <th className={thCls}>โซนเก็บ</th>
                <th className={thCls}>ผล</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className={`${tdCls} py-8 text-center text-slate-500`}>
                    ถ่าย Packing List ให้ AI อ่าน, กด "+ เพิ่มรายการ" เพื่อกรอกเอง หรือกด "ใช้เอกสารตัวอย่าง"
                  </td>
                </tr>
              )}
              {rows.map((r, i) => {
                const c = cells(r, false)
                return (
                  <tr key={r.key} className={c.bad ? 'bg-rose-50/60' : undefined}>
                    <td className={`${tdCls} text-right font-mono text-slate-400`}>{i + 1}</td>
                    <td className={tdCls}>{c.caseNo}</td>
                    <td className={tdCls}>{c.part}</td>
                    <td className={`${tdCls} max-w-[260px] text-slate-600`}>{r.description}</td>
                    <td className={`${tdCls} text-right`}>{c.pl}</td>
                    {direct && <td className={`${tdCls} text-right`}>{c.counted}</td>}
                    <td className={`${tdCls} text-right`}>{c.inv}</td>
                    <td className={tdCls}>{c.zone}</td>
                    <td className={`${tdCls} space-x-1 space-y-1`}>{c.pills}</td>
                    <td className={tdCls}>{c.remove}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          )}
          <datalist id="wms-parts">
            {master.parts.map((p) => (
              <option key={p.partNo} value={p.partNo}>
                {p.name}
              </option>
            ))}
          </datalist>
        </div>
      </Card>

      {!(mobile && rows.length === 0) && (
      <div className={`sticky bottom-2 z-20 flex flex-wrap items-center justify-between rounded-xl border-2 border-sky-700 bg-white shadow-lg ${mobile ? 'gap-2 px-3 py-2' : 'gap-3 px-4 py-3'}`}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <strong className="text-base">
            {rows.length} รายการ{direct ? '' : ` · ${caseCount} เคส`} · {fmt(total)} ชิ้น
          </strong>
          {direct && <Pill tone={offPl ? 'bad' : 'ok'}>{offPl ? `ต่างจาก PL ${offPl}` : 'ตรง PL ทุกรายการ'}</Pill>}
          {direct && (inv.invoiceNo || existing) && <Pill tone={offInv ? 'bad' : 'ok'}>{offInv ? `ไม่ตรง Invoice ${offInv}` : 'ตรง Invoice'}</Pill>}
          {mi3 > 0 && <Pill tone="mi3">ส่ง MI3 {mi3} รายการ</Pill>}
          {unknown > 0 && <Pill tone="warn">ไม่มีใน Master {unknown}</Pill>}
          {settings.mode === 'trial' && <Pill tone="warn">โหมดทดลอง</Pill>}
        </div>
        <div className={`flex items-center gap-3 ${mobile ? 'w-full flex-col items-stretch gap-1' : ''}`}>
          {problems.length > 0 && <span className="text-xs text-rose-600">{problems[0]}</span>}
          <BigButton disabled={busy || problems.length > 0} onClick={direct ? submit : submitCheck} className={`!py-3 text-base ${mobile ? 'w-full' : ''}`}>
            {busy ? 'กำลังบันทึก…' : direct ? 'ยืนยันรับเข้า → ออก GRN' : 'สร้างใบตรวจรับ → ตรวจทีละเคส'}
          </BigButton>
        </div>
      </div>
      )}
    </div>
  )
}
