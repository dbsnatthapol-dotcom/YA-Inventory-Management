import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import logoUrl from '../../assets/uam-logo.png'
import { BRAND } from '../../data/brand'
import type { FactoryLayout } from '../../types/layout'
import { errorText } from '../../wms/api'
import type { FlowKey } from '../../wms/flowBoard'
import { TraceContext } from '../../wms/traceNav'
import type { Lpn } from '../../wms/types'
import { useWms } from '../../wms/useWms'
import { IconBox, IconPin, IconScan, IconSearch, IconTag } from '../map/icons'
import { MyWork } from '../wms/MyWork'
import { LabelsTab } from '../wms/LabelsTab'
import { MoveBoxes } from '../wms/MoveBoxes'
import { ReceivePage } from '../wms/ReceivePage'
import { ScanTab, type ScanMode } from '../wms/ScanTab'
import { SystemMap, type MapTarget } from '../wms/SystemMap'
import { TracePage } from '../wms/TracePage'
import { Alert, Segmented } from '../wms/ui'
import type { WmsDeepLink } from '../wms/WarehousePage'
import { WarehousePlan, type PlanFocus } from '../plan/WarehousePlan'
import { MobileSearch } from './MobileSearch'

/** system = ผังระบบงาน (เปิดจากเมนู ☰ ไม่อยู่ในเมนูล่าง) */
export type MobileTab = 'work' | 'receive' | 'labels' | 'scan' | 'search' | 'map' | 'system'

// งานวันนี้ก่อน แล้วเรียงตามลำดับงานหน้างาน: รับของ → พิมพ์ป้าย → สแกน (จัดเก็บ/ย้าย/เบิก/ตรวจนับ/MI3) · ค้นหา · ผัง
const TABS: { k: MobileTab; label: string; icon: ReactNode }[] = [
  { k: 'work', label: 'งาน', icon: <span className="text-base font-bold leading-none">✓</span> },
  { k: 'receive', label: 'รับของ', icon: <IconBox /> },
  { k: 'labels', label: 'ป้าย', icon: <IconTag /> },
  { k: 'scan', label: 'สแกน', icon: <IconScan /> },
  { k: 'search', label: 'ค้นหา/ย้าย', icon: <IconSearch size={18} /> },
  { k: 'map', label: 'ผัง', icon: <IconPin size={18} /> },
]

interface Props {
  layout: FactoryLayout
  deepLink: WmsDeepLink | null
  user: { name: string; code: string; role: string } | null
  onSignOut?: () => void
  onDesktop: () => void
}

/**
 * โหมดมือถือสำหรับหน้างาน: เมนูล่าง 6 อย่าง (งานวันนี้ รับของ ป้าย สแกน ค้นหา ผังคลัง 2D รายช่อง) ปุ่มใหญ่ ใช้มือเดียว
 * ไม่โหลดผัง 3D (ประหยัดแบตและเน็ต) · ผัง 3D ปรับผัง หลังบ้าน ใช้บนจอคอม
 */
