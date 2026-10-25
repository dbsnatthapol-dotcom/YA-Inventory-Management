import { useOpenTrace } from '../../wms/traceNav'

/** ปุ่ม "ตามรอย" ไปหน้าตามรอยของเลขนี้ (ซ่อนเองเมื่อหน้าหลักไม่มีหน้าตามรอย) */
export function TraceButton({ query, label = 'ตามรอย', className = '' }: { query: string | null | undefined; label?: string; className?: string }) {
  const open = useOpenTrace()
  if (!open || !query) return null
  return (
    <button
      type="button"
      onClick={() => open(query)}
      title={`ดูเอกสารทั้งสายของ ${query}: Packing List → ใบตรวจรับ → GRN → กล่อง → ใบเบิก → บัญชีคุม`}
      className={`inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2.5 text-sm font-semibold text-sky-700 ring-1 ring-sky-200 hover:bg-sky-50 ${className}`}
    >
      ↔ {label}
    </button>
  )
}
