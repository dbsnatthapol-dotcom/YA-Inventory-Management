import { useCallback, useEffect, useState, type ReactNode } from 'react'
import logoUrl from '../../assets/uam-logo.png'
import { BRAND } from '../../data/brand'
import type { FactoryLayout } from '../../types/layout'
import { errorText } from '../../wms/api'
import type { Lpn } from '../../wms/types'
import { useWms } from '../../wms/useWms'
import { IconBox, IconPin, IconScan, IconSearch, IconTag } from '../map/icons'
import { MyWork } from '../wms/MyWork'
import { LabelsTab } from '../wms/LabelsTab'
import { MoveBoxes } from '../wms/MoveBoxes'
import { ReceivePage } from '../wms/ReceivePage'
import { ScanTab, type ScanMode } from '../wms/ScanTab'
import { Alert, Segmented } from '../wms/ui'
import type { WmsDeepLink } from '../wms/WarehousePage'
import { WarehousePlan, type PlanFocus } from '../plan/WarehousePlan'
import { MobileSearch } from './MobileSearch'

export type MobileTab = 'work' | 'receive' | 'labels' | 'scan' | 'search' | 'map'

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
  // ผังคลัง: โซน/ช่องที่เปิดจากหน้าค้นหา และกล่องที่ไฮไลต์
  const [focus, setFocus] = useState<PlanFocus | null>(null)
  const [highlight, setHighlight] = useState<ReadonlySet<string> | null>(null)
  const [menu, setMenu] = useState(false)
  // กล่องที่อยู่ในคลัง ใช้ร่วมกันระหว่างหน้าค้นหาและผัง
  const [lpns, setLpns] = useState<Lpn[] | null>(null)
  const [lpnError, setLpnError] = useState<string | null>(null)
  // รับของ: ใบตรวจรับที่เปิดจากหน้างาน · ค้นหา/ย้าย: โหมดย้ายของ (เลือกจากรายการ ไม่ต้องสแกน)
  const [receive, setReceive] = useState<{ checkId: string | null; key: number }>({ checkId: null, key: 0 })
  const [findMode, setFindMode] = useState<'find' | 'move'>('find')
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
            {tab === 'map' ? 'ผังคลัง' : tab === 'work' ? 'งานวันนี้' : `งานคลัง · ${TABS.find((t) => t.k === tab)?.label}`}
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
            <button className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-3 text-left hover:bg-slate-50" onClick={onDesktop}>
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

      <main className={`min-h-0 flex-1 ${tab === 'map' ? 'overflow-hidden' : 'overflow-y-auto'}`} onClick={() => menu && setMenu(false)}>
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
                  onOpenCheck={(id) => {
                    setReceive((r) => ({ checkId: id, key: r.key + 1 }))
                    setTab('receive')
                  }}
                  onMove={() => {
                    setFindMode('move')
                    setMoveFrom((m) => ({ place: 'staging', key: m.key + 1 }))
                    setTab('search')
                  }}
                />
              )}
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
                    label="ค้นหาหรือย้ายของ"
                    value={findMode}
                    onChange={setFindMode}
                    options={[
                      ['find', 'ค้นหา'],
                      ['move', 'ย้ายของ (ไม่ต้องสแกน)'],
                    ]}
                  />
                  {findMode === 'find' ? (
                    <MobileSearch layout={layout} lpns={lpns} error={lpnError} onRefresh={loadLpns} onScanLpn={scanLpn} onShowZone={showZone} />
                  ) : (
                    <MoveBoxes key={moveFrom.key} initialPlace={moveFrom.place} />
                  )}
                </>
              )}
            </>
          )}
        </div>
        )}
      </main>

      <nav className="grid shrink-0 grid-cols-6 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]" aria-label="เมนูหน้างาน">
        {TABS.map((t) => (
          <button
            key={t.k}
            onClick={() => go(t.k)}
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
