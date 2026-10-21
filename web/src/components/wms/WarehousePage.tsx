import { useEffect, useState } from 'react'
import { BRAND } from '../../data/brand'
import { useWms } from '../../wms/useWms'
import { pendingAcks } from '../../wms/closing'
import { usePrintQueue } from '../../wms/usePrintQueue'
import { useApprovals } from '../../wms/useApprovals'
import { CountTab } from './CountTab'
import { InvoiceTab } from './InvoiceTab'
import { IssueTab } from './IssueTab'
import { LabelsTab } from './LabelsTab'
import { LedgerTab } from './LedgerTab'
import { MoveBoxes } from './MoveBoxes'
import { MyWork } from './MyWork'
import { ReceivePage } from './ReceivePage'
import { ScanTab, type ScanMode } from './ScanTab'
import type { Zone } from '../../types/layout'
import { Alert } from './ui'

export type WmsTab = 'work' | 'receive' | 'labels' | 'scan' | 'move' | 'invoice' | 'issue' | 'ledger' | 'count'

const TABS: [WmsTab, string, string][] = [
  ['work', '✓', 'งานวันนี้'],
  ['receive', '1', 'รับสินค้า / ตรวจรับ'],
  ['labels', '2', 'ป้าย QR & พิมพ์'],
  ['scan', '3', 'สแกนหน้างาน'],
  ['move', '4', 'ย้าย / จัดเก็บ'],
  ['invoice', '5', 'กระทบยอด Invoice'],
  ['issue', '6', 'เบิกเข้าไลน์'],
  ['ledger', '7', 'บัญชีคุม FM-P-537'],
  ['count', '8', 'ตรวจนับ & อนุมัติ'],
]

/** ลิงก์จาก QR: /t/LPN-… เปิดหน้าสแกน, /g/GRN-… เปิดหน้าป้ายของ GRN นั้น */
export interface WmsDeepLink {
  kind: 'lpn' | 'grn'
  code: string
}

export function WarehousePage({ deepLink, zones, initialTab }: { deepLink: WmsDeepLink | null; zones: Zone[]; /** เปิดแท็บนี้ก่อน (เช่น จากหน้าภาพรวม) */ initialTab?: WmsTab | null }) {
  const { api, ready, error, settings, can } = useWms()
  const [tab, setTab] = useState<WmsTab>(initialTab ?? (deepLink?.kind === 'lpn' ? 'scan' : deepLink?.kind === 'grn' ? 'labels' : 'work'))
  const [grnId, setGrnId] = useState<string | null>(null)
  // เปิดหน้าสแกนที่กล่อง + งานที่เลือกจากหน้างานวันนี้ (key ใหม่ = เริ่มหน้าสแกนใหม่)
  const [scan, setScan] = useState<{ code: string | null; mode?: ScanMode; key: number }>({ code: deepLink?.kind === 'lpn' ? deepLink.code : null, key: 0 })
  const scanBox = (code: string, mode: ScanMode) => {
    setScan((s) => ({ code, mode, key: s.key + 1 }))
    setTab('scan')
  }
  // ใบตรวจรับที่เปิดจากหน้างานวันนี้ (key ใหม่ = เปิดหน้ารับของใหม่ที่ใบนั้น) · ย้ายของ: เปิดที่กล่องในจุดรับของ
  const [receive, setReceive] = useState<{ checkId: string | null; key: number }>({ checkId: null, key: 0 })
  const [moveFrom, setMoveFrom] = useState<{ place: 'all' | 'staging'; key: number }>({ place: 'all', key: 0 })

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

  // งานพิมพ์ที่มือถือส่งมารอ ⇒ ตัวเลขที่แท็บป้าย (หน้าป้ายมีคิวให้กดพิมพ์)
  const printQueue = usePrintQueue(ready && can('label.print') && tab !== 'labels')
  // คำขอปรับยอดรออนุมัติ (สแกน + Excel) ⇒ ตัวเลขที่แท็บตรวจนับ & อนุมัติ (สแกนเสร็จนับใหม่ทันที)
  const [approvalsVer, setApprovalsVer] = useState(0)
  const approvals = useApprovals(ready && can('scan.adjust.approve') && tab !== 'count', approvalsVer)

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
                onClick={() => {
                  // เปิดแท็บสแกนเอง = เริ่มสแกนใหม่ด้วยงานที่จำไว้ (ไม่ย้อนไปกล่อง/งานที่สั่งจากหน้างานวันนี้)
                  if (k === 'scan' && tab !== 'scan') setScan((s) => ({ code: null, key: s.key + 1 }))
                  if (k === 'receive' && tab !== 'receive') setReceive((r) => ({ checkId: null, key: r.key + 1 }))
                  if (k === 'move' && tab !== 'move') setMoveFrom((m) => ({ place: 'all', key: m.key + 1 }))
                  setTab(k)
                }}
                aria-current={tab === k ? 'page' : undefined}
                className={`flex min-h-[44px] items-center gap-2 rounded-lg px-4 text-[15px] font-semibold transition ${tab === k ? 'text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
                style={tab === k ? { background: BRAND.primary } : undefined}
              >
                <span className={`grid h-6 w-6 place-items-center rounded-full border-2 text-xs ${tab === k ? 'border-white' : 'border-slate-300'}`}>{n}</span>
                {label}
                {k === 'labels' && tab !== 'labels' && printQueue.queued.length > 0 && (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-amber-500 px-1 text-[11px] font-bold text-white" title="งานพิมพ์จากมือถือรออยู่">
                    {printQueue.queued.length}
                  </span>
                )}
                {k === 'count' && tab !== 'count' && approvals.total > 0 && (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-amber-500 px-1 text-[11px] font-bold text-white" title="รออนุมัติปรับยอด">
                    {approvals.total}
                  </span>
                )}
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
            {tab === 'work' && (
              <MyWork
                onScan={scanBox}
                onTab={setTab}
                onOpenCheck={(id) => {
                  setReceive((r) => ({ checkId: id, key: r.key + 1 }))
                  setTab('receive')
                }}
                onMove={() => {
                  setMoveFrom((m) => ({ place: 'staging', key: m.key + 1 }))
                  setTab('move')
                }}
              />
            )}
            {tab === 'receive' && <ReceivePage key={receive.key} openCheckId={receive.checkId} onReceived={openGrn} />}
            {tab === 'move' && <MoveBoxes key={moveFrom.key} initialPlace={moveFrom.place} />}
            {tab === 'labels' && <LabelsTab grnId={grnId} onSelectGrn={setGrnId} />}
            {tab === 'scan' && (
              <ScanTab key={scan.key} initialCode={scan.code} initialMode={scan.mode} onOpenApprovals={() => setTab('count')} onChanged={() => setApprovalsVer((v) => v + 1)} />
            )}
            {tab === 'invoice' && <InvoiceTab onOpenGrn={openGrn} />}
            {tab === 'issue' && <IssueTab />}
            {tab === 'ledger' && <LedgerTab />}
            {tab === 'count' && <CountTab zones={zones} />}
          </>
        )}
      </div>
    </div>
  )
}
