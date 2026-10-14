import { useEffect, useState } from 'react'
import { BRAND } from '../../data/brand'
import { matchInvoice, mockInvoiceReader, modelRequiresInspection, suggestZone, type MatchStatus } from '../../inventory/extraction'
import { MODELS, PARTS } from '../../inventory/masterData'
import type { InventoryApi } from '../../inventory/useInventory'
import { qwenAvailable, readInvoiceWithQwen } from '../../inventory/qwenReader'
import { bangkokDate } from '../../inventory/reports'
import type { ExtractedInvoice } from '../../inventory/types'
import type { Zone } from '../../types/layout'
import { fmt, inputCls } from './format'
import { Button, Chip, ErrorNote, Panel } from './ui'

type Step = 'capture' | 'verify' | 'count' | 'done'

interface Line {
  readPartNo: string
  description: string
  invoiceQty: number
  status: MatchStatus
  message: string
  partNo: string
  confirmed: boolean
  zoneId: string
  counted: number
  damaged: number
}

interface Props {
  api: InventoryApi
  zones: Zone[]
  onShowZone: (zoneId: string) => void
  onOpenReport: () => void
}

const STEPS: { key: Step; label: string }[] = [
  { key: 'capture', label: 'ถ่ายภาพ Invoice' },
  { key: 'verify', label: 'ตรวจกับ Master' },
  { key: 'count', label: 'นับของจริง' },
  { key: 'done', label: 'ผลการรับเข้า' },
]

