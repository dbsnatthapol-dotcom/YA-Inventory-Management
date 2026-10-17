import { useMemo, useState } from 'react'
import type { FactoryLayout } from '../../types/layout'
import { fmt, lpnFromScan } from '../../wms/logic'
import type { Lpn } from '../../wms/types'
import { useWms } from '../../wms/useWms'
import { QrScanner } from '../wms/QrScanner'
import { Alert, BigButton, Card, inputCls, Pill } from '../wms/ui'
import { searchStock, type StockHit } from './stockSearch'

interface Props {
  layout: FactoryLayout
  lpns: Lpn[] | null
  error: string | null
  onRefresh: () => Promise<void>
  onScanLpn: (lpnNo: string) => void
  /** เปิดผังคลังที่โซน: ไฮไลต์กล่องที่พบ · code = ช่องที่จะเลือก (ค้นด้วยรหัสช่อง) */
  onShowZone: (zoneId: string, lpnNos: string[], code?: string) => void
}

/** ค้นหาของในคลัง: พิมพ์หรือสแกน เลขป้าย / Part No. / ชื่อ part / รหัสช่องหรือโซน */
export function MobileSearch({ layout, lpns, error, onRefresh, onScanLpn, onShowZone }: Props) {
  const { master } = useWms()
  const [q, setQ] = useState('')
  const [camera, setCamera] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const hits = useMemo(() => (lpns ? searchStock(q, lpns, master, layout) : []), [q, lpns, master, layout])

  const refresh = async () => {
    setRefreshing(true)
    await onRefresh()
    setRefreshing(false)
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        {camera && (
          <QrScanner
            onCode={(t) => {
              setQ(lpnFromScan(t))
              setCamera(false)
            }}
            onClose={() => setCamera(false)}
          />
        )}
        <input
          className={`${inputCls} font-mono text-base`}
          placeholder="เลขป้าย / Part No. / ชื่อ part / ช่อง"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
          aria-label="ค้นหา"
        />
        <div className="grid grid-cols-2 gap-2">
          {!camera && (
            <BigButton type="button" onClick={() => setCamera(true)}>
              📷 สแกน QR
            </BigButton>
          )}
          <BigButton type="button" tone="secondary" disabled={refreshing} onClick={() => void refresh()} className={camera ? 'col-span-2' : ''}>
            {refreshing ? 'กำลังโหลด…' : '↻ อัปเดตข้อมูล'}
          </BigButton>
        </div>
        {lpns && <p className="text-xs text-slate-500">ของในคลัง {fmt(lpns.length)} กล่อง · พิมพ์อย่างน้อย 2 ตัวอักษร</p>}
      </Card>

      {error && <Alert tone="bad">โหลดข้อมูลกล่องไม่สำเร็จ: {error}</Alert>}
      {!lpns && !error && <p className="py-8 text-center text-slate-500">กำลังโหลดของในคลัง…</p>}
      {lpns && q.trim().length >= 2 && hits.length === 0 && <Alert tone="warn">ไม่พบ "{q.trim()}" ในของที่อยู่ในคลัง</Alert>}

      {hits.map((h) => (
        <HitCard key={`${h.kind}-${h.key}`} hit={h} onScanLpn={onScanLpn} onShowZone={onShowZone} />
      ))}
    </div>
  )
}

function HitCard({ hit, onScanLpn, onShowZone }: { hit: StockHit; onScanLpn: (lpnNo: string) => void; onShowZone: Props['onShowZone'] }) {
  const eyebrow = { lpn: 'ป้ายกล่อง', part: 'Part', place: 'ช่อง / โซน' }[hit.kind]
  return (
    <Card
      eyebrow={eyebrow}
      title={<span className="font-mono">{hit.title}</span>}
      action={
        hit.zoneId ? (
          <MapButton
            onClick={() =>
              onShowZone(
                hit.zoneId!,
                hit.boxes.map((b) => b.lpnNo),
                hit.kind === 'place' ? hit.title : undefined,
              )
            }
          />
        ) : undefined
      }
    >
      {hit.subtitle && <p className="-mt-2 text-sm text-slate-600">{hit.subtitle}</p>}
      <div className="flex flex-wrap gap-1.5">
        <Pill tone="info">{fmt(hit.qty)} ชิ้น</Pill>
        <Pill tone="muted">{hit.boxes.length} กล่อง</Pill>
        {hit.boxes.some((b) => b.hold) && <Pill tone="mi3">มีของรอ MI3</Pill>}
      </div>
      <ul className="flex flex-col divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
        {hit.boxes.slice(0, 30).map((b) => (
          <li key={`${b.lpnNo}-${b.partNo}`} className="flex items-center gap-2 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-sm font-semibold text-slate-800">{hit.kind === 'part' ? b.location : b.partNo}</div>
              <div className="truncate text-xs text-slate-500">
                {[b.lpnNo, `${fmt(b.qty)} ชิ้น`, hit.kind === 'place' ? b.location : null, b.hold ? 'รอ MI3' : null].filter(Boolean).join(' · ')}
              </div>
            </div>
            {b.zoneId && hit.kind === 'part' && <MapButton small onClick={() => onShowZone(b.zoneId!, [b.lpnNo])} />}
            <button className="min-h-[40px] rounded-lg px-3 text-sm font-semibold text-sky-700 ring-1 ring-sky-200" onClick={() => onScanLpn(b.lpnNo)}>
              เปิด
            </button>
          </li>
        ))}
        {hit.boxes.length === 0 && <li className="px-3 py-2.5 text-sm text-slate-500">ไม่มีของในคลังตอนนี้</li>}
        {hit.boxes.length > 30 && <li className="px-3 py-2 text-xs text-slate-500">และอีก {hit.boxes.length - 30} กล่อง</li>}
      </ul>
    </Card>
  )
}

function MapButton({ onClick, small }: { onClick: () => void; small?: boolean }) {
  return (
    <button className={`rounded-lg font-semibold text-emerald-700 ring-1 ring-emerald-200 ${small ? 'min-h-[40px] px-2 text-xs' : 'min-h-[40px] px-3 text-sm'}`} onClick={onClick}>
      📍 ผัง
    </button>
  )
}
