import { Fragment, useEffect, useRef } from 'react'
import { FLOW_GROUPS, LATE_DAYS, type FlowGroup, type FlowKey, type FlowStage, type FlowState } from '../../wms/flowBoard'
import { fmt } from '../../wms/logic'

const STATE: Record<FlowState, { card: string; badge: string; num: string; label: string }> = {
  late: { card: 'bg-rose-50 ring-rose-300 hover:ring-rose-400', badge: 'bg-rose-600', num: 'text-rose-700', label: `ค้างเกิน ${LATE_DAYS} วัน` },
  todo: { card: 'bg-amber-50 ring-amber-300 hover:ring-amber-400', badge: 'bg-amber-500', num: 'text-amber-800', label: 'มีงานรอ' },
  ok: { card: 'bg-white ring-emerald-200 hover:ring-emerald-400', badge: 'bg-emerald-600', num: 'text-emerald-700', label: 'ปกติ' },
  idle: { card: 'bg-white ring-slate-200 hover:ring-slate-300', badge: 'bg-slate-400', num: 'text-slate-400', label: 'ไม่มีงาน' },
}
const GROUPS: FlowGroup[] = ['in', 'store', 'out']

/**
 * ผังขั้นตอนงานคลังสด: รับเข้า → จัดเก็บ → จ่ายออก & ปิดยอด (9 ขั้น) ตัวเลขจากระบบตอนนี้
 * สีบอกสถานะ · แตะขั้นไหนพาไปทำงานนั้น · compact = มือถือ (แถบเดียวปัดดู)
 */
export function FlowBoard({ stages, onPick, compact = false }: { stages: FlowStage[]; onPick: (key: FlowKey) => void; compact?: boolean }) {
  if (compact) return <FlowStrip stages={stages} onPick={onPick} />
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200" aria-label="ขั้นตอนงานคลังตอนนี้">
      <header className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-bold text-slate-800">ขั้นตอนงานคลังตอนนี้</h3>
        <span className="text-xs text-slate-500">ตัวเลขสดจากระบบ · แตะขั้นตอนเพื่อไปทำงานนั้น</span>
        <Legend className="ml-auto" />
      </header>
      <div className="grid gap-3 xl:grid-cols-3">
        {GROUPS.map((g, gi) => (
          <div key={g} className="relative min-w-0 rounded-lg bg-slate-50 p-1.5 ring-1 ring-slate-100">
            <div className="flex items-center gap-1.5 px-1 pb-1 text-[11px] font-bold tracking-wide text-slate-500">
              <span className={`h-3 w-3 rounded-sm ${GROUP_TONE[g]}`} />
              {gi + 1} · {FLOW_GROUPS[g]}
            </div>
            <ol className="flex items-stretch gap-0.5">
              {stages
                .filter((s) => s.group === g)
                .map((s, i) => (
                  <Fragment key={s.key}>
                    {i > 0 && <Arrow />}
                    <li className="min-w-0 flex-1">
                      <StageCard s={s} compact={false} onPick={onPick} />
                    </li>
                  </Fragment>
                ))}
            </ol>
            {gi < GROUPS.length - 1 && (
              <span aria-hidden className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 text-xl font-bold text-slate-300 xl:block">
                ›
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

const GROUP_TONE: Record<FlowGroup, string> = { in: 'bg-sky-500', store: 'bg-emerald-500', out: 'bg-indigo-500' }
const GROUP_EDGE: Record<FlowGroup, string> = { in: 'border-t-sky-500', store: 'border-t-emerald-500', out: 'border-t-indigo-500' }

const Arrow = () => (
  <li aria-hidden className="flex w-3 shrink-0 items-center justify-center text-slate-300">
    ›
  </li>
)

/** มือถือ: แถบเดียวปัดซ้าย-ขวา (ไม่ดันรายการงานลงไปไกล) · เปิดมาเลื่อนไปขั้นแรกที่มีงานรอ */
function FlowStrip({ stages, onPick }: { stages: FlowStage[]; onPick: (key: FlowKey) => void }) {
  const strip = useRef<HTMLOListElement>(null)
  const first = stages.find((s) => s.state === 'late' || s.state === 'todo')?.key
  useEffect(() => {
    const list = strip.current
    const card = first ? list?.querySelector<HTMLElement>(`[data-stage="${first}"]`) : null
    if (list && card) list.scrollLeft = Math.max(0, card.offsetLeft - list.offsetLeft - 8)
  }, [first])
  return (
    <section className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200" aria-label="ขั้นตอนงานคลังตอนนี้">
      <header className="mb-1.5 flex items-baseline gap-2">
        <h3 className="text-base font-bold text-slate-800">ขั้นตอนงานคลังตอนนี้</h3>
        <span className="ml-auto text-[11px] text-slate-500">ปัดดูทุกขั้น →</span>
      </header>
      <ol ref={strip} className="-mx-1 flex snap-x items-stretch gap-0.5 overflow-x-auto px-1 pb-1.5">
        {stages.map((s, i) => (
          <Fragment key={s.key}>
            {i > 0 && <Arrow />}
            <li data-stage={s.key} className="w-[108px] shrink-0 snap-start">
              <StageCard s={s} compact onPick={onPick} />
            </li>
          </Fragment>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        {GROUPS.map((g) => (
          <span key={g} className="inline-flex items-center gap-1">
            <i className={`h-1.5 w-3 rounded-full ${GROUP_TONE[g]}`} />
            {FLOW_GROUPS[g]}
          </span>
        ))}
        <Legend />
      </div>
    </section>
  )
}

/** เลขแบบฟอร์ม (FM-P-005) ไม่ตัดบรรทัดกลางเลข */
const keepCodes = (t: string) => t.replace(/([A-Z])-(?=[A-Z0-9])/g, '$1\u2011')

function StageCard({ s, compact, onPick }: { s: FlowStage; compact: boolean; onPick: (key: FlowKey) => void }) {
  const st = STATE[s.state]
  return (
    <button
      type="button"
      onClick={() => onPick(s.key)}
      title={s.hint}
      aria-label={`ขั้น ${s.step} ${s.title}: ${s.value === null ? 'ไม่มีข้อมูล' : `${fmt(s.value)} ${s.unit}`} · ${s.detail} · ${st.label}`}
      className={`flex h-full w-full flex-col gap-0.5 rounded-lg text-left ring-1 transition hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-1 ${compact ? `border-t-4 p-1.5 ${GROUP_EDGE[s.group]}` : 'p-2.5'} ${st.card}`}
    >
      <span className={`flex items-start gap-1 font-semibold leading-tight text-slate-700 ${compact ? 'text-[11px]' : 'text-[12px]'}`}>
        <span className={`mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${st.badge}`}>{s.step}</span>
        <span className="min-w-0">{keepCodes(s.title)}</span>
      </span>
      <span className={`font-bold tabular-nums leading-tight ${compact ? 'text-xl' : 'text-2xl'} ${st.num}`}>
        {s.value === null ? '–' : fmt(s.value)} <span className="text-[11px] font-semibold text-slate-500">{s.unit}</span>
      </span>
      <span className="line-clamp-2 text-[11px] leading-snug text-slate-500">{s.detail}</span>
    </button>
  )
}

function Legend({ className = '' }: { className?: string }) {
  return (
    <span className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 ${className}`}>
      {(['late', 'todo', 'ok', 'idle'] as FlowState[]).map((k) => (
        <span key={k} className="inline-flex items-center gap-1">
          <i className={`h-2.5 w-2.5 rounded-full ${STATE[k].badge}`} />
          {STATE[k].label}
        </span>
      ))}
    </span>
  )
}
