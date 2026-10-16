import { useEffect, useState } from 'react'
import { BRAND } from '../../data/brand'
import type { ViewMode } from '../FactoryScene'

/** 1 จุดในทัวร์นำเสนอ: กล้องบินไปที่โซน (หรือภาพรวม) พร้อมคำบรรยายและตัวเลขจริง */
export interface TourStep {
  title: string
  body: string
  /** ตัวเลขเด่นของจุดนี้ */
  stat?: { value: string; label: string }
  zoneId: string | null
  mode: ViewMode
  heatmap?: boolean
  flow?: boolean
  /** ไกด์ประจำจุดเปิดสรุปให้ */
  guide?: boolean
}

const STEP_MS = 9000

/**
 * โหมดนำเสนอผู้บริหาร: เล่นอัตโนมัติทีละจุด (9 วินาที) กดหยุด/ถัดไป/ย้อนได้ · ← → เลื่อน, Space หยุด, L วนซ้ำ, Esc ออก
 * ปุ่มเต็มจอสำหรับจอห้องประชุม · วนซ้ำ = เปิดค้างบนจอ TV ทั้งวัน (ตัวเลขเป็นของจริงตามเวลา)
 */
export function ExecTour({ steps, index, onIndex, onExit }: { steps: TourStep[]; index: number; onIndex: (i: number) => void; onExit: () => void }) {
  const [playing, setPlaying] = useState(true)
  const [loop, setLoop] = useState(false)
  const step = steps[index]
  const last = index === steps.length - 1
  const moving = playing && (!last || loop)

  useEffect(() => {
    if (!moving) return
    const t = setTimeout(() => onIndex(last ? 0 : index + 1), STEP_MS)
    return () => clearTimeout(t)
  }, [moving, index, last, onIndex])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') onIndex(Math.min(steps.length - 1, index + 1))
      else if (e.key === 'ArrowLeft') onIndex(Math.max(0, index - 1))
      else if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.key === 'l' || e.key === 'L') setLoop((v) => !v)
      else if (e.key === 'Escape') onExit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, steps.length, onIndex, onExit])

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.()
  }

  if (!step) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-3xl overflow-hidden rounded-2xl bg-slate-900/85 text-white shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)] ring-1 ring-white/10 backdrop-blur-md">
        <div className="flex items-stretch gap-4 p-5">
          {step.stat && (
            <div className="hidden shrink-0 flex-col justify-center rounded-xl px-4 text-center sm:flex" style={{ background: BRAND.primary }}>
              <div className="text-3xl font-bold tabular-nums">{step.stat.value}</div>
              <div className="text-[11px] text-white/80">{step.stat.label}</div>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-sky-300">
              UAM1 · {index + 1} / {steps.length}
            </div>
            <h2 className="mt-0.5 text-2xl font-bold leading-tight">{step.title}</h2>
            <p className="mt-1 text-[15px] leading-relaxed text-white/85">{step.body}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-white/10 px-4 py-2">
          <div className="flex flex-1 gap-1">
            {steps.map((s, i) => (
              <button key={s.title} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20" onClick={() => onIndex(i)} aria-label={s.title}>
                <span
                  key={`${i}-${index}-${moving}`}
                  className="block h-full rounded-full bg-sky-400"
                  style={{
                    width: i < index ? '100%' : i > index ? '0%' : moving ? '0%' : '100%',
                    animation: i === index && moving ? `tour-fill ${STEP_MS}ms linear forwards` : undefined,
                  }}
                />
              </button>
            ))}
          </div>
          <div className="flex shrink-0 gap-1 text-sm">
            <button className="rounded-lg px-2.5 py-1 hover:bg-white/10 disabled:opacity-30" disabled={index === 0} onClick={() => onIndex(index - 1)} aria-label="ก่อนหน้า">
              ◀
            </button>
            <button className="rounded-lg px-2.5 py-1 hover:bg-white/10" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'หยุด' : 'เล่น'}>
              {playing ? '❚❚' : '▶'}
            </button>
            <button className="rounded-lg px-2.5 py-1 hover:bg-white/10 disabled:opacity-30" disabled={last} onClick={() => onIndex(index + 1)} aria-label="ถัดไป">
              ▶▶
            </button>
            <button
              className={`rounded-lg px-2.5 py-1 hover:bg-white/10 ${loop ? 'bg-sky-500/30 text-sky-200' : ''}`}
              onClick={() => setLoop((v) => !v)}
              aria-pressed={loop}
              title="วนซ้ำต่อเนื่อง สำหรับเปิดค้างบนจอ TV (L)"
            >
              🔁
            </button>
            <button className="rounded-lg px-2.5 py-1 hover:bg-white/10" onClick={fullscreen} title="เต็มจอ">
              ⛶
            </button>
            <button className="rounded-lg px-2.5 py-1 hover:bg-white/10" onClick={onExit} title="ออก (Esc)">
              ✕
            </button>
          </div>
        </div>
      </div>
      <style>{'@keyframes tour-fill { from { width: 0% } to { width: 100% } }'}</style>
    </div>
  )
}
