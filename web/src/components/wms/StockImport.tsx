import { useEffect, useMemo, useState } from 'react'
import { BRAND } from '../../data/brand'
import { errorText } from '../../wms/api'
import { fmt } from '../../wms/logic'
import { countTemplateRows, planStockImport, type CountCtx, type CountRow } from '../../wms/stockImport'
import type { Lpn, StockCount } from '../../wms/types'
import { useWms } from '../../wms/useWms'
import type { Zone } from '../../types/layout'
import { Alert, BigButton, Card, Field, inputCls, Pill, tdCls, thCls, type Tone } from './ui'

const ROW_TONE: Record<CountRow['status'], [string, Tone]> = {
  match: ['ตรง', 'muted'],
  short: ['ขาด', 'bad'],
  over: ['เกิน', 'warn'],
  error: ['ผิด', 'bad'],
}
const COUNT_TONE: Record<StockCount['status'], [string, Tone]> = {
  pending: ['รออนุมัติ', 'warn'],
  approved: ['อนุมัติแล้ว', 'ok'],
  rejected: ['ไม่อนุมัติ', 'muted'],
}
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0')
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' }) : '')

/**
 * อัปเดตยอดคงเหลือจาก Excel: ดาวน์โหลดแบบฟอร์ม (ยอดในระบบรายช่อง/โซน) → นับ → อัปโหลด → เห็นส่วนต่าง → ส่งขออนุมัติ
 * ผู้มีสิทธิ์อนุมัติ (ไม่ใช่คนส่ง) ⇒ ระบบปรับยอดและลงบัญชีคุมเป็น "ปรับยอด" อ้างเลข CNT
 */
