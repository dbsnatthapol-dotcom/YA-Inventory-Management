import type { ReactNode } from 'react'
import { BRAND } from '../../data/brand'


export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-sm font-bold" style={{ color: BRAND.navy }}>
          {title}
        </h3>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

const CHIP = {
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  bad: 'bg-rose-50 text-rose-700 ring-rose-200',
  info: 'bg-sky-50 text-sky-800 ring-sky-200',
  muted: 'bg-slate-100 text-slate-600 ring-slate-200',
}

export function Chip({ tone, children }: { tone: keyof typeof CHIP; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${CHIP[tone]}`}>{children}</span>
}

export function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  const cls =
    variant === 'primary'
      ? 'text-white shadow-sm hover:opacity-90'
      : variant === 'secondary'
        ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
        : 'text-slate-600 hover:bg-slate-100'
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${cls} ${props.className ?? ''}`}
      style={variant === 'primary' ? { background: BRAND.navy, ...props.style } : props.style}
    >
      {children}
    </button>
  )
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null
  return <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{message}</p>
}