export function ReceiveWizard({ api, zones, onShowZone, onOpenReport }: Props) {
  const [step, setStep] = useState<Step>('capture')
  const [image, setImage] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [sample, setSample] = useState<'k1g' | 'j1a' | 'j1d'>('k1g')
  const [reading, setReading] = useState(false)
  const [invoice, setInvoice] = useState<ExtractedInvoice | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [error, setError] = useState<string | null>(null)

  // ปล่อย URL ของภาพตัวอย่างเมื่อเปลี่ยนภาพหรือออกจากหน้า
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  function pickImage(file: File | null) {
    setImage(file)
    setPreview(file ? URL.createObjectURL(file) : null)
  }

  const zoneName = (id: string) => zones.find((z) => z.id === id)?.name ?? id
  const storageZones = zones.filter((z) => z.kind === 'storage' || z.kind === 'tent' || z.kind === 'receiving')
  const suggested = (partNo: string) => {
    const part = PARTS.find((p) => p.partNo === partNo)
    return part ? suggestZone(part) : null
  }
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  /** อ่าน invoice: ใช้ Qwen จริงเมื่อมีภาพและตั้งค่า Supabase ไว้ ไม่เช่นนั้นใช้ invoice ตัวอย่าง */
  async function read(useSample = false) {
    setReading(true)
    setError(null)
    let result: ExtractedInvoice
    try {
      result = qwenAvailable && image && !useSample ? (await readInvoiceWithQwen(image)).invoice : await mockInvoiceReader.read(image, sample)
    } catch (e) {
      setError(`อ่านด้วย Qwen ไม่สำเร็จ: ${(e as Error).message} — ถ่ายใหม่ให้ชัดขึ้น หรือใช้ invoice ตัวอย่างแทน`)
      setReading(false)
      return
    }
    // ค่าที่ AI อ่านไม่ได้: ใช้ค่าเริ่มต้นแล้วให้พนักงานแก้ในขั้นตอนตรวจ
    if (!MODELS.some((m) => m.code === result.model)) result.model = 'K1G'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result.invoiceDate)) result.invoiceDate = bangkokDate()
    setInvoice(result)
    setLines(
      matchInvoice(result).map((m) => ({
        readPartNo: m.readPartNo,
        description: m.description,
        invoiceQty: m.qty,
        status: m.status,
        message: m.message,
        partNo: m.part?.partNo ?? '',
        confirmed: m.status === 'exact',
        zoneId: m.zoneId ?? '',
        counted: m.qty,
        damaged: 0,
      })),
    )
    setReading(false)
    setStep('verify')
  }

  function choosePart(i: number, partNo: string) {
    const part = PARTS.find((p) => p.partNo === partNo)
    update(i, { partNo, confirmed: !!part, zoneId: part ? (suggestZone(part) ?? '') : '' })
  }

  function fillSampleCount() {
    // ตัวอย่างผลนับ: SPOKE ขาด 50 ชิ้น และ RIM หน้าเสียหาย 2 วง
    setLines((ls) =>
      ls.map((l) => {
        const type = PARTS.find((p) => p.partNo === l.partNo)?.type
        if (type === 'SPOKE') return { ...l, counted: l.invoiceQty - 50, damaged: 0 }
        if (l.partNo === 'RAJ00537/B') return { ...l, counted: l.invoiceQty, damaged: 2 }
        return { ...l, counted: l.invoiceQty, damaged: 0 }
      }),
    )
  }

  function confirmReceive() {
    if (!invoice) return
    const res = api.receive(
      {
        invoiceNo: invoice.invoiceNo.trim(),
        invoiceDate: invoice.invoiceDate,
        supplier: invoice.supplier,
        customerId: 'RE',
        model: invoice.model,
        provider: invoice.provider,
      },
      lines.map((l) => ({ partNo: l.partNo, invoiceQty: l.invoiceQty, countedQty: l.counted, damagedQty: l.damaged, zoneId: l.zoneId })),
    )
    if (res.ok) {
      setError(null)
      setStep('done')
    } else setError(res.error)
  }

  function restart() {
    setStep('capture')
    pickImage(null)
    setInvoice(null)
    setLines([])
    setError(null)
  }

  const allMatched = lines.length > 0 && lines.every((l) => l.partNo && l.confirmed && l.zoneId)
  const needsQc = invoice ? modelRequiresInspection(invoice.model) : false

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-wrap gap-2 text-xs">
        {STEPS.map((s, i) => {
          const active = s.key === step
          const done = STEPS.findIndex((x) => x.key === step) > i
          return (
            <li
              key={s.key}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 ring-1 ${active ? 'font-semibold text-white ring-transparent' : done ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-white text-slate-500 ring-slate-200'}`}
              style={active ? { background: BRAND.primary } : undefined}
            >
              <span className="tabular-nums">{i + 1}</span> {s.label}
            </li>
          )
        })}
      </ol>

      {step === 'capture' && (
        <Panel title="1. ถ่ายภาพ Invoice ที่มากับรถส่งของ">
          <div className="grid gap-4 md:grid-cols-2">
            <label
              htmlFor="invoice-photo"
              className="flex min-h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500 hover:border-sky-400"
            >
              {preview ? (
                <img src={preview} alt="ภาพ invoice" className="max-h-64 rounded object-contain" />
              ) : (
                <>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                    <circle cx="12" cy="13" r="3.5" />
                  </svg>
                  <span>แตะเพื่อถ่ายภาพหรือเลือกไฟล์ invoice</span>
                </>
              )}
              <input
                id="invoice-photo"
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
              />
            </label>
            <div className="flex flex-col gap-3 text-sm">
              {qwenAvailable ? (
                <p className="rounded-md bg-sky-50 px-3 py-2 text-sky-800 ring-1 ring-sky-200">
                  ระบบจะส่งภาพให้ <b>Qwen-VL</b> อ่านรายการ แล้วให้คุณตรวจทุกบรรทัดก่อนรับเข้า
                </p>
              ) : (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800 ring-1 ring-amber-200">
                  <b>โหมดจำลอง:</b> ยังไม่ได้ต่อ Qwen-VL จริง ระบบจะคืนข้อมูล invoice ตัวอย่างที่เลือกด้านล่างไม่ว่าภาพจะเป็นอะไร
                </p>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-slate-500">Invoice ตัวอย่าง</span>
                <select id="sample-invoice" className={inputCls} value={sample} onChange={(e) => setSample(e.target.value as 'k1g' | 'j1a' | 'j1d')}>
                  <option value="k1g">Royal Enfield K1G — 8 รายการ (เบิก MRA ได้ทันที)</option>
                  <option value="j1a">Royal Enfield J1A — 6 รายการ (ต้องผ่าน MI3)</option>
                  <option value="j1d">Royal Enfield J1D — ลูกปืน 150324/A (ต้องผ่าน MI3)</option>
                </select>
              </label>
              {qwenAvailable ? (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => read()} disabled={reading || !image}>
                    {reading ? 'Qwen กำลังอ่าน invoice…' : 'อ่าน invoice ด้วย Qwen'}
                  </Button>
                  <Button variant="secondary" onClick={() => read(true)} disabled={reading}>
                    ใช้ invoice ตัวอย่าง
                  </Button>
                </div>
              ) : (
                <Button onClick={() => read(true)} disabled={reading}>
                  {reading ? 'กำลังอ่าน invoice…' : 'อ่าน invoice ด้วย AI (จำลอง)'}
                </Button>
              )}
              <ErrorNote message={error} />
            </div>
          </div>
        </Panel>
      )}

      {step === 'verify' && invoice && (
        <Panel title="2. ตรวจรายการที่อ่านได้กับ Part Master และโซนจัดเก็บ">
          <div className="mb-3 grid gap-3 text-sm sm:grid-cols-4">
            <label className="flex flex-col gap-1">
              <span className="text-slate-500">เลขที่ Invoice</span>
              <input id="invoice-no" className={inputCls} value={invoice.invoiceNo} onChange={(e) => setInvoice({ ...invoice, invoiceNo: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-slate-500">วันที่</span>
              <input id="invoice-date" type="date" className={inputCls} value={invoice.invoiceDate} onChange={(e) => setInvoice({ ...invoice, invoiceDate: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-slate-500">Model</span>
              <select id="invoice-model" className={inputCls} value={invoice.model} onChange={(e) => setInvoice({ ...invoice, model: e.target.value })}>
                {MODELS.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.code}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col justify-end">
              {needsQc ? <Chip tone="warn">Model นี้ต้องผ่าน MI3 ก่อนเบิก</Chip> : <Chip tone="ok">เบิก MRA ได้ทันทีหลังรับเข้า</Chip>}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="py-2 pr-2">อ่านได้</th>
                  <th className="pr-2">Part ใน Master</th>
                  <th className="pr-2 text-right">จำนวน</th>
                  <th className="pr-2">โซนจัดเก็บ</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const part = PARTS.find((p) => p.partNo === l.partNo)
                  return (
                    <tr key={i} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-2">
                        <div className="font-mono text-xs">{l.readPartNo}</div>
                        <div className="text-xs text-slate-500">{l.description}</div>
                      </td>
                      <td className="pr-2">
                        <select id={`part-${i}`} className={inputCls} value={l.partNo} onChange={(e) => choosePart(i, e.target.value)}>
                          <option value="">— เลือก part —</option>
                          {PARTS.map((p) => (
                            <option key={p.partNo} value={p.partNo}>
                              {p.partNo} · {p.type}
                            </option>
                          ))}
                        </select>
                        {part && <div className="mt-0.5 text-[11px] text-slate-500">{part.description}</div>}
                      </td>
                      <td className="pr-2 text-right tabular-nums">{fmt(l.invoiceQty)}</td>
                      <td className="pr-2">
                        <select id={`zone-${i}`} aria-label="โซนจัดเก็บ" className={inputCls} value={l.zoneId} onChange={(e) => update(i, { zoneId: e.target.value })}>
                          <option value="">— เลือกโซน —</option>
                          {storageZones.map((z) => (
                            <option key={z.id} value={z.id}>
                              {z.name}
                            </option>
                          ))}
                        </select>
                        {l.zoneId && (
                          <button className="mt-0.5 text-[11px] text-sky-700 underline-offset-2 hover:underline" onClick={() => onShowZone(l.zoneId)}>
                            {l.zoneId === suggested(l.partNo) ? 'ระบบแนะนำ' : 'เลือกเอง'} · ดูบนผัง ↗
                          </button>
                        )}
                      </td>
                      <td className="text-xs">
                        <div className="flex flex-col items-start gap-1">
                          <Chip tone={l.status === 'exact' ? 'ok' : l.status === 'corrected' ? 'warn' : 'bad'}>
                            {l.status === 'exact' ? 'ตรง Master' : l.status === 'corrected' ? 'ระบบแก้รหัส' : 'ไม่พบใน Master'}
                          </Chip>
                          {l.status !== 'exact' && <span className="text-slate-600">{l.message}</span>}
                          {l.status === 'corrected' && (
                            <label className="flex items-center gap-1">
                              <input id={`confirm-${i}`} type="checkbox" checked={l.confirmed} onChange={(e) => update(i, { confirmed: e.target.checked })} />
                              ยืนยันว่าถูกต้อง
                            </label>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap justify-between gap-2">
            <Button variant="secondary" onClick={restart}>
              ถ่ายใหม่
            </Button>
            <Button onClick={() => setStep('count')} disabled={!allMatched}>
              ไปขั้นตอนนับของจริง
            </Button>
          </div>
        </Panel>
      )}

      {step === 'count' && invoice && (
        <Panel
          title={`3. นับของจริงเทียบ Invoice ${invoice.invoiceNo}`}
          action={
            <Button variant="ghost" onClick={fillSampleCount}>
              ใส่ผลนับตัวอย่าง (มีขาด/เสียหาย)
            </Button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="py-2 pr-2">Part</th>
                  <th className="pr-2 text-right">ตาม Invoice</th>
                  <th className="pr-2">นับได้จริง</th>
                  <th className="pr-2">ในนั้นเสียหาย</th>
                  <th>ผล</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const diff = l.counted - l.invoiceQty
                  return (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-2 pr-2">
                        <div className="font-mono text-xs">{l.partNo}</div>
                        <div className="text-[11px] text-slate-500">{zoneName(l.zoneId)}</div>
                      </td>
                      <td className="pr-2 text-right tabular-nums">{fmt(l.invoiceQty)}</td>
                      <td className="w-32 pr-2">
                        <input id={`counted-${i}`} type="number" min={0} className={inputCls} value={l.counted} onChange={(e) => update(i, { counted: Math.max(0, Math.floor(Number(e.target.value))) })} />
                      </td>
                      <td className="w-28 pr-2">
                        <input id={`damaged-${i}`} type="number" min={0} className={inputCls} value={l.damaged} onChange={(e) => update(i, { damaged: Math.max(0, Math.floor(Number(e.target.value))) })} />
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {diff === 0 && l.damaged === 0 && <Chip tone="ok">ตรง</Chip>}
                          {diff < 0 && <Chip tone="bad">ขาด {fmt(-diff)}</Chip>}
                          {diff > 0 && <Chip tone="warn">เกิน {fmt(diff)}</Chip>}
                          {l.damaged > 0 && <Chip tone="bad">เสียหาย {fmt(l.damaged)}</Chip>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            ยอดสภาพดีเข้า <b>BOI (Actual Receive)</b> · ของเสียหายเข้า <b>NG ส่งคืน Supplier</b> · ส่วนที่ขาดหรือเกินจะอยู่ในรายงานความต่าง
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <ErrorNote message={error} />
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="secondary" onClick={() => setStep('verify')}>
                ย้อนกลับ
              </Button>
              <Button onClick={confirmReceive}>ยืนยันรับเข้า</Button>
            </div>
          </div>
        </Panel>
      )}

      {step === 'done' && invoice && (
        <Panel title={`รับเข้าเรียบร้อย · Invoice ${invoice.invoiceNo}`}>
          <ReceiveSummary lines={lines} needsQc={needsQc} zoneName={zoneName} />
          <div className="mt-4 flex flex-wrap justify-between gap-2">
            <Button variant="secondary" onClick={restart}>
              รับ Invoice ใบถัดไป
            </Button>
            <Button onClick={onOpenReport}>ดูใบรายงาน STOCK</Button>
          </div>
        </Panel>
      )}
    </div>
  )
}

function ReceiveSummary({ lines, needsQc, zoneName }: { lines: Line[]; needsQc: boolean; zoneName: (id: string) => string }) {
  const issues = lines.filter((l) => l.counted !== l.invoiceQty || l.damaged > 0)
  return (
    <div className="flex flex-col gap-3 text-sm">
      {issues.length === 0 ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800 ring-1 ring-emerald-200">ของมาตรงกับ Invoice ทุกรายการ</p>
      ) : (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-rose-800 ring-1 ring-rose-200">
          พบความต่าง {issues.length} รายการ — ดูรายงานฉบับเต็มได้ที่แท็บ "รายงานความต่าง"
        </p>
      )}
      {needsQc && <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800 ring-1 ring-amber-200">Model นี้ต้องส่งตรวจ MI3 ก่อน MRA จึงจะเบิกได้</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="py-2 pr-2">Part</th>
              <th className="pr-2">จัดเก็บที่</th>
              <th className="pr-2 text-right">Invoice</th>
              <th className="pr-2 text-right">เข้า BOI</th>
              <th className="text-right">เข้า NG</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-1.5 pr-2 font-mono text-xs">{l.partNo}</td>
                <td className="pr-2 text-xs">{zoneName(l.zoneId)}</td>
                <td className="pr-2 text-right tabular-nums">{fmt(l.invoiceQty)}</td>
                <td className="pr-2 text-right font-semibold tabular-nums">{fmt(l.counted - l.damaged)}</td>
                <td className="text-right tabular-nums text-rose-700">{fmt(l.damaged)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
