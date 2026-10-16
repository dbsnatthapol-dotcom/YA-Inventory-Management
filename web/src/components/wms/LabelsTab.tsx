import { useEffect, useState } from 'react'
import { errorText } from '../../wms/api'
import { fmt } from '../../wms/logic'
import type { Grn, GrnDetail } from '../../wms/types'
import { useWms } from '../../wms/useWms'
import { FORMAT_NAME, type LabelContext, type PrintFormat } from '../../wms/labels'
import { GrnSheet, LabelCard, LabelSheet } from './Documents'
import { PrintDialog } from './Print'
import { Alert, BigButton, Card, Pill, Segmented } from './ui'

const dateTime = (iso: string) => new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export function LabelsTab({ grnId, onSelectGrn }: { grnId: string | null; onSelectGrn: (id: string) => void }) {
  const { api, master, settings, can } = useWms()
  const [grns, setGrns] = useState<Grn[]>([])
  const [detail, setDetail] = useState<GrnDetail | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [format, setFormat] = useState<PrintFormat>('label')
  const [printOpen, setPrintOpen] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api.listGrns(40).then((g) => alive && setGrns(g)).catch((e) => alive && setMsg({ tone: 'bad', text: errorText(e) }))
    return () => {
      alive = false
    }
  }, [api, detail])

  useEffect(() => {
    if (!grnId) return
    let alive = true
    api
      .grnDetail(grnId)
      .then((d) => {
        if (!alive) return
        setDetail(d)
        setSelected(new Set(d?.lpns.filter((l) => l.status === 'active').map((l) => l.id) ?? []))
      })
      .catch((e) => alive && setMsg({ tone: 'bad', text: errorText(e) }))
    return () => {
      alive = false
    }
  }, [api, grnId])

  const lpns = detail?.lpns ?? []
  const chosen = lpns.filter((l) => selected.has(l.id))
  const ctx: LabelContext = { grn: detail?.grn ?? null, lines: detail?.lines ?? [], master, trial: settings.mode === 'trial' }
  const count = format === 'a4' ? 1 : chosen.length
  const sheets = Math.ceil(chosen.length / 4)

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const merge = async () => {
    if (!detail) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await api.mergeLpns(chosen.map((l) => l.id))
      const d = await api.grnDetail(detail.grn.id)
      setMsg({ tone: 'ok', text: `รวม ${chosen.length} ป้ายเป็นกล่องเดียวแล้ว · ป้ายใหม่ ${r.lpnNo} (ป้ายเดิมใช้ไม่ได้แล้ว พิมพ์ป้ายใหม่ไปแปะแทน)` })
      setDetail(d)
      setSelected(new Set(d?.lpns.filter((l) => l.lpnNo === r.lpnNo).map((l) => l.id) ?? []))
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 pb-28 lg:grid-cols-[300px_1fr]">
      <Card title="ใบรับสินค้า (GRN) ล่าสุด">
        <div className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto pr-1">
          {grns.length === 0 && <p className="text-sm text-slate-500">ยังไม่มีการรับของ · เริ่มที่แท็บ "รับสินค้า"</p>}
          {grns.map((g) => (
            <button
              key={g.id}
              onClick={() => onSelectGrn(g.id)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition ${detail?.grn.id === g.id ? 'border-sky-600 bg-sky-50 ring-1 ring-sky-600' : 'border-slate-200 hover:bg-slate-50'}`}
            >
              <div className="font-mono font-semibold">{g.grnNo}</div>
              <div className="text-xs text-slate-500">
                {dateTime(g.receivedAt)} · {g.modelCode ?? '-'} · PL {g.plRef}
              </div>
              {g.invoiceNo && <div className="text-xs text-slate-500">INV {g.invoiceNo}</div>}
            </button>
          ))}
        </div>
      </Card>

      <div className="flex min-w-0 flex-col gap-4">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {!detail ? (
          <Card>
            <p className="py-10 text-center text-slate-500">เลือก GRN ทางซ้ายเพื่อพิมพ์ป้ายกล่อง</p>
          </Card>
        ) : (
          <>
            <Card
              eyebrow="ขั้นที่ 1 · เลือกป้ายที่จะพิมพ์ (ทำหลังย้ายของเข้ากล่อง/พาเลท)"
              title={
                <span>
                  <span className="font-mono">{detail.grn.grnNo}</span>
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    {detail.grn.modelCode} · PL {detail.grn.plRef}
                    {detail.grn.invoiceNo ? ` · INV ${detail.grn.invoiceNo}` : ''}
                  </span>
                </span>
              }
              action={
                <div className="flex flex-wrap gap-2">
                  <BigButton tone="secondary" onClick={() => setSelected(new Set(selected.size === lpns.filter((l) => l.status === 'active').length ? [] : lpns.filter((l) => l.status === 'active').map((l) => l.id)))}>
                    {selected.size ? 'ล้างที่เลือก' : 'เลือกทั้งหมด'}
                  </BigButton>
                  {can('label.print') && (
                    <BigButton tone="secondary" disabled={busy || chosen.length < 2} onClick={merge} title="ย้ายของหลาย part มารวมในกล่องเดียว แล้วออกป้ายใหม่ 1 ใบ">
                      รวม {chosen.length > 1 ? chosen.length : ''} ป้ายเป็นกล่องเดียว
                    </BigButton>
                  )}
                </div>
              }
            >
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {lpns.map((l) => {
                  const single = l.items.length === 1 ? l.items[0] : null
                  const qty = l.items.reduce((s, i) => s + i.qty, 0)
                  return (
                    <label
                      key={l.id}
                      htmlFor={`lpn-${l.id}`}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition ${selected.has(l.id) ? 'border-sky-600 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'} ${l.status !== 'active' ? 'opacity-50' : ''}`}
                    >
                      <input id={`lpn-${l.id}`} type="checkbox" className="mt-1 h-5 w-5" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono font-semibold">{single ? single.partNo : `กล่องรวม ${l.items.length} part`}</span>
                        <span className="block truncate text-xs text-slate-500">{single ? (detail.lines.find((x) => x.id === single.grnLineId)?.description ?? '') : l.items.map((i) => i.partNo).join(', ')}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          <Pill tone="muted">{l.lpnNo}</Pill>
                          {l.hold ? <Pill tone="mi3">รอ MI3</Pill> : l.status === 'empty' ? <Pill tone="muted">ใช้หมดแล้ว</Pill> : null}
                        </span>
                      </span>
                      <span className="font-mono font-semibold">{fmt(qty)}</span>
                    </label>
                  )
                })}
              </div>
            </Card>

            <Card eyebrow="ขั้นที่ 2 · เลือกรูปแบบพิมพ์">
              <Segmented label="รูปแบบพิมพ์" value={format} onChange={setFormat} options={[['label', FORMAT_NAME.label], ['sheet', FORMAT_NAME.sheet], ['a4', FORMAT_NAME.a4]]} />
              <p className="text-sm text-slate-500">
                {format === 'label' && 'ขนาดเดียวกับใบปะหน้าพัสดุ ใช้กับเครื่องพิมพ์ฉลาก 4 นิ้ว (รวมเครื่องพกพา) 1 ป้ายต่อ 1 กล่อง'}
                {format === 'sheet' && 'ใช้เครื่องพิมพ์ A4 ธรรมดา ตัดแบ่ง 4 ป้ายต่อแผ่น'}
                {format === 'a4' && 'ใบรับสินค้าทั้งเที่ยว พร้อม QR และช่องเซ็น ใช้แนบ Packing List เก็บแฟ้ม'}
              </p>
              <div className="overflow-x-auto rounded-xl bg-slate-100 p-4">
                <div className="flex w-max gap-4">
                  {format === 'a4' ? <div className="origin-top-left scale-[0.6]" style={{ height: '180mm' }}><GrnSheet ctx={ctx} /></div> : chosen.slice(0, 2).map((l) => <LabelCard key={l.id} lpn={l} ctx={ctx} />)}
                  {format !== 'a4' && chosen.length === 0 && <p className="text-sm text-slate-500">ยังไม่ได้เลือกป้าย</p>}
                </div>
              </div>
            </Card>
          </>
        )}
      </div>

      {detail && (
        <div className="sticky bottom-2 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-sky-700 bg-white px-4 py-3 shadow-lg lg:col-span-2">
          <div>
            <strong className="text-base">{format === 'a4' ? 'ใบ GRN 1 ใบ' : `เลือกแล้ว ${chosen.length} ป้าย`}</strong>
            <div className="text-sm text-slate-500">
              {FORMAT_NAME[format]}
              {format === 'sheet' && chosen.length ? ` · ${sheets} แผ่น` : ''}
            </div>
          </div>
          <div className="flex gap-2">
            <BigButton tone="secondary" disabled={!count || !can('label.print')} onClick={() => setPrintOpen(true)}>
              ดูตัวอย่างทั้งหมด
            </BigButton>
            <BigButton disabled={!count || !can('label.print')} onClick={() => setPrintOpen(true)} className="!py-3 text-base">
              {format === 'a4' ? 'พิมพ์ใบ GRN' : `พิมพ์ ${count} ป้าย`}
            </BigButton>
          </div>
        </div>
      )}

      {detail && (
        <PrintDialog
          open={printOpen}
          onClose={() => setPrintOpen(false)}
          format={format}
          title="ตัวอย่างก่อนพิมพ์"
          subtitle={`${FORMAT_NAME[format]} · ${format === 'a4' ? detail.grn.grnNo : `${chosen.length} ป้าย`}${format === 'sheet' ? ` · ${sheets} แผ่น` : ''}`}
          printLabel={format === 'a4' ? 'พิมพ์ใบ GRN' : `พิมพ์ ${count} ป้าย`}
        >
          {format === 'a4' && <GrnSheet ctx={ctx} />}
          {format === 'label' && chosen.map((l) => <LabelCard key={l.id} lpn={l} ctx={ctx} />)}
          {format === 'sheet' && Array.from({ length: sheets }, (_, i) => <LabelSheet key={i} lpns={chosen.slice(i * 4, i * 4 + 4)} ctx={ctx} />)}
        </PrintDialog>
      )}
    </div>
  )
}
