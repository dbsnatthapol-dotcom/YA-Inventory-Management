import { useState } from 'react'
import { BRAND } from '../../data/brand'
import { BUCKET_LABEL, FLOW } from '../../inventory/ledger'
import { PARTS } from '../../inventory/masterData'
import { discrepancyReport, lotTrace } from '../../inventory/reports'
import type { InventoryApi } from '../../inventory/useInventory'
import type { Zone } from '../../types/layout'
import { ReceiveWizard } from './ReceiveWizard'
import { StockReport } from './StockReport'
import { fmt, fmtTime, inputCls } from './format'
import { Button, Chip, Panel } from './ui'

type Tab = 'receive' | 'stock' | 'discrepancy' | 'trace'

const TABS: { key: Tab; label: string }[] = [
  { key: 'receive', label: 'รับสินค้าเข้า' },
  { key: 'stock', label: 'ใบรายงาน STOCK' },
  { key: 'discrepancy', label: 'รายงานความต่าง' },
  { key: 'trace', label: 'ติดตาม Lot / Invoice' },
]

interface Props {
  api: InventoryApi
  zones: Zone[]
  onShowZone: (zoneId: string) => void
}

export function InventoryPage({ api, zones, onShowZone }: Props) {
  const [tab, setTab] = useState<Tab>('receive')
  const [traceQuery, setTraceQuery] = useState('')

  const openTrace = (lotId: string) => {
    setTraceQuery(lotId)
    setTab('trace')
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <nav className="flex flex-wrap gap-1 rounded-lg bg-white p-1 shadow-sm" aria-label="เมนูงานคลัง">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-md px-3 py-1.5 text-sm transition ${tab === t.key ? 'font-semibold text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                style={tab === t.key ? { background: BRAND.navy } : undefined}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <span className="ml-auto text-xs text-slate-500">ข้อมูลตัวอย่าง · เก็บในเบราว์เซอร์นี้เท่านั้น</span>
          <Button variant="secondary" onClick={api.resetDemo}>
            รีเซ็ตข้อมูลตัวอย่าง
          </Button>
        </div>

        {tab === 'receive' && <ReceiveWizard api={api} zones={zones} onShowZone={onShowZone} onOpenReport={() => setTab('stock')} />}
        {tab === 'stock' && <StockReport api={api} zones={zones} onShowZone={onShowZone} onTrace={openTrace} />}
        {tab === 'discrepancy' && <DiscrepancyList api={api} onTrace={openTrace} />}
        {tab === 'trace' && <TraceView api={api} query={traceQuery} onQuery={setTraceQuery} />}
      </div>
    </div>
  )
}

function DiscrepancyList({ api, onTrace }: { api: InventoryApi; onTrace: (lotId: string) => void }) {
  const receipts = [...api.state.receipts].reverse()
  return (
    <Panel title="รายงานความต่าง Invoice กับของจริง (ตามความเป็นจริง)">
      <div className="flex flex-col gap-4">
        {receipts.map((r) => {
          const lines = discrepancyReport(api.state, r.id)
          return (
            <div key={r.id} className="rounded-md border border-slate-200">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                <span className="font-mono font-semibold">{r.invoiceNo}</span>
                <Chip tone="muted">Model {r.model}</Chip>
                <span className="text-xs text-slate-500">
                  รับเมื่อ {fmtTime(r.receivedAt)} · {r.supplier} · อ่านโดย {r.provider === 'mock' ? 'AI จำลอง' : 'Qwen-VL'}
                </span>
                <span className="ml-auto">{lines.length ? <Chip tone="bad">ต่าง {lines.length} รายการ</Chip> : <Chip tone="ok">ตรงทุกรายการ</Chip>}</span>
              </div>
              {lines.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="text-xs text-slate-500">
                      <tr>
                        <th className="px-3 py-1.5">Part</th>
                        <th>รายละเอียด</th>
                        <th className="text-right">Invoice</th>
                        <th className="text-right">นับได้</th>
                        <th className="px-3">ความต่าง</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {lines.map((d, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-3 py-1.5">
                            <button className="font-mono text-xs text-sky-700 hover:underline" onClick={() => onTrace(d.lot.id)}>
                              {d.lot.partNo}
                            </button>
                          </td>
                          <td className="text-xs text-slate-600">{d.part?.description}</td>
                          <td className="text-right">{fmt(d.lot.invoiceQty)}</td>
                          <td className="text-right">{fmt(d.lot.countedQty)}</td>
                          <td className="px-3">
                            <Chip tone={d.type === 'เกิน' ? 'warn' : 'bad'}>
                              {d.type} {fmt(d.qty)}
                            </Chip>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

function TraceView({ api, query, onQuery }: { api: InventoryApi; query: string; onQuery: (q: string) => void }) {
  const q = query.trim().toUpperCase()
  const lots = q ? api.state.lots.filter((l) => l.id.toUpperCase().includes(q) || l.invoiceNo.toUpperCase().includes(q) || l.partNo.toUpperCase().includes(q)) : []
  return (
    <Panel title="ติดตาม Lot / ย้อนกลับไปหา Invoice">
      <input
        id="trace-query"
        className={inputCls}
        value={query}
        placeholder="พิมพ์เลข Invoice, เลข Lot หรือ Part No. เช่น RE-INV-2610-0141 หรือ RAJ00537/B"
        onChange={(e) => onQuery(e.target.value)}
      />
      <div className="mt-4 flex flex-col gap-4">
        {q && lots.length === 0 && <p className="text-sm text-slate-500">ไม่พบ lot ที่ตรงกับ "{query}"</p>}
        {!q && <p className="text-sm text-slate-500">ทุก lot ผูกกับบรรทัดใน invoice เมื่อเจอ NG ที่ไลน์ สามารถย้อนกลับไปหาว่ามาจาก invoice ใด รับเมื่อไร และเคลื่อนไหวอย่างไรบ้าง</p>}
        {lots.map((l) => {
          const t = lotTrace(api.state, l.id)
          const part = PARTS.find((p) => p.partNo === l.partNo)
          return (
            <div key={l.id} className="rounded-md border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{l.id}</span>
                <span className="font-mono text-xs">{l.partNo}</span>
                <span className="text-xs text-slate-500">{part?.description}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Invoice {t.receipt?.invoiceNo} ลงวันที่ {t.receipt?.invoiceDate} · {t.receipt?.supplier} · Model {l.model} · Invoice {fmt(l.invoiceQty)} / นับได้ {fmt(l.countedQty)}
              </div>
              <ol className="mt-2 flex flex-col gap-1 border-l-2 border-slate-200 pl-3">
                {t.movements.map((m) => (
                  <li key={m.id} className="text-xs">
                    <span className="tabular-nums text-slate-400">{fmtTime(m.at)}</span> · <b>{FLOW[m.kind].label}</b> {fmt(m.qty)} ชิ้น
                    <span className="text-slate-500">
                      {' '}
                      ({m.from ? BUCKET_LABEL[m.from] : 'รับจากภายนอก'} → {m.to ? BUCKET_LABEL[m.to] : 'ออกนอกระบบ'})
                    </span>
                    {m.note && <span className="text-slate-600"> · {m.note}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
