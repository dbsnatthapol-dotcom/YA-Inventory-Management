import type { ReactNode } from 'react'
import type { CameraCommand } from '../FactoryScene'
import { IconHome, IconMinus, IconPlus, IconRotateLeft, IconRotateRight } from './icons'

type Kind = Exclude<CameraCommand['kind'], 'focus'>

const BUTTONS: [Kind, string, ReactNode][] = [
  ['zoomIn', 'ซูมเข้า', <IconPlus key="i" />],
  ['zoomOut', 'ซูมออก', <IconMinus key="o" />],
  ['rotateLeft', 'หมุนซ้าย 45°', <IconRotateLeft key="l" />],
  ['rotateRight', 'หมุนขวา 45°', <IconRotateRight key="r" />],
  ['home', 'กลับมุมเริ่มต้น', <IconHome key="h" />],
]

/** ปุ่มควบคุมกล้องบนจอ (สำหรับแท็บเล็ต/มือถือที่ไม่มีเมาส์) */
export function CameraButtons({ onCommand }: { onCommand: (kind: Kind) => void }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl bg-white/95 shadow-[0_6px_24px_-12px_rgba(15,40,80,0.35)] ring-1 ring-slate-200/80 backdrop-blur">
      {BUTTONS.map(([kind, label, icon], i) => (
        <button
          key={kind}
          onClick={() => onCommand(kind)}
          title={label}
          aria-label={label}
          className={`flex h-10 w-10 items-center justify-center text-slate-600 hover:bg-slate-100 hover:text-slate-900 ${i === 2 || i === 4 ? 'border-t border-slate-100' : ''}`}
        >
          {icon}
        </button>
      ))}
    </div>
  )
}
