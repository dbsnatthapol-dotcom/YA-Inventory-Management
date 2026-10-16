import logoUrl from '../../assets/uam-logo.png'
import { BRAND } from '../../data/brand'
import type { ViewMode } from '../../lib/viewMode'

const OPTIONS: { mode: ViewMode; icon: string; title: string; detail: string }[] = [
  { mode: 'mobile', icon: '📱', title: 'หน้างาน (มือถือ)', detail: 'รับของ · ป้าย QR & พิมพ์ · สแกน 7 โหมด · ค้นหา · ผัง 2D นำทาง' },
  { mode: 'desktop', icon: '🖥️', title: 'สำนักงาน (คอม)', detail: 'ผังโรงงาน 3D · งานคลังครบทุกแท็บ · บัญชีคุม · หลังบ้าน · คิวพิมพ์ป้าย' },
]

/**
 * ถามครั้งแรกบนเครื่องนี้ว่าจะใช้โหมดไหน แล้วจำไว้ (เปลี่ยนได้จากเมนูทุกเมื่อ)
 * แนะนำตามขนาดจอ: จอแคบ = หน้างาน, จอกว้าง = สำนักงาน
 */
export function ModeChooser({ narrow, userName, onPick }: { narrow: boolean; userName?: string; onPick: (m: ViewMode) => void }) {
  const suggested: ViewMode = narrow ? 'mobile' : 'desktop'
  return (
    <div className="flex min-h-full items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg ring-1 ring-slate-200">
        <div className="flex items-center gap-3">
          <img src={logoUrl} alt="UAM" className="h-11 w-13 object-contain" />
          <div className="leading-tight">
            <div className="text-sm font-bold" style={{ color: BRAND.primary }}>
              {BRAND.legalName}
            </div>
            <div className="text-xs text-slate-500">ระบบบริหารคลังสินค้า UAM WMS</div>
          </div>
        </div>
        <h1 className="mt-5 text-lg font-bold text-slate-800">{userName ? `สวัสดี ${userName}` : 'ยินดีต้อนรับ'} · เครื่องนี้ใช้ทำงานแบบไหน?</h1>
        <p className="text-sm text-slate-500">เลือกครั้งเดียว เครื่องนี้จะจำไว้ เปลี่ยนได้ทุกเมื่อจากเมนู</p>
        <div className="mt-4 flex flex-col gap-3">
          {OPTIONS.map((o) => (
            <button
              key={o.mode}
              onClick={() => onPick(o.mode)}
              className={`flex items-start gap-3 rounded-xl p-4 text-left ring-2 transition hover:bg-sky-50 ${o.mode === suggested ? 'ring-sky-600' : 'ring-slate-200'}`}
            >
              <span className="text-3xl leading-none">{o.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-base font-bold text-slate-800">
                  {o.title}
                  {o.mode === suggested && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">แนะนำสำหรับจอนี้</span>}
                </span>
                <span className="mt-0.5 block text-sm text-slate-500">{o.detail}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
