import type { ReactNode } from 'react'
import { BRAND } from '../../data/brand'

/** ชิ้นส่วนหน้าจองานคลัง: ใหญ่ กดง่ายบน Tablet */

export const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-[15px] text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200'

export function Card({ title, eyebrow, action, children, className = '' }: { title?: ReactNode; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {(title || eyebrow || action) && (
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {eyebrow && <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{eyebrow}</div>}
            {title && <h2 className="text-base font-bold text-slate-800">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function BigButton({
  children,
  tone = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const cls = {
    primary: 'text-white shadow-sm hover:opacity-90',
    secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
    ghost: 'text-slate-600 hover:bg-slate-100',
  }[tone]
  return (
    <button
      {...props}
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-4 py-2 text-[15px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${cls} ${props.className ?? ''}`}
      style={tone === 'primary' ? { background: BRAND.primary, ...props.style } : props.style}
    >
      {children}
    </button>
  )
}

const TONE = {
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  bad: 'bg-rose-50 text-rose-700 ring-rose-200',
  info: 'bg-sky-50 text-sky-800 ring-sky-200',
  mi3: 'bg-violet-50 text-violet-700 ring-violet-200',
  muted: 'bg-slate-100 text-slate-600 ring-slate-200',
}
export type Tone = keyof typeof TONE

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${TONE[tone]}`}>{children}</span>
}

export function Alert({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  if (!children) return null
  return <div className={`rounded-lg px-3 py-2.5 text-sm font-medium ring-1 ${TONE[tone]}`}>{children}</div>
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-sm text-slate-600">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-slate-300" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v}
          aria-pressed={v === value}
          onClick={() => onChange(v)}
          className={`min-h-[44px] px-3.5 py-2 text-sm transition ${v === value ? 'font-semibold text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
          style={v === value ? { background: BRAND.primary } : undefined}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

export const thCls = 'whitespace-nowrap bg-slate-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500'
export const tdCls = 'border-t border-slate-100 px-3 py-2 align-middle'
