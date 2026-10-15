import { MODEL_COLOR } from '../../data/modelColors'

const LINES: [string, string][] = [
  ['#f2c200', 'ทางเดิน / พื้นที่ทำงาน'],
  ['#ffffff', 'ตำแหน่ง rack'],
  ['#f07c1b', 'รอคัด MI3'],
  ['#e34948', 'กัก NG'],
  ['repeating-linear-gradient(45deg,#f2c200 0 3px,#1d1d1f 3px 6px)', 'จุดอันตราย'],
]

/** คำอธิบายสีเส้นพื้นและสีพาเลท */
export function MapLegend({ mode, editMode }: { mode: 'exterior' | 'interior'; editMode: boolean }) {
  return (
    <div className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-white/95 px-3 py-1.5 text-[11px] text-slate-600 shadow-[0_6px_24px_-12px_rgba(15,40,80,0.35)] ring-1 ring-slate-200/80 backdrop-blur">
      {mode === 'exterior' ? (
        <span>คลิกอาคาร A เพื่อดูภายใน · คลิกเต็นท์เพื่อดูของที่เก็บ</span>
      ) : (
        <>
          {LINES.map(([c, label]) => (
            <span key={label} className="flex items-center gap-1">
              <i className="inline-block h-2.5 w-2.5 rounded-sm ring-1 ring-slate-300" style={{ background: c }} />
              {label}
            </span>
          ))}
          <span className="h-3 w-px bg-slate-200" />
          <span className="flex flex-wrap items-center gap-x-2">
            สีพาเลท:
            {Object.entries(MODEL_COLOR).map(([m, c]) => (
              <span key={m} className="flex items-center gap-0.5">
                <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
                {m}
              </span>
            ))}
          </span>
          {editMode && <span className="font-semibold text-blue-700">โหมดแก้ไข: ลากโซนเพื่อย้าย</span>}
        </>
      )}
    </div>
  )
}
