import { useState } from 'react'
import { errorText } from '../../wms/api'
import type { LedgerSheet } from '../../wms/ledger'
import { fmt } from '../../wms/logic'
import { closingDiffs, nextMonthStart, thisMonth } from '../../wms/closing'
import type { StockClosing } from '../../wms/types'
import { useWms } from '../../wms/useWms'
import { Alert, BigButton, Card, Pill } from './ui'

const stamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }) : '')
/**
 * ปิดยอดสิ้นเดือน: ① คลังปิดยอด → ② Planning รับทราบ → ③ บัญชีรับทราบ (กดในระบบแทนการเซ็นกระดาษ)
 * ปิดแล้วใบเบิกของเดือนนั้นแก้ไม่ได้ · ต้องแก้ ⇒ เปิดเดือน (ระบุเหตุผล) แล้วปิดใหม่ การรับทราบเริ่มใหม่
 */
export function ClosingPanel({ model, month, sheets, closing, onChanged }: { model: string; month: string; sheets: LedgerSheet[]; closing: StockClosing | null; onChanged: () => void }) {
  const { api, can } = useWms()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const closed = closing?.status === 'closed' ? closing : null
  const ended = month < thisMonth()
  const total = (k: 'totalIn' | 'totalOut' | 'closing') => sheets.reduce((s, x) => s + x[k], 0)
  const diffs = closed ? closingDiffs(closed, sheets) : []

  const act = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      setMsg({ tone: 'ok', text: ok })
      onChanged()
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }
  const close = () => {
    if (!window.confirm(`ปิดยอด ${model} เดือน ${month}?\nงานเข้า ${fmt(total('totalIn'))} · เบิกใช้ ${fmt(total('totalOut'))} · คงเหลือ ${fmt(total('closing'))}\nหลังปิด ใบเบิกของเดือนนี้จะแก้ไขไม่ได้`)) return
    void act(() => api.closeMonth(model, month), `ปิดยอด ${model} ${month} แล้ว · รอ Planning และบัญชีรับทราบ`)
  }
  const reopen = () => {
    const reason = window.prompt('เหตุผลที่เปิดเดือนเพื่อแก้ไข (การรับทราบจะเริ่มใหม่)')
    if (reason?.trim()) void act(() => api.reopenMonth(closed!.id, reason), `เปิดเดือน ${month} แล้ว · แก้ไขเสร็จให้ปิดยอดใหม่`)
  }
  const ack = (side: 'planning' | 'account') => void act(() => api.ackClosing(closed!.id, side), side === 'planning' ? 'Planning รับทราบยอดแล้ว' : 'บัญชีรับทราบยอดแล้ว')

  const steps: { title: string; by: string | null; at: string | null; action?: React.ReactNode }[] = [
    { title: '① คลังปิดยอด', by: closed?.closedBy ?? null, at: closed?.closedAt ?? null },
    {
      title: '② Planning รับทราบ',
      by: closed?.planningBy ?? null,
      at: closed?.planningAt ?? null,
      action: closed && !closed.planningAt && can('ledger.ack.planning') && (
        <BigButton disabled={busy} onClick={() => ack('planning')}>
          รับทราบ (Planning)
        </BigButton>
      ),
    },
    {
      title: '③ บัญชี รับทราบ',
      by: closed?.accountBy ?? null,
      at: closed?.accountAt ?? null,
      action: closed && !closed.accountAt && can('ledger.ack.account') && (
        <BigButton disabled={busy} onClick={() => ack('account')}>
          รับทราบ (บัญชี)
        </BigButton>
      ),
    },
  ]

  return (
    <Card
      title="ปิดยอดสิ้นเดือน"
      eyebrow={`${model} · ${month} · คลังปิดยอด → Planning รับทราบ → บัญชีรับทราบ`}
      action={
        closed ? (
          can('ledger.close') && (
            <BigButton tone="secondary" disabled={busy} onClick={reopen}>
              เปิดเดือนเพื่อแก้ไข
            </BigButton>
          )
        ) : ended ? (
          can('ledger.close') && (
            <BigButton disabled={busy || !sheets.length} onClick={close}>
              ปิดยอด {model} {month}
            </BigButton>
          )
        ) : (
          <Pill tone="muted">ปิดยอดได้ตั้งแต่ {nextMonthStart(month)}</Pill>
        )
      }
    >
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {closing?.status === 'reopened' && <Alert tone="warn">เปิดเดือนแก้ไขอยู่ · {closing.note}</Alert>}
      {diffs.length > 0 && (
        <Alert tone="warn">
          ยอดปัจจุบันต่างจากตอนปิด {diffs.length} part (มีรายการย้อนหลังหลังปิด เช่น อนุมัติปรับยอด):{' '}
          {diffs
            .slice(0, 5)
            .map((d) => `${d.partNo} ${fmt(d.closed)} → ${fmt(d.now)}`)
            .join(' · ')}
        </Alert>
      )}
      <ol className="grid gap-2 sm:grid-cols-3">
        {steps.map((s) => (
          <li key={s.title} className={`flex flex-col gap-1 rounded-lg p-3 ring-1 ${s.by ? 'bg-emerald-50 ring-emerald-200' : 'bg-slate-50 ring-slate-200'}`}>
            <span className="text-sm font-semibold">{s.title}</span>
            {s.by ? (
              <span className="text-xs text-emerald-800">
                ✓ {s.by}
                <br />
                {stamp(s.at)}
              </span>
            ) : (
              <span className="text-xs text-slate-500">{closed || s.title.startsWith('①') ? 'รอดำเนินการ' : 'รอคลังปิดยอดก่อน'}</span>
            )}
            {s.action}
          </li>
        ))}
      </ol>
      {closed?.note && closing?.status === 'closed' && <p className="text-xs text-slate-500">หมายเหตุ: {closed.note}</p>}
    </Card>
  )
}

/** สถานะปิดยอดของทุก Model ในเดือน (Planning / บัญชีใช้ดูว่ารออะไรอยู่) */
export function MonthOverview({ month, models, closings, current, onPick }: { month: string; models: string[]; closings: StockClosing[]; current: string; onPick: (m: string) => void }) {
  return (
    <Card title={`สถานะปิดยอด ${month}`} eyebrow="กดเพื่อเปิดบัญชีของ Model นั้น">
      <div className="flex flex-wrap gap-2">
        {models.map((m) => {
          const c = closings.find((x) => x.modelCode === m && x.month === month)
          const done = c?.status === 'closed'
          const label = !done ? 'ยังไม่ปิด' : c.planningAt && c.accountAt ? 'ครบ ✓' : `รอ${[!c.planningAt && 'Planning', !c.accountAt && 'บัญชี'].filter(Boolean).join(' + ')}`
          return (
            <button
              key={m}
              onClick={() => onPick(m)}
              className={`flex min-h-[44px] items-center gap-2 rounded-lg px-3 text-sm ring-1 ${m === current ? 'bg-sky-50 ring-sky-600' : 'ring-slate-200 hover:bg-slate-50'}`}
            >
              <span className="font-mono font-semibold">{m}</span>
              <Pill tone={!done ? 'muted' : c.planningAt && c.accountAt ? 'ok' : 'warn'}>{label}</Pill>
            </button>
          )
        })}
      </div>
    </Card>
  )
}
