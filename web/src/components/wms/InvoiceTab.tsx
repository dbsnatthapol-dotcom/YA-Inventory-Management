import { useEffect, useState } from 'react'
import { errorText } from '../../wms/api'
import { discrepancyText, fmt, reconcile } from '../../wms/logic'
import type { InvoiceStatus, InvoiceView } from '../../wms/types'
import { useWms } from '../../wms/useWms'
import { Alert, BigButton, Card, inputCls, Pill, tdCls, thCls, type Tone } from './ui'

const STATUS: Record<InvoiceStatus, [string, Tone]> = {
  open: ['ยังไม่ปิด', 'info'],
  complete: ['รับครบแล้ว', 'ok'],
  discrepancy_reported: ['แจ้งความต่างแล้ว', 'warn'],
  closed: ['ปิดแล้ว', 'muted'],
}

const dateTime = (iso: string) => new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })

export function InvoiceTab({ onOpenGrn }: { onOpenGrn: (grnId: string) => void }) {
  const { api, can } = useWms()
  const [query, setQuery] = useState('')
  const [view, setView] = useState<InvoiceView | null>(null)
  const [list, setList] = useState<{ id: string; invoiceNo: string; status: InvoiceStatus; createdAt: string }[]>([])
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'info'; text: string } | null>(null)
  const [report, setReport] = useState<string | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    let alive = true
    api.listInvoices(30).then((l) => alive && setList(l)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [api, view])

  const search = async (q: string) => {
    setQuery(q)
    setMsg(null)
    setReport(null)
    try {
      const v = await api.invoiceView(q)
      setView(v)
      if (!v) setMsg({ tone: 'info', text: `ไม่พบ "${q}" · ค้นได้ด้วยเลข Invoice, PO หรือ REF ของ Packing List` })
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    }
  }

  const rows = view ? reconcile(view) : []
  const off = rows.filter((r) => r.diff !== 0)

  const setStatus = async (status: InvoiceStatus) => {
    if (!view) return
    try {
      await api.invoiceSetStatus(view.invoice.id, status, note)
      setMsg({ tone: 'ok', text: status === 'complete' ? `ยืนยัน Invoice ${view.invoice.invoiceNo} รับครบแล้ว` : status === 'discrepancy_reported' ? 'บันทึกว่าแจ้งลูกค้าแล้ว' : 'เปิด Invoice ใหม่แล้ว' })
      setView(await api.invoiceView(view.invoice.invoiceNo))
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    }
  }

  const copy = async () => {
    if (!report) return
    try {
      await navigator.clipboard.writeText(report)
      setMsg({ tone: 'ok', text: 'คัดลอกข้อความแล้ว · วางในอีเมล / LINE ส่งลูกค้าได้เลย' })
    } catch {
      setMsg({ tone: 'info', text: 'คัดลอกอัตโนมัติไม่ได้ · เลือกข้อความแล้วกดคัดลอกเอง' })
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <Card title="Invoice ล่าสุด">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void search(query)
          }}
        >
          <input id="inv-search" className={`${inputCls} font-mono`} placeholder="เลข Invoice / PO / PL" value={query} onChange={(e) => setQuery(e.target.value)} />
          <BigButton type="submit">ค้นหา</BigButton>
        </form>
        <div className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto">
          {list.length === 0 && <p className="text-sm text-slate-500">ยังไม่มี Invoice · จะขึ้นเมื่อรับของพร้อมเลข Invoice</p>}
          {list.map((i) => (
            <button key={i.id} onClick={() => void search(i.invoiceNo)} className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm ${view?.invoice.id === i.id ? 'border-sky-600 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'}`}>
              <span>
                <span className="block font-mono font-semibold">{i.invoiceNo}</span>
                <span className="text-xs text-slate-500">{dateTime(i.createdAt)}</span>
              </span>
              <Pill tone={STATUS[i.status][1]}>{STATUS[i.status][0]}</Pill>
            </button>
          ))}
        </div>
      </Card>

      <div className="flex min-w-0 flex-col gap-4">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {!view ? (
          <Card>
            <p className="py-10 text-center text-slate-500">เลือก Invoice ทางซ้าย หรือค้นด้วยเลข Invoice / PO / Packing List</p>
          </Card>
        ) : (
          <>
            <Card
              eyebrow="Invoice"
              title={<span className="font-mono text-xl">{view.invoice.invoiceNo}</span>}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={STATUS[view.invoice.status][1]}>{STATUS[view.invoice.status][0]}</Pill>
                  {off.length ? <Pill tone="bad">ไม่ตรง {off.length} รายการ</Pill> : <Pill tone="ok">ตรงทุกรายการ</Pill>}
                </div>
              }
            >
              <div className="text-sm text-slate-600">
                {view.invoice.poNo && `PO ${view.invoice.poNo} · `}
                {view.invoice.docDate && `ลงวันที่ ${view.invoice.docDate} · `}
                {view.invoice.movementType && `Movement ${view.invoice.movementType}`}
                {view.invoice.statusNote && <div className="mt-1 text-slate-500">หมายเหตุ: {view.invoice.statusNote}</div>}
              </div>
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">รับตาม Packing List มาแล้ว {view.grns.length} เที่ยว</div>
                <div className="flex flex-col gap-1.5">
                  {view.grns.map((g) => (
                    <button key={g.id} onClick={() => onOpenGrn(g.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50">
                      <span>
                        <span className="font-mono font-semibold">{g.grnNo}</span> · {dateTime(g.receivedAt)}
                        <span className="block text-xs text-slate-500">
                          PL {g.plRef}
                          {g.soNo ? ` · SO ${g.soNo}` : ''}
                          {g.packages ? ` · หีบ ${g.packages}` : ''} · ผู้รับ {g.receiverCode}
                        </span>
                      </span>
                      <span className="text-xs text-sky-700">ดูป้าย →</span>
                    </button>
                  ))}
                </div>
              </div>
            </Card>

            <Card title="กระทบยอด: Invoice เทียบรับจริงรวมทุกเที่ยว">
              <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr>
                      <th className={thCls}>บรรทัด</th>
                      <th className={thCls}>Part No.</th>
                      <th className={thCls}>รายการ</th>
                      <th className={`${thCls} text-right`}>Invoice</th>
                      <th className={`${thCls} text-right`}>รับจริงรวม</th>
                      <th className={`${thCls} text-right`}>ต่าง</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.lineNo}-${r.partNo}`} className={r.diff ? 'bg-rose-50/60' : undefined}>
                        <td className={`${tdCls} font-mono text-slate-500`}>{r.lineNo ?? '–'}</td>
                        <td className={`${tdCls} font-mono font-semibold`}>{r.partNo}</td>
                        <td className={`${tdCls} text-slate-600`}>{r.description}</td>
                        <td className={`${tdCls} text-right font-mono`}>{fmt(r.invoiceQty)}</td>
                        <td className={`${tdCls} text-right font-mono`}>{fmt(r.receivedQty)}</td>
                        <td className={`${tdCls} text-right font-mono font-semibold ${r.diff ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {r.diff > 0 ? '+' : ''}
                          {fmt(r.diff)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <input id="inv-note" className={inputCls} placeholder="หมายเหตุ (ถ้ามี) เช่น ส่งอีเมลถึงคุณ… วันที่…" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                {can('invoice.close') && (
                  <BigButton disabled={off.length > 0 || view.invoice.status === 'complete'} onClick={() => void setStatus('complete')} title={off.length ? 'ยังมีรายการไม่ตรง' : ''}>
                    ยืนยัน Invoice นี้รับครบ
                  </BigButton>
                )}
                <BigButton tone="secondary" onClick={() => setReport(discrepancyText(view, rows))}>
                  สร้างรายงานความต่างส่งลูกค้า
                </BigButton>
                {can('invoice.close') && view.invoice.status !== 'open' && (
                  <BigButton tone="ghost" onClick={() => void setStatus('open')}>
                    เปิดกลับเป็น "ยังไม่ปิด"
                  </BigButton>
                )}
              </div>
              {!can('invoice.close') && <p className="text-xs text-slate-500">การยืนยันรับครบทำได้เฉพาะผู้มีสิทธิ์ (เช่น วิศวกร / ผู้จัดการ)</p>}
              {report && (
                <div className="flex flex-col gap-2">
                  <textarea id="inv-report" readOnly className="h-56 w-full rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs" value={report} onFocus={(e) => e.target.select()} />
                  <div className="flex flex-wrap gap-2">
                    <BigButton tone="secondary" onClick={() => void copy()}>
                      คัดลอกข้อความ
                    </BigButton>
                    {can('invoice.report') && (
                      <BigButton tone="secondary" onClick={() => void setStatus('discrepancy_reported')}>
                        บันทึกว่าแจ้งลูกค้าแล้ว
                      </BigButton>
                    )}
                  </div>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
