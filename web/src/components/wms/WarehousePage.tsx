import { useEffect, useState } from 'react'
import { BRAND } from '../../data/brand'
import { useWms } from '../../wms/useWms'
import { pendingAcks } from '../../wms/closing'
import { InvoiceTab } from './InvoiceTab'
import { IssueTab } from './IssueTab'
import { LabelsTab } from './LabelsTab'
import { LedgerTab } from './LedgerTab'
import { ReceiveTab } from './ReceiveTab'
import { ScanTab } from './ScanTab'
import { Alert } from './ui'

export type WmsTab = 'receive' | 'labels' | 'scan' | 'invoice' | 'issue' | 'ledger'

const TABS: [WmsTab, string, string][] = [
  ['receive', '1', 'รับสินค้า'],
  ['labels', '2', 'ป้าย QR & พิมพ์'],
  ['scan', '3', 'สแกนหน้างาน'],
  ['invoice', '4', 'กระทบยอด Invoice'],
  ['issue', '5', 'เบิกเข้าไลน์'],
  ['ledger', '6', 'บัญชีคุม FM-P-537'],
]

/** ลิงก์จาก QR: /t/LPN-… เปิดหน้าสแกน, /g/GRN-… เปิดหน้าป้ายของ GRN นั้น */
export interface WmsDeepLink {
  kind: 'lpn' | 'grn'
  code: string
}

export function WarehousePage({ deepLink }: { deepLink: WmsDeepLink | null }) {
  const { api, ready, error, settings, can } = useWms()
  const [tab, setTab] = useState<WmsTab>(deepLink?.kind === 'lpn' ? 'scan' : deepLink?.kind === 'grn' ? 'labels' : 'receive')
  const [grnId, setGrnId] = useState<string | null>(null)

  useEffect(() => {
    if (deepLink?.kind !== 'grn') return
    let alive = true
    api.findGrnId(deepLink.code).then((id) => alive && id && setGrnId(id))
    return () => {
      alive = false
    }
  }, [api, deepLink])

  // ปิดยอดที่รอผู้ใช้คนนี้รับทราบ (Planning / บัญชี) ⇒ ตัวเลขแดงที่แท็บบัญชีคุม
  const [toAck, setToAck] = useState(0)
  useEffect(() => {
    if (!ready || !(can('ledger.ack.planning') || can('ledger.ack.account'))) return
    let alive = true
    api
      .listClosings()
      .then((c) => alive && setToAck(pendingAcks(c, can).length))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [api, ready, can, tab])

  const openGrn = (id: string) => {
    setGrnId(id)
    setTab('labels')
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav className="flex flex-wrap gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200" aria-label="งานคลัง">
            {TABS.map(([k, n, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                aria-current={tab === k ? 'page' : undefined}
                className={`flex min-h-[44px] items-center gap-2 rounded-lg px-4 text-[15px] font-semibold transition ${tab === k ? 'text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
                style={tab === k ? { background: BRAND.primary } : undefined}
              >
                <span className={`grid h-6 w-6 place-items-center rounded-full border-2 text-xs ${tab === k ? 'border-white' : 'border-slate-300'}`}>{n}</span>
                {label}
                {k === 'ledger' && toAck > 0 && (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[11px] font-bold text-white" title="ปิดยอดรอคุณรับทราบ">
                    {toAck}
                  </span>
                )}
              </button>
            ))}
          </nav>
          {settings.mode === 'trial' ? (
            <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-300" title="ข้อมูลโหมดทดลองแยกจากของจริง ผู้ดูแลระบบเริ่มรอบใหม่หรือเปลี่ยนเป็นใช้งานจริงได้ในหน้าหลังบ้าน">
              โหมดทดลอง · รอบที่ {settings.trialRound}
            </span>
          ) : (
            <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-300">ใช้งานจริง</span>
          )}
        </div>

        {api.kind === 'demo' && <Alert tone="info">หน้าสาธิต: ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น · ระบบจริงบันทึกลงฐานข้อมูลกลาง ทุกเครื่องเห็นชุดเดียวกัน</Alert>}
        {error && <Alert tone="bad">โหลดข้อมูลไม่สำเร็จ: {error}</Alert>}
        {!ready ? (
          <p className="py-16 text-center text-slate-500">กำลังโหลด…</p>
        ) : (
          <>
            {tab === 'receive' && <ReceiveTab onCreated={openGrn} />}
            {tab === 'labels' && <LabelsTab grnId={grnId} onSelectGrn={setGrnId} />}
            {tab === 'scan' && <ScanTab initialCode={deepLink?.kind === 'lpn' ? deepLink.code : null} />}
            {tab === 'invoice' && <InvoiceTab onOpenGrn={openGrn} />}
            {tab === 'issue' && <IssueTab />}
            {tab === 'ledger' && <LedgerTab />}
          </>
        )}
      </div>
    </div>
  )
}
