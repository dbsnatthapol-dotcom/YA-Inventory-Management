import { useEffect, useState } from 'react'
import { errorText } from '../../wms/api'
import type { ReceiptCheck } from '../../wms/types'
import { useWms } from '../../wms/useWms'
import { CheckList, CheckView } from './CheckSheet'
import { ReceiveTab } from './ReceiveTab'
import { Segmented } from './ui'

/**
 * รับของ: เริ่มจาก Packing List → สร้างใบตรวจรับ (ตรวจทีละเคส มือถือ/คอม หลายคนพร้อมกัน) หรือกรอกยอดแล้วรับเลย
 * openCheckId = เปิดใบตรวจรับนี้ทันที (จากหน้างานวันนี้)
 */
export function ReceivePage({ openCheckId, onReceived }: { openCheckId?: string | null; onReceived: (grnId: string) => void }) {
  const { api } = useWms()
  const [view, setView] = useState<'new' | 'checks'>(openCheckId ? 'checks' : 'new')
  const [checkId, setCheckId] = useState<string | null>(openCheckId ?? null)
  const [checks, setChecks] = useState<ReceiptCheck[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ver, setVer] = useState(0)

  useEffect(() => {
    let alive = true
    api
      .listChecks()
      .then((c) => {
        if (!alive) return
        setChecks(c)
        setError(null)
      })
      .catch((e) => alive && setError(errorText(e)))
    return () => {
      alive = false
    }
  }, [api, ver])

  const open = (checks ?? []).filter((c) => c.status === 'open').length
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label="รับของ"
        value={view}
        onChange={(v) => {
          setView(v)
          if (v === 'checks') setCheckId(null)
        }}
        options={[
          ['new', 'รับของใหม่'],
          ['checks', `ใบตรวจรับ${open ? ` · ค้าง ${open}` : ''}`],
        ]}
      />
      {view === 'new' && (
        <ReceiveTab
          onCreated={onReceived}
          onCheckCreated={(id) => {
            setCheckId(id)
            setView('checks')
            setVer((v) => v + 1)
          }}
        />
      )}
      {view === 'checks' &&
        (checkId ? (
          <CheckView key={checkId} id={checkId} onBack={() => setCheckId(null)} onReceived={onReceived} onChanged={() => setVer((v) => v + 1)} />
        ) : (
          <CheckList checks={checks} error={error} onOpen={setCheckId} />
        ))}
    </div>
  )
}