export function MobileShell({ layout, deepLink, user, onSignOut, onDesktop }: Props) {
  const { api, ready, error, settings } = useWms()
  const [tab, setTab] = useState<MobileTab>(deepLink?.kind === 'grn' ? 'labels' : deepLink?.kind === 'lpn' ? 'scan' : 'work')
  const [scan, setScan] = useState<{ code: string | null; mode?: ScanMode; key: number }>({ code: deepLink?.kind === 'lpn' ? deepLink.code : null, key: 0 })
  const [grnId, setGrnId] = useState<string | null>(null)
  // เปลี่ยนแท็บ ⇒ เริ่มที่บนสุดเสมอ (เช่น ออก GRN แล้วเปิดหน้าป้าย ต้องเห็นเลข GRN ก่อนปุ่มยกเลิกใบรับ)
  const mainRef = useRef<HTMLElement>(null)
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [tab, grnId])
  // ผังคลัง: โซน/ช่องที่เปิดจากหน้าค้นหา และกล่องที่ไฮไลต์
  const [focus, setFocus] = useState<PlanFocus | null>(null)
  const [highlight, setHighlight] = useState<ReadonlySet<string> | null>(null)
  const [menu, setMenu] = useState(false)
  // กล่องที่อยู่ในคลัง ใช้ร่วมกันระหว่างหน้าค้นหาและผัง
  const [lpns, setLpns] = useState<Lpn[] | null>(null)
  const [lpnError, setLpnError] = useState<string | null>(null)
  // รับของ: ใบตรวจรับที่เปิดจากหน้างาน · ค้นหา/ย้าย: โหมดย้ายของ (เลือกจากรายการ ไม่ต้องสแกน)
  const [receive, setReceive] = useState<{ checkId: string | null; key: number }>({ checkId: null, key: 0 })
  const [findMode, setFindMode] = useState<'find' | 'trace' | 'move'>('find')
  // ตามรอย: เปิดจากปุ่มในหน้าอื่นด้วยเลขเอกสาร (key ใหม่ = ค้นใหม่)
  const [trace, setTrace] = useState<{ query: string; key: number } | null>(null)
  const [moveFrom, setMoveFrom] = useState<{ place: 'all' | 'staging'; key: number }>({ place: 'all', key: 0 })

  const loadLpns = useCallback(async () => {
    try {
      setLpns(await api.activeLpns())
      setLpnError(null)
    } catch (e) {
      setLpnError(errorText(e))
    }
  }, [api])

  useEffect(() => {
    if (deepLink?.kind !== 'grn') return
    let alive = true
    api.findGrnId(deepLink.code).then((id) => alive && id && setGrnId(id))
    return () => {
      alive = false
    }
  }, [api, deepLink])

  // เปิดหน้าค้นหา/ผังครั้งแรก ⇒ โหลดกล่องในคลัง
  const needLpns = tab === 'search' || tab === 'map'
  useEffect(() => {
    if (!needLpns || lpns) return
    let alive = true
    api
      .activeLpns()
      .then((l) => alive && setLpns(l))
      .catch((e) => alive && setLpnError(errorText(e)))
    return () => {
      alive = false
    }
  }, [api, needLpns, lpns])

  const go = (t: MobileTab) => {
    // เปิดแท็บสแกนเอง = เริ่มสแกนใหม่ด้วยงานที่จำไว้
    if (t === 'scan' && tab !== 'scan') setScan((s) => ({ code: null, key: s.key + 1 }))
    if (t === 'receive' && tab !== 'receive') setReceive((r) => ({ checkId: null, key: r.key + 1 }))
    setTab(t)
    setMenu(false)
    if (t === 'map') setHighlight(null)
    if (t === 'search' || t === 'map') void loadLpns()
  }
  const scanLpn = (code: string, mode?: ScanMode) => {
    setScan((s) => ({ code, mode, key: s.key + 1 }))
    setTab('scan')
  }
  const openTrace = (query: string) => {
    setTrace((t) => ({ query, key: (t?.key ?? 0) + 1 }))
    setFindMode('trace')
    setTab('search')
    setMenu(false)
  }
  const openCheck = (id: string) => {
    setReceive((r) => ({ checkId: id, key: r.key + 1 }))
    setTab('receive')
  }
  const openGrn = (id: string) => {
    setGrnId(id)
    setTab('labels')
  }
  const scanMode = (mode: ScanMode) => {
    setScan((s) => ({ code: null, mode, key: s.key + 1 }))
    setTab('scan')
  }
  // ผังขั้นตอนงาน: ขั้นที่หน้างานวันนี้ไม่มีรายการให้ทำ ⇒ ไปหน้าจอของขั้นนั้น (กระทบ FM-P-005 / ปิดยอด หน้างานวันนี้บอกให้ไปทำที่คอม)
  const onFlow = (k: FlowKey) => {
    if (k === 'check') return go('receive')
    if (k === 'grn') return go('labels')
    if (k === 'stock') return go('map')
    if (k === 'qi') return scanMode('QI')
    if (k === 'ng' || k === 'issue') return scanMode('ISSUE')
    if (k === 'put') {
      setFindMode('move')
      setMoveFrom((m) => ({ place: 'staging', key: m.key + 1 }))
      go('search')
    }
  }
  /** จากผังระบบงาน: มือถือเปิดได้เฉพาะหน้างาน */
  const MAP_TABS: Partial<Record<MapTarget, MobileTab>> = { work: 'work', receive: 'receive', labels: 'labels', scan: 'scan', plan: 'map', move: 'search', trace: 'search' }
  const goMap = (to: MapTarget) => {
    if (to === 'move' || to === 'trace') setFindMode(to)
    const t = MAP_TABS[to]
    if (t) go(t)
  }
  const showZone = (zoneId: string, lpnNos: string[], code?: string) => {
    setFocus((f) => ({ zoneId, lpnNo: lpnNos.length === 1 ? lpnNos[0] : null, code: code ?? null, n: (f?.n ?? 0) + 1 }))
    setHighlight(lpnNos.length ? new Set(lpnNos) : null)
    setTab('map')
  }

  return (
    <div className="flex h-full flex-col bg-slate-100">
      <header className="relative z-30 flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <img src={logoUrl} alt={BRAND.shortName} className="h-8 w-9 object-contain" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-bold" style={{ color: BRAND.primary }}>
            {tab === 'map' ? 'ผังคลัง' : tab === 'work' ? 'งานวันนี้' : tab === 'system' ? 'ผังระบบงาน' : `งานคลัง · ${TABS.find((t) => t.k === tab)?.label}`}
          </div>
          <div className="truncate text-[11px] text-slate-500">{user ? `${user.name} · ${user.code}` : 'โหมดสาธิต'}</div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${settings.mode === 'trial' ? 'bg-amber-100 text-amber-800 ring-amber-300' : 'bg-emerald-100 text-emerald-800 ring-emerald-300'}`}
        >
          {settings.mode === 'trial' ? `ทดลอง ${settings.trialRound}` : 'ใช้งานจริง'}
        </span>
        <button
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
          style={{ background: BRAND.primary }}
          onClick={() => setMenu((m) => !m)}
          aria-label="เมนู"
          aria-expanded={menu}
        >
          {user ? user.name.slice(0, 2) : '☰'}
        </button>
        {menu && (
          <div className="absolute right-2 top-full mt-1 w-64 rounded-xl bg-white p-2 text-sm shadow-lg ring-1 ring-slate-200">
            {user && (
              <div className="border-b border-slate-100 px-2 pb-2 text-xs text-slate-500">
                <b className="block text-sm text-slate-800">{user.name}</b>
                {user.code} · {user.role}
              </div>
            )}
            <button className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-3 text-left hover:bg-slate-50" onClick={() => go('system')}>
              🗺 ผังระบบงาน (ขั้นตอน · ใครทำอะไร)
            </button>
            <button className="flex w-full items-center gap-2 rounded-lg px-2 py-3 text-left hover:bg-slate-50" onClick={() => openTrace('')}>
              ↔ ตามรอยเอกสาร / กล่อง
            </button>
            <button className="flex w-full items-center gap-2 rounded-lg px-2 py-3 text-left hover:bg-slate-50" onClick={onDesktop}>
              🖥️ สลับเป็นโหมดคอม (ผัง 3D, ปรับผัง, หลังบ้าน)
            </button>
            {onSignOut && (
              <button className="flex w-full items-center gap-2 rounded-lg px-2 py-3 text-left text-rose-600 hover:bg-rose-50" onClick={onSignOut}>
                ออกจากระบบ
              </button>
            )}
          </div>
        )}
      </header>

      <TraceContext.Provider value={openTrace}>
        <main ref={mainRef} className={`min-h-0 flex-1 ${tab === 'map' ? 'overflow-hidden' : 'overflow-y-auto'}`} onClick={() => menu && setMenu(false)}>
          {tab === 'map' ? (
            <WarehousePlan layout={layout} lpns={lpns} error={lpnError} focus={focus} highlight={highlight} onOpenLpn={scanLpn} />
          ) : (
          <div className="flex flex-col gap-3 p-3">
            {api.kind === 'demo' && <Alert tone="info">หน้าสาธิต: ข้อมูลเก็บในเครื่องนี้เท่านั้น</Alert>}
            {error && <Alert tone="bad">โหลดข้อมูลไม่สำเร็จ: {error}</Alert>}
            {!ready ? (
              <p className="py-16 text-center text-slate-500">กำลังโหลด…</p>
            ) : (
              <>
                {tab === 'work' && (
                  <MyWork
                    onScan={scanLpn}
                    onOpenCheck={openCheck}
                    onMove={() => {
                      setFindMode('move')
                      setMoveFrom((m) => ({ place: 'staging', key: m.key + 1 }))
                      setTab('search')
                    }}
                    onFlow={onFlow}
                  />
                )}
                {tab === 'system' && <SystemMap compact onGo={goMap} canGo={(to) => !!MAP_TABS[to]} />}
                {tab === 'scan' && <ScanTab key={scan.key} initialCode={scan.code} initialMode={scan.mode} />}
                {tab === 'receive' && (
                  <ReceivePage
                    key={receive.key}
                    openCheckId={receive.checkId}
                    onReceived={(id) => {
                      // รับเสร็จ ⇒ ไปหน้าป้ายของ GRN นี้ทันที
                      setGrnId(id)
                      setTab('labels')
                    }}
                  />
                )}
                {tab === 'labels' && <LabelsTab grnId={grnId} onSelectGrn={setGrnId} />}
                {tab === 'search' && (
                  <>
                    <Segmented
                      label="ค้นหา ตามรอย หรือย้ายของ"
                      value={findMode}
                      onChange={setFindMode}
                      options={[
                        ['find', 'ค้นหา'],
                        ['trace', 'ตามรอย'],
                        ['move', 'ย้ายของ'],
                      ]}
                    />
                    {findMode === 'find' && (
                      // เปิดกล่องจากผลค้นหา = ดูข้อมูล (ไม่ไปโหมดเบิก/ตรวจที่จำไว้โดยไม่ตั้งใจ)
                      <MobileSearch layout={layout} lpns={lpns} error={lpnError} onRefresh={loadLpns} onScanLpn={(lpnNo) => scanLpn(lpnNo, 'VIEW')} onShowZone={showZone} />
                    )}
                    {findMode === 'trace' && <TracePage compact start={trace} links={{ check: openCheck, grn: openGrn, box: (lpnNo) => scanLpn(lpnNo, 'VIEW') }} />}
                    {findMode === 'move' && <MoveBoxes key={moveFrom.key} initialPlace={moveFrom.place} />}
                  </>
                )}
              </>
            )}
          </div>
          )}
        </main>
      </TraceContext.Provider>

      <nav className="grid shrink-0 grid-cols-6 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]" aria-label="เมนูหน้างาน">
        {TABS.map((t) => (
          <button
            key={t.k}
            onClick={() => {
              // แตะเมนูล่างเข้าหน้าค้นหาใหม่ = เริ่มที่ "ค้นหา" (ไม่ค้างที่ย้ายของ/ตามรอยจากครั้งก่อน)
              if (t.k === 'search' && tab !== 'search') setFindMode('find')
              go(t.k)
            }}
            aria-current={tab === t.k ? 'page' : undefined}
            className={`flex min-h-[58px] flex-col items-center justify-center gap-0.5 text-xs font-semibold transition ${tab === t.k ? '' : 'text-slate-500'}`}
            style={tab === t.k ? { color: BRAND.primary } : undefined}
          >
            <span className={`grid h-7 w-12 place-items-center rounded-full ${tab === t.k ? 'bg-sky-100' : ''}`}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
