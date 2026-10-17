import { BRAND } from '../../data/brand'
import type { Floor } from '../../types/layout'
import type { ViewMode } from '../FactoryScene'

interface Props {
  mode: ViewMode
  onMode: (mode: ViewMode) => void
  floors: Floor[]
  /** ชั้นที่แสดงในโหมดภายใน · null = ทุกชั้นซ้อนกัน */
  floor: string | null
  onFloor: (id: string | null) => void
  explode: number
  onExplode: (v: number) => void
  topView: boolean
  onTopView: (v: boolean) => void
  surroundings: boolean
  onSurroundings: (v: boolean) => void
}

const pill = (on: boolean) =>
  `whitespace-nowrap rounded-full px-2.5 py-1 text-xs transition ${on ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`

/** แถบเลือกมุมมองผัง: ภายนอก/ภายใน, ดูทีละชั้น (หรือทุกชั้น + ระยะแยกชั้น), มุมบน, รอบโรงงาน */
export function MapToolbar(p: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white/95 px-2 py-1.5 shadow-[0_6px_24px_-12px_rgba(15,40,80,0.35)] ring-1 ring-slate-200/80 backdrop-blur">
      <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs">
        {(
          [
            ['exterior', 'ภายนอก'],
            ['interior', 'ภายในอาคาร'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => p.onMode(value)}
            className={`whitespace-nowrap rounded-md px-3 py-1 transition ${p.mode === value ? 'bg-white font-semibold shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            style={p.mode === value ? { color: BRAND.primary } : undefined}
          >
            {label}
          </button>
        ))}
      </div>
      {p.mode === 'interior' && (
        <>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="ชั้นที่แสดง">
            {[...p.floors.map((f) => [f.id, f.name.replace('อาคาร ', '')] as const), [null, 'ทุกชั้น'] as const].map(([id, label]) => (
              <button
                key={id ?? 'all'}
                role="radio"
                aria-checked={p.floor === id}
                className={pill(p.floor === id)}
                onClick={() => p.onFloor(id)}
                title={id ? 'ดูชั้นนี้ชั้นเดียว' : 'ดูทุกชั้นซ้อนกัน (ปรับระยะแยกชั้นได้)'}
              >
                {label}
              </button>
            ))}
          </div>
          {p.floor === null && (
            <label className="flex items-center gap-1.5 whitespace-nowrap px-1 text-xs text-slate-500" title="ระยะห่างระหว่างชั้น">
              แยกชั้น
              <input className="w-20 accent-slate-700" type="range" min={1} max={5} step={0.5} value={p.explode} onChange={(e) => p.onExplode(Number(e.target.value))} />
            </label>
          )}
        </>
      )}
      <span className="h-5 w-px bg-slate-200" />
      <button className={pill(p.topView)} onClick={() => p.onTopView(!p.topView)}>
        มุมบน
      </button>
      <button className={pill(p.surroundings)} onClick={() => p.onSurroundings(!p.surroundings)} title="ถนน ต้นไม้ และพื้นที่รอบโรงงาน">
        รอบโรงงาน
      </button>
    </div>
  )
}
