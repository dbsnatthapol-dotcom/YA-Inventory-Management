import logoUrl from '../../assets/uam-logo.png'
import logoBlack from '../../assets/uam-logo-black.png'
import { BRAND } from '../../data/brand'

/**
 * โลโก้ UAM + ชื่อบริษัท สำหรับป้ายและเอกสารที่พิมพ์
 * mono = เครื่องพิมพ์ฉลากความร้อน (ขาวดำ): โลโก้ดำทึบ ตัวอักษรดำ · ไม่ใช่ mono = โลโก้สีฟ้าตามจริง
 */
export function BrandMark({ mono = false, logo = '10mm', name = '8pt', subtitle, subSize = '6.5pt' }: { mono?: boolean; logo?: string; name?: string; subtitle?: React.ReactNode; subSize?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-[2mm]">
      <img src={mono ? logoBlack : logoUrl} alt="UAM" className="shrink-0 object-contain" style={{ height: logo, width: `calc(${logo} * 1.21)` }} />
      <div className="min-w-0 leading-tight">
        <div className="font-bold" style={{ fontSize: name, color: mono ? '#000' : BRAND.primary }}>
          {BRAND.legalName}
        </div>
        {subtitle && <div style={{ fontSize: subSize }}>{subtitle}</div>}
      </div>
    </div>
  )
}