export function StockImport({ zones }: { zones: Zone[] }) {
  const { api, master, can, reload } = useWms()
  const [lpns, setLpns] = useState<Lpn[]>([])
  const [counts, setCounts] = useState<StockCount[]>([])
  const [ver, setVer] = useState(0)
  const [zoneId, setZoneId] = useState('')
  const [byZone, setByZone] = useState(false)
  const [plan, setPlan] = useState<{ file: string; rows: CountRow[]; skipped: number } | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([api.activeLpns(), api.listStockCounts()])
      .then(([l, c]) => {
        if (!alive) return
        setLpns(l)
        setCounts(c)
      })
      .catch((e) => alive && setMsg({ tone: 'bad', text: errorText(e) }))
    return () => {
      alive = false
    }
  }, [api, ver])

  const stockZones = useMemo(() => zones.filter((z) => ['storage', 'tent', 'receiving', 'inspection', 'ng'].includes(z.kind)), [zones])
  const ctx: CountCtx = useMemo(() => ({ parts: master.parts, locations: master.locations, zones, lpns }), [master, zones, lpns])

  const template = async () => {
    const rows = countTemplateRows(ctx, { zoneId: zoneId || null, byZone })
    const z = zones.find((x) => x.id === zoneId)
    const { downloadStockTemplate } = await import('../../wms/masterExcel')
    await downloadStockTemplate(rows, `${z ? `โซน ${z.code}` : 'ทุกโซน'} · ${byZone ? 'รวมรายโซน' : 'รายช่องเก็บ'}`)
  }
  const upload = async (f: File) => {
    setMsg(null)
    try {
      const { readSheetRows } = await import('../../wms/masterExcel')
      const p = planStockImport(await readSheetRows(f), ctx)
      setPlan({ file: f.name, ...p })
      if (!p.rows.length) setMsg({ tone: 'warn', text: 'ยังไม่มีแถวที่กรอก "นับได้" · ใช้แบบฟอร์มจากปุ่มดาวน์โหลด' })
    } catch (e) {
      setPlan(null)
      setMsg({ tone: 'bad', text: `อ่านไฟล์ไม่ได้: ${errorText(e)} · รองรับ .xlsx` })
    }
  }
  const errors = plan?.rows.filter((r) => r.status === 'error').length ?? 0
  const submit = async () => {
    if (!plan) return
    setBusy(true)
    try {
      const r = await api.submitStockCount({ note, lines: plan.rows.map((x) => ({ loc: x.loc, partNo: x.partNo, counted: x.counted })) })
      setPlan(null)
      setNote('')
      setMsg({ tone: 'ok', text: `ส่ง ${r.countNo} แล้ว · รอผู้มีสิทธิ์อนุมัติ (ยังไม่ปรับยอดจนกว่าจะอนุมัติ)` })
      setOpen(r.id)
      setVer((v) => v + 1)
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }
  const decide = async (c: StockCount, approve: boolean) => {
    const reason = approve ? '' : window.prompt(`เหตุผลที่ไม่อนุมัติ ${c.countNo}`)
    if (!approve && !reason?.trim()) return
    if (approve && !window.confirm(`อนุมัติ ${c.countNo}? ระบบจะปรับยอด ${c.lines.filter((l) => l.countedQty !== l.systemQty).length} รายการ`)) return
    setBusy(true)
    try {
      const r = await api.decideStockCount(c.id, approve, reason ?? undefined)
      await reload()
      setMsg({
        tone: 'ok',
        text: approve
          ? `อนุมัติ ${c.countNo} แล้ว · ปรับยอด ${r.changed} รายการ${r.newBoxes ? ` · สร้างกล่องใหม่ ${r.newBoxes} กล่อง พิมพ์ป้ายที่ งานคลัง → ป้าย QR & พิมพ์ (เอกสาร ${c.countNo})` : ''}`
          : `ไม่อนุมัติ ${c.countNo} แล้ว`,
      })
      setVer((v) => v + 1)
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  const sum = (rows: { diff: number }[], s: 1 | -1) => rows.filter((r) => Math.sign(r.diff) === s).reduce((t, r) => t + r.diff, 0)

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="อัปเดตยอดคงเหลือจากการตรวจนับ (Excel)"
        eyebrow="ดาวน์โหลดยอดในระบบ → นับจริง → กรอก 'นับได้' → อัปโหลด → ตรวจส่วนต่าง → ส่งขออนุมัติ"
      >
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <div className="flex flex-wrap items-end gap-3">
          <Field label="โซนที่จะนับ">
            <select className={inputCls} value={zoneId} onChange={(e) => setZoneId(e.target.value)} aria-label="โซนที่จะนับ">
              <option value="">ทุกโซน</option>
              {stockZones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.code} · {z.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ระดับ">
            <select className={inputCls} value={byZone ? 'zone' : 'loc'} onChange={(e) => setByZone(e.target.value === 'zone')} aria-label="ระดับการนับ">
              <option value="loc">รายช่องเก็บ (แนะนำ)</option>
              <option value="zone">รวมรายโซน</option>
            </select>
          </Field>
          <BigButton tone="secondary" onClick={() => void template()}>
            ดาวน์โหลดแบบฟอร์ม
          </BigButton>
          {can('scan.count') && (
            <label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-lg px-4 text-[15px] font-semibold text-white shadow-sm hover:opacity-90" style={{ background: BRAND.primary }}>
              อัปโหลดผลนับ
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void upload(f)
                  e.target.value = ''
                }}
              />
            </label>
          )}
        </div>

        {plan && plan.rows.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{plan.file}</span>
              <Pill tone="muted">{`ตรง ${plan.rows.filter((r) => r.status === 'match').length}`}</Pill>
              <Pill tone="bad">{`ขาด ${plan.rows.filter((r) => r.status === 'short').length} (${signed(sum(plan.rows, -1))})`}</Pill>
              <Pill tone="warn">{`เกิน ${plan.rows.filter((r) => r.status === 'over').length} (${signed(sum(plan.rows, 1))})`}</Pill>
              {errors > 0 && <Pill tone="bad">{`ผิด ${errors}`}</Pill>}
              {plan.skipped > 0 && <Pill tone="muted">{`ไม่ได้นับ ${plan.skipped}`}</Pill>}
            </div>
            {errors > 0 && <Alert tone="bad">มีแถวที่ผิด {errors} แถว · แก้ในไฟล์แล้วอัปโหลดใหม่ (ส่งได้เมื่อไม่มีแถวผิด)</Alert>}
            <CountTable rows={plan.rows.map((r) => ({ key: String(r.row), row: r.row, loc: r.loc, partNo: r.partNo, name: r.name, system: r.system, counted: r.counted, diff: r.diff, tag: ROW_TONE[r.status], note: r.messages.join(' · ') }))} />
            <div className="flex flex-wrap items-end gap-2">
              <Field label="หมายเหตุ (เช่น นับประจำเดือน / ผู้นับ)">
                <input className={`${inputCls} w-80`} value={note} onChange={(e) => setNote(e.target.value)} aria-label="หมายเหตุใบตรวจนับ" />
              </Field>
              <span className="flex-1" />
              <BigButton tone="secondary" onClick={() => setPlan(null)}>
                ยกเลิก
              </BigButton>
              <BigButton disabled={busy || errors > 0} onClick={() => void submit()}>
                {busy ? 'กำลังส่ง…' : `ส่งขออนุมัติ (${plan.rows.length} รายการ)`}
              </BigButton>
            </div>
          </>
        )}
      </Card>

      <Card title="ใบตรวจนับ" eyebrow="อนุมัติได้เฉพาะผู้มีสิทธิ์อนุมัติแก้ไขยอด และต้องไม่ใช่คนส่ง">
        {counts.length === 0 && <p className="text-sm text-slate-500">ยังไม่มีใบตรวจนับ</p>}
        <ul className="flex flex-col gap-2">
          {counts.map((c) => {
            const diffs = c.lines.map((l) => ({ diff: l.countedQty - l.systemQty }))
            return (
              <li key={c.id} className="rounded-lg ring-1 ring-slate-200">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <button className="font-mono font-semibold text-sky-700 hover:underline" onClick={() => setOpen(open === c.id ? null : c.id)}>
                    {open === c.id ? '▾' : '▸'} {c.countNo}
                  </button>
                  <Pill tone={COUNT_TONE[c.status][1]}>{COUNT_TONE[c.status][0]}</Pill>
                  <span className="text-xs text-slate-500">
                    {c.lines.length} รายการ · ขาด {signed(sum(diffs, -1))} · เกิน {signed(sum(diffs, 1))} · ส่งโดย {c.createdCode} {when(c.createdAt)}
                    {c.decidedAt && ` · ${c.status === 'approved' ? 'อนุมัติ' : 'ไม่อนุมัติ'}โดย ${c.decidedCode} ${when(c.decidedAt)}`}
                    {c.note && ` · ${c.note}`}
                    {c.decisionNote && ` · เหตุผล: ${c.decisionNote}`}
                  </span>
                  <span className="flex-1" />
                  {c.status === 'pending' && can('scan.adjust.approve') && (
                    <>
                      <BigButton tone="secondary" disabled={busy} onClick={() => void decide(c, false)}>
                        ไม่อนุมัติ
                      </BigButton>
                      <BigButton disabled={busy} onClick={() => void decide(c, true)}>
                        อนุมัติ → ปรับยอด
                      </BigButton>
                    </>
                  )}
                </div>
                {open === c.id && (
                  <div className="border-t border-slate-200 p-2">
                    <CountTable
                      rows={c.lines.map((l) => {
                        const diff = l.countedQty - l.systemQty
                        return {
                          key: String(l.lineNo),
                          row: l.lineNo,
                          loc: l.loc,
                          partNo: l.partNo,
                          name: master.parts.find((p) => p.partNo === l.partNo)?.name ?? '',
                          system: l.systemQty,
                          counted: l.countedQty,
                          diff,
                          tag: diff === 0 ? ROW_TONE.match : diff < 0 ? ROW_TONE.short : ROW_TONE.over,
                          note: l.appliedQty ? `ปรับแล้ว ${signed(l.appliedQty)}` : '',
                        }
                      })}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}

function CountTable({ rows }: { rows: { key: string; row: number; loc: string; partNo: string; name: string; system: number; counted: number; diff: number; tag: [string, Tone]; note: string }[] }) {
  return (
    <div className="max-h-[50vh] overflow-auto rounded-lg ring-1 ring-slate-200">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="sticky top-0">
          <tr>
            <th className={thCls}>แถว</th>
            <th className={thCls}>ช่อง / โซน</th>
            <th className={thCls}>Part No.</th>
            <th className={thCls}>รายการ</th>
            <th className={`${thCls} text-right`}>ในระบบ</th>
            <th className={`${thCls} text-right`}>นับได้</th>
            <th className={`${thCls} text-right`}>ส่วนต่าง</th>
            <th className={thCls}>สถานะ</th>
            <th className={thCls}>หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>
          {[...rows]
            .sort((a, b) => Number(b.tag[0] === 'ผิด') - Number(a.tag[0] === 'ผิด') || Math.abs(b.diff) - Math.abs(a.diff))
            .map((r) => (
              <tr key={r.key} className={r.diff === 0 && r.tag[0] !== 'ผิด' ? 'text-slate-400' : ''}>
                <td className={`${tdCls} font-mono text-xs`}>{r.row}</td>
                <td className={`${tdCls} font-mono`}>{r.loc}</td>
                <td className={`${tdCls} font-mono font-semibold`}>{r.partNo}</td>
                <td className={tdCls}>{r.name}</td>
                <td className={`${tdCls} text-right font-mono`}>{fmt(r.system)}</td>
                <td className={`${tdCls} text-right font-mono font-semibold`}>{fmt(r.counted)}</td>
                <td className={`${tdCls} text-right font-mono ${r.diff < 0 ? 'text-rose-700' : r.diff > 0 ? 'text-amber-700' : ''}`}>{signed(r.diff)}</td>
                <td className={tdCls}>
                  <Pill tone={r.tag[1]}>{r.tag[0]}</Pill>
                </td>
                <td className={`${tdCls} text-xs ${r.tag[0] === 'ผิด' ? 'text-rose-700' : 'text-slate-500'}`}>{r.note}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}
