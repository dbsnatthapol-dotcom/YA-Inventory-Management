import { useEffect, useMemo, useState } from 'react'
import { errorText } from '../../wms/api'
import { buildLedger, monthRange, type LedgerSheet } from '../../wms/ledger'
import { fmt } from '../../wms/logic'
import { partsOfModel } from '../../wms/partCodes'
import type { LedgerRow, StockClosing } from '../../wms/types'
import { useWms } from '../../wms/useWms'
import { thisMonth } from '../../wms/closing'
import { ClosingPanel, MonthOverview } from './ClosingPanel'
import { PrintDialog } from './Print'
import { LedgerPage } from './ReportPages'
import { Alert, BigButton, Card, Field, inputCls, Pill, tdCls, thCls } from './ui'

const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`
const num = (n: number) => (n ? fmt(n) : '')

/**
 * บัญชีคุมสินค้า FM-P-537: ระบบสร้างจากรายการรับ/เบิก/NG/QC จริง ไม่ต้องคีย์ซ้ำ
 * ดูบนจอทีละ part หรือ Export Excel ทั้ง Model (1 sheet ต่อ part แบบฟอร์มเดิม)
 */
export function LedgerTab() {
  const { api, master } = useWms()
  const [model, setModel] = useState(master.models[0]?.code ?? '')
  const [month, setMonth] = useState(thisMonth)
  const [rows, setRows] = useState<LedgerRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [closings, setClosings] = useState<StockClosing[]>([])
  const [ver, setVer] = useState(0)
  const [printing, setPrinting] = useState(false)
  const parts = useMemo(() => (model ? partsOfModel(master, model) : []), [master, model])

  useEffect(() => {
    if (!parts.length) return
    let alive = true
    api
      .ledgerRows(
        parts.map((p) => p.partNo),
        monthRange(month).to,
      )
      .then((r) => {
        if (!alive) return
        setRows(r)
        setError(null)
      })
      .catch((e) => alive && setError(errorText(e)))
    return () => {
      alive = false
    }
  }, [api, parts, month, ver])

  useEffect(() => {
    let alive = true
    api
      .listClosings()
      .then((c) => alive && setClosings(c))
      .catch(() => alive && setClosings([]))
    return () => {
      alive = false
    }
  }, [api, ver])
  const closing = closings.find((c) => c.modelCode === model && c.month === month) ?? null

  const all = useMemo(() => (rows ? buildLedger(rows, parts, month) : []), [rows, parts, month])
  // ค่าเริ่มต้น: เฉพาะ part ที่มีความเคลื่อนไหวหรือมีของ (Model หนึ่งมีหลายรุ่นย่อย/สี ที่ไม่ได้ใช้ทุกเดือน)
  const sheets = showAll ? all : all.filter((s) => s.lines.length || s.opening || s.closing)
  const sheet = sheets.find((s) => s.partNo === picked) ?? sheets[0]

  const exportXlsx = async () => {
    setBusy(true)
    try {
      const { exportLedger } = await import('../../wms/ledgerExcel')
      await exportLedger(model, month, sheets, closing)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card
        title={
          <span className="flex items-center gap-2">
            บัญชีคุมสินค้า FM-P-537
            {closing?.status === 'closed' && <Pill tone="ok">ปิดยอดแล้ว</Pill>}
          </span>
        }
        eyebrow="สร้างจากรายการรับเข้า / เบิก / NG / QC ในระบบ · 1 ไฟล์ต่อ Model, 1 sheet ต่อ Part"
        action={
          <div className="flex gap-2">
            <BigButton tone="secondary" disabled={!sheets.length} onClick={() => setPrinting(true)}>
              พิมพ์ ({sheets.length} part)
            </BigButton>
            <BigButton disabled={busy || !sheets.length} onClick={() => void exportXlsx()}>
              {busy ? 'กำลังสร้างไฟล์…' : `Export Excel (${sheets.length} part)`}
            </BigButton>
          </div>
        }
      >
        <div className="flex flex-wrap gap-3">
          <Field label="Model">
            <select className={inputCls} value={model} onChange={(e) => setModel(e.target.value)}>
              {master.models.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="เดือน">
            <input type="month" className={inputCls} value={month} onChange={(e) => setMonth(e.target.value || thisMonth())} />
          </Field>
          <label className="flex min-h-[44px] items-center gap-2 self-end text-sm text-slate-600">
            <input type="checkbox" className="h-5 w-5" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            รวม part ที่ไม่มีความเคลื่อนไหว ({all.length - all.filter((s) => s.lines.length || s.opening || s.closing).length})
          </label>
        </div>
        {rows && !sheets.length && parts.length > 0 && <p className="text-sm text-slate-500">เดือนนี้ยังไม่มีรับ/เบิกของ {model}</p>}
        {!parts.length && <Alert tone="warn">Model นี้ยังไม่มี part ใน Master · ตั้งในหน้าหลังบ้าน → ข้อมูลหลัก → Part</Alert>}
        {error && <Alert tone="bad">{error}</Alert>}
      </Card>

      {model && rows && (
        <ClosingPanel
          model={model}
          month={month}
          sheets={all}
          closing={closing}
          onChanged={() => setVer((v) => v + 1)}
        />
      )}
      <PrintDialog
        open={printing}
        onClose={() => setPrinting(false)}
        format="a4"
        title="ตัวอย่างก่อนพิมพ์ · บัญชีคุม FM-P-537"
        subtitle={`${model} · ${month} · ${sheets.length} part (1 หน้าต่อ part)`}
        printLabel={`พิมพ์ ${sheets.length} หน้า`}
      >
        {sheets.map((s) => (
          <LedgerPage key={s.partNo} sheet={s} model={model} month={month} closing={closing} />
        ))}
      </PrintDialog>
      <MonthOverview month={month} models={master.models.map((m) => m.code)} closings={closings} current={model} onPick={setModel} />

      {sheets.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Card title={`Part ของ ${model} (${sheets.length})`}>
            <ul className="flex max-h-[65vh] flex-col gap-1 overflow-y-auto">
              {sheets.map((s) => (
                <li key={s.partNo}>
                  <button
                    onClick={() => setPicked(s.partNo)}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ring-1 ${s.partNo === sheet?.partNo ? 'bg-sky-50 ring-sky-600' : 'ring-slate-200 hover:bg-slate-50'}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono font-semibold">{s.partNo}</span>
                      <span className="block truncate text-xs text-slate-500">{[s.uamCode, s.name].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="text-right font-mono text-xs">
                      <span className="block font-semibold">{fmt(s.closing)}</span>
                      <span className="text-slate-400">{s.lines.length} บรรทัด</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {sheet && <SheetView sheet={sheet} model={model} month={month} />}
        </div>
      )}
    </div>
  )
}

/** หน้าบัญชีคุม 1 part แบบเดียวกับกระดาษ FM-P-537 */
function SheetView({ sheet, model, month }: { sheet: LedgerSheet; model: string; month: string }) {
  return (
    <Card title={`STOCK PARTS ${model} · ${month}`} eyebrow={`PART : ${sheet.partNo} ${sheet.name}${sheet.uamCode ? ` (UAM ${sheet.uamCode})` : ''}`} className="print:shadow-none">
      <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr>
              <th className={thCls} rowSpan={2}>
                Date
              </th>
              <th className={thCls}>เลขที่</th>
              <th className={thCls}>วันที่</th>
              <th className={thCls} rowSpan={2}>
                เลขที่ใบเบิก
              </th>
              <th className={`${thCls} text-center`} colSpan={2}>
                รับเข้า
              </th>
              <th className={`${thCls} text-right`} rowSpan={2}>
                เบิก
              </th>
              <th className={`${thCls} text-right`} rowSpan={2}>
                NG
              </th>
              <th className={`${thCls} text-right`} rowSpan={2}>
                QC เบิก
              </th>
              <th className={thCls} rowSpan={2}>
                LOT
              </th>
              <th className={`${thCls} text-right`}>Stock</th>
            </tr>
            <tr>
              <th className={thCls}>INV.</th>
              <th className={thCls}>Order No.</th>
              <th className={`${thCls} text-right`}>ปกติ</th>
              <th className={`${thCls} text-right`}>ทดแทน</th>
              <th className={`${thCls} text-right`}>(Pcs.)</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            <tr className="bg-slate-50">
              <td className={`${tdCls} font-sans font-semibold`} colSpan={10}>
                Stock ยกมา
              </td>
              <td className={`${tdCls} text-right font-semibold`}>{fmt(sheet.opening)}</td>
            </tr>
            {sheet.lines.map((l, i) => (
              <tr key={i} title={l.note ?? undefined}>
                <td className={tdCls}>{shortDate(l.date)}</td>
                <td className={tdCls}>{l.invNo ?? ''}</td>
                <td className={tdCls}>{l.orderNo ?? ''}</td>
                <td className={tdCls}>
                  {l.docNo ?? ''}
                  {l.note && <span className="block font-sans text-[11px] text-slate-400">{l.note}</span>}
                </td>
                <td className={`${tdCls} text-right`}>{num(l.recv)}</td>
                <td className={`${tdCls} text-right`}>{num(l.recvRep)}</td>
                <td className={`${tdCls} text-right ${l.issue < 0 ? 'text-emerald-700' : ''}`}>{num(l.issue)}</td>
                <td className={`${tdCls} text-right`}>{num(l.ng)}</td>
                <td className={`${tdCls} text-right`}>{num(l.qc)}</td>
                <td className={`${tdCls} text-xs`}>{l.lot ?? ''}</td>
                <td className={`${tdCls} text-right font-semibold`}>{fmt(l.stock)}</td>
              </tr>
            ))}
            {sheet.lines.length === 0 && (
              <tr>
                <td className={`${tdCls} py-6 text-center font-sans text-slate-500`} colSpan={11}>
                  ไม่มีการเคลื่อนไหวในเดือนนี้
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ['Stock ยกมา', sheet.opening],
            ['งานเข้า', sheet.totalIn],
            ['เบิกใช้', sheet.totalOut],
            ['คงเหลือ ณ สิ้นเดือน', sheet.closing],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-lg bg-slate-50 px-3 py-2">
            <dt className="text-xs text-slate-500">{k}</dt>
            <dd className="font-mono text-lg font-bold">{fmt(v)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}
