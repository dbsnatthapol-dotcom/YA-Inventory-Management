import { useEffect, useState } from 'react'
import { errorText } from '../../wms/api'
import { fmt } from '../../wms/logic'
import type { StockCount, Tx } from '../../wms/types'
import { useApprovals } from '../../wms/useApprovals'
import { useWms } from '../../wms/useWms'
import type { Zone } from '../../types/layout'
import { CountUpload, SheetItem } from './StockImport'
import { Alert, BigButton, Card, Pill } from './ui'

const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0')
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' }) : '')

/**
 * ตรวจนับ & อนุมัติ: ที่เดียวของการปรับยอด
 * - คิวรออนุมัติคิวเดียว: คำขอจากหน้าสแกน (ตรวจนับ / แก้ไขยอดทีละกล่อง) + ใบตรวจนับ Excel (ทั้งโซน)
 * - ตรวจนับทั้งโซนด้วย Excel
 * - ประวัติที่พิจารณาแล้ว
 */
export function CountTab({ zones }: { zones: Zone[] }) {
  const { api, can, reload } = useWms()
  const [ver, setVer] = useState(0)
  const { adj, sheets, pendingSheets } = useApprovals(true, ver)
  const [history, setHistory] = useState<Tx[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const canApprove = can('scan.adjust.approve')

  useEffect(() => {
    let alive = true
    api
      .recentTx(200)
      .then((t) => alive && setHistory(t.filter((x) => x.kind === 'ADJ' && x.status !== 'pending').slice(0, 20)))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [api, ver])

  const act = async (fn: () => Promise<string>) => {
    setBusy(true)
    setMsg(null)
    try {
      setMsg({ tone: 'ok', text: await fn() })
      await reload()
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    } finally {
      setVer((v) => v + 1)
      setBusy(false)
    }
  }
  const decideAdj = (t: Tx, approve: boolean) =>
    act(async () => {
      await api.scanAdjustDecide(t.id, approve)
      return `${t.docNo} ${approve ? 'อนุมัติแล้ว · ยอดในกล่องเปลี่ยนแล้ว' : 'ไม่อนุมัติ'}`
    })
  const decideSheet = (c: StockCount, approve: boolean) => {
    const reason = approve ? '' : window.prompt(`เหตุผลที่ไม่อนุมัติ ${c.countNo}`)
    if (!approve && !reason?.trim()) return
    if (approve && !window.confirm(`อนุมัติ ${c.countNo}? ระบบจะปรับยอด ${c.lines.filter((l) => l.countedQty !== l.systemQty).length} รายการ`)) return
    void act(async () => {
      const r = await api.decideStockCount(c.id, approve, reason ?? undefined)
      return approve
        ? `อนุมัติ ${c.countNo} แล้ว · ปรับยอด ${r.changed} รายการ${r.newBoxes ? ` · สร้างกล่องใหม่ ${r.newBoxes} กล่อง พิมพ์ป้ายที่ งานคลัง → ป้าย QR & พิมพ์ (เอกสาร ${c.countNo})` : ''}`
        : `ไม่อนุมัติ ${c.countNo} แล้ว`
    })
  }

  const queue = [...adj.map((t) => ({ at: t.createdAt, t, c: null })), ...pendingSheets.map((c) => ({ at: c.createdAt, t: null, c }))].sort((a, b) => a.at.localeCompare(b.at))
  const decided = sheets.filter((c) => c.status !== 'pending')

  return (
    <div className="flex flex-col gap-4">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card
        title={`รออนุมัติปรับยอด (${queue.length})`}
        eyebrow="คิวเดียว: คำขอจากหน้าสแกน (ตรวจนับ / แก้ไขยอด ทีละกล่อง) และใบตรวจนับ Excel (ทั้งโซน) · ผู้อนุมัติต้องไม่ใช่คนขอ"
      >
        {!canApprove && <p className="text-sm text-slate-500">บัญชีนี้ดูได้อย่างเดียว · อนุมัติได้เฉพาะผู้มีสิทธิ์ "อนุมัติแก้ไขยอด"</p>}
        {queue.length === 0 && <p className="text-sm text-slate-500">ไม่มีรายการรออนุมัติ</p>}
        <ul className="flex flex-col gap-2">
          {queue.map(({ t, c }) =>
            t ? (
              <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-amber-200">
                <Pill tone="mi3">สแกน</Pill>
                <span className="font-mono font-semibold">{t.docNo}</span>
                <span className="font-mono text-slate-600">{t.lpnNo}</span>
                <span>
                  <span className="font-mono font-semibold">{t.partNo}</span> {fmt(t.qty)} → {fmt(t.newQty)}{' '}
                  <b className={(t.newQty ?? 0) < (t.qty ?? 0) ? 'text-rose-700' : 'text-amber-700'}>({signed((t.newQty ?? 0) - (t.qty ?? 0))})</b>
                </span>
                <span className="text-xs text-slate-500">
                  {t.reason} · ขอโดย {t.createdCode} {when(t.createdAt)}
                </span>
                <span className="flex-1" />
                {canApprove && (
                  <>
                    <BigButton tone="secondary" disabled={busy} onClick={() => void decideAdj(t, false)}>
                      ไม่อนุมัติ
                    </BigButton>
                    <BigButton disabled={busy} onClick={() => void decideAdj(t, true)}>
                      อนุมัติ → ปรับยอด
                    </BigButton>
                  </>
                )}
              </li>
            ) : (
              c && (
                <SheetItem
                  key={c.id}
                  c={c}
                  open={open === c.id}
                  onToggle={() => setOpen(open === c.id ? null : c.id)}
                  actions={
                    canApprove && (
                      <>
                        <BigButton tone="secondary" disabled={busy} onClick={() => decideSheet(c, false)}>
                          ไม่อนุมัติ
                        </BigButton>
                        <BigButton disabled={busy} onClick={() => decideSheet(c, true)}>
                          อนุมัติ → ปรับยอด
                        </BigButton>
                      </>
                    )
                  }
                />
              )
            ),
          )}
        </ul>
        <p className="text-xs text-slate-500">นับทีละกล่อง: หน้าสแกน → โหมด "ตรวจนับ / แก้ไขยอด" · นับทั้งโซน: ใช้ Excel ด้านล่าง</p>
      </Card>

      <CountUpload
        zones={zones}
        ver={ver}
        onSubmitted={(id) => {
          setOpen(id)
          setVer((v) => v + 1)
        }}
      />

      <Card title="ประวัติที่พิจารณาแล้ว">
        {decided.length === 0 && history.length === 0 && <p className="text-sm text-slate-500">ยังไม่มี</p>}
        <ul className="flex flex-col gap-2">
          {decided.map((c) => (
            <SheetItem key={c.id} c={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} />
          ))}
          {history.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-slate-200">
              <Pill tone="mi3">สแกน</Pill>
              <span className="font-mono font-semibold">{t.docNo}</span>
              <Pill tone={t.status === 'approved' ? 'ok' : 'muted'}>{t.status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'}</Pill>
              <span className="font-mono text-slate-600">{t.lpnNo}</span>
              <span>
                <span className="font-mono">{t.partNo}</span> {fmt(t.qty)} → {fmt(t.newQty)}
              </span>
              <span className="text-xs text-slate-500">
                {t.reason} · ขอโดย {t.createdCode} {when(t.createdAt)}
                {t.decidedCode ? ` · โดย ${t.decidedCode}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
