import { useEffect, useMemo, useState } from 'react'
import { AuthProvider } from './auth/AuthProvider'
import { ChangePasswordScreen, LoadingScreen, LoginScreen } from './auth/AuthScreens'
import { ROLE_LABEL } from './auth/staff'
import { useAuth } from './auth/useAuth'
import { BackofficePage } from './components/admin/BackofficePage'
import { WarehousePage, type WmsDeepLink } from './components/wms/WarehousePage'
import { WmsProvider } from './wms/WmsProvider'
import { useWms } from './wms/useWms'
import { layoutSavePayload } from './lib/layoutSave'
import { useViewModeState, ViewModeContext } from './lib/viewMode'
import { MobileShell } from './components/mobile/MobileShell'
import { ModeChooser } from './components/mobile/ModeChooser'
import { ExecTour } from './components/map/ExecTour'
import { buildGuides, buildTourSteps, flowsFromTx, sampleFlows } from './lib/mapShowcase'
import type { FlowSpec } from './components/FactoryScene'
import type { Tx } from './wms/types'
import { FactoryScene, type CameraCommand, type MapPinSpec, type ViewMode } from './components/FactoryScene'
import { CameraButtons } from './components/map/CameraButtons'
import { IconClose, IconPanel } from './components/map/icons'
import { KpiStrip } from './components/map/KpiStrip'
import { MapLegend } from './components/map/MapLegend'
import { MapToolbar } from './components/map/MapToolbar'
import { PalletCard } from './components/map/PalletCard'
import { SearchBox } from './components/map/SearchBox'
import { palletsFor } from './data/warehouse'
import { buildingOf } from './lib/geometry'
import { mapStats } from './lib/mapStats'
import type { StockHit } from './components/mobile/stockSearch'
import { RoutePanel } from './components/RoutePanel'
import logoUrl from './assets/uam-logo.png'
import { BRAND } from './data/brand'
import { sampleLayout } from './data/factoryLayout'
import { applyLayoutEdits } from './lib/layoutEdit'
import { loadLayout, type LoadedLayout } from './lib/layoutSource'
import { useLayoutEdits } from './lib/useLayoutEdits'
import { findRoute, type RouteOptions } from './lib/pathfinding'
import { emptyZone } from './wms/mapStock'
import { useMapStock } from './wms/useMapStock'
import { ZonePanel } from './components/ZonePanel'
import { LayoutEditorPage } from './components/layout-editor/LayoutEditorPage'
import type { Zone } from './types/layout'

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  )
}

/** ต่อ Supabase แล้ว = ต้อง login ก่อนทุกหน้า · ไม่ได้ต่อ (หน้าสาธิต) = เข้าได้เลย */
function AuthGate() {
  const auth = useAuth()
  if (!auth.enabled) return <WmsApp />
  if (auth.loading) return <LoadingScreen />
  if (!auth.session || !auth.profile?.active) return <LoginScreen />
  if (auth.profile.must_change_password) return <ChangePasswordScreen />
  return <WmsApp />
}

/** ข้อมูลงานคลังโหลดหลัง login แล้วเท่านั้น (สิทธิ์ผูกกับบัญชี) */
function WmsApp() {
  return (
    <WmsProvider>
      <FactoryApp />
    </WmsProvider>
  )
}

/** ลิงก์จาก QR บนป้าย: /t/LPN-2610-000001 (กล่อง) หรือ /g/GRN-2610-0001 (ใบรับสินค้า) */
function readDeepLink(): WmsDeepLink | null {
  const m = window.location.pathname.match(/^\/(t|g)\/([A-Za-z0-9-]+)\/?$/)
  if (!m) return null
  window.history.replaceState(null, '', '/')
  return { kind: m[1] === 't' ? 'lpn' : 'grn', code: decodeURIComponent(m[2]).toUpperCase() }
}

function FactoryApp() {
  const auth = useAuth()
  const role = auth.enabled ? (auth.profile?.role ?? null) : null
  const [loaded, setLoaded] = useState<LoadedLayout>({ layout: sampleLayout, source: 'sample' })
  const layoutEdits = useLayoutEdits()
  const wms = useWms()
  const view = useViewModeState()
  // สิทธิ์แก้ผังกำหนดในตารางสิทธิ์ (layout.edit) · โหมดสาธิตเปิดให้ทดลอง
  const canEditLayout = role === null || wms.can('layout.edit')
  // ผังที่ใช้งานจริง = ผังหลัก + ตำแหน่งที่ผู้ใช้ปรับ (ทางเดินที่ถูกขวางถูกปิด, จุดเข้า-ออกคำนวณใหม่)
  const layout = useMemo(() => applyLayoutEdits(loaded.layout, layoutEdits.edits), [loaded.layout, layoutEdits.edits])
  const [sourceId, setSourceId] = useState('TENT-C')
  const [targetId, setTargetId] = useState('F2-ASM')
  const [options, setOptions] = useState<Required<Pick<RouteOptions, 'optimize' | 'avoid'>>>({
    optimize: 'time',
    avoid: [],
  })
  const [tripsPerDay, setTripsPerDay] = useState(40)
  const [mode, setMode] = useState<ViewMode>('exterior')
  const [explode, setExplode] = useState(2.5)
  const [hiddenFloors, setHiddenFloors] = useState<Set<string>>(new Set())
  const [topView, setTopView] = useState(false)
  const [showSurroundings, setShowSurroundings] = useState(false)
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
  const [sideTab, setSideTab] = useState<'zone' | 'route'>('zone')
  const [deepLink] = useState(readDeepLink)
  const [page, setPage] = useState<'map' | 'wms' | 'layout' | 'admin'>(deepLink ? 'wms' : 'map')
  const canAdmin = !auth.enabled || role === 'admin' || role === 'manager'
  // ของบนผัง / ช่องค้นหา / หน้าปรับผัง มาจากกล่องในระบบคลังชุดเดียวกับงานคลังและมือถือ
  const [searchAwake, setSearchAwake] = useState(false)
  const mapData = useMapStock(page === 'map' || page === 'layout' || searchAwake, layout, page)

  useEffect(() => {
    loadLayout().then(setLoaded)
  }, [])

  /** บันทึกผังที่แก้ลงฐานข้อมูลกลาง แล้วโหลดผัง + ช่องเก็บใหม่ */
  const saveLayout = async () => {
    await wms.api.saveLayout(layoutSavePayload(loaded.layout, layoutEdits.edits))
    const fresh = await loadLayout()
    setLoaded(fresh)
    layoutEdits.saved()
    await wms.reload()
  }

  // ถ้าโซนที่เลือกไว้ถูกลบในหน้าปรับผัง ใช้ค่าเริ่มต้นแทน
  const source = layout.zones.find((z) => z.id === sourceId) ?? layout.zones.find((z) => z.id === 'TENT-C')
  const target = layout.zones.find((z) => z.id === targetId) ?? layout.zones.find((z) => z.kind === 'assembly')
  const route = useMemo(
    () => (source && target ? findRoute(layout, source.accessNodeId, target.accessNodeId, options) : null),
    [layout, source, target, options],
  )

  const handleZoneClick = (zone: Zone) => {
    setSelectedPallet(null)
    if (zone.kind !== 'stairs' && zone.kind !== 'lift' && zone.kind !== 'assembly') {
      setSelectedZoneId(zone.id)
      setSideTab('zone')
    }
    if (zone.kind === 'assembly') setTargetId(zone.id)
    else if (zone.kind === 'storage' || zone.kind === 'receiving' || zone.kind === 'tent') setSourceId(zone.id)
  }

  const toggleFloor = (id: string) =>
    setHiddenFloors((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // เรียงตามอาคารแล้วตามความสูง (A ชั้น 1-3, F ชั้น 1 / ชั้นลอย / ชั้น 2)
  const buildingFloors = useMemo(
    () => layout.floors.filter((f) => f.area === 'building').sort((a, b) => buildingOf(a).localeCompare(buildingOf(b)) || a.elevation - b.elevation),
    [layout.floors],
  )
  const zoneStock = mapData.stock

  // ---- ผังเต็มจอ: ค้นหา, หมุด, พาเลท, กล้อง
  const [panelOpen, setPanelOpen] = useState(true)
  const [qcPins, setQcPins] = useState(true)
  /** โซนที่ผลค้นหาอยู่ (part เดียวอยู่ได้หลายโซน) และป้ายกล่องที่ไฮไลต์ */
  const [searchZones, setSearchZones] = useState<string[]>([])
  const [highlight, setHighlight] = useState<ReadonlySet<string> | null>(null)
  const [selectedPallet, setSelectedPallet] = useState<{ zoneId: string; index: number } | null>(null)
  const [cameraCommand, setCameraCommand] = useState<CameraCommand | null>(null)
  const camera = (cmd: DistributiveOmit<CameraCommand, 'n'>) => setCameraCommand((prev) => ({ ...cmd, n: (prev?.n ?? 0) + 1 }) as CameraCommand)

  const stats = useMemo(() => mapStats(layout, zoneStock, mapData.activity), [layout, zoneStock, mapData.activity])

  // ---- ไกด์ประจำจุด, heatmap, live flow, โหมดนำเสนอ
  const [guidesOn, setGuidesOn] = useState(true)
  const [openGuide, setOpenGuide] = useState<string | null>(null)
  const [heatmap, setHeatmap] = useState(false)
  const [liveFlow, setLiveFlow] = useState(false)
  const [flowTx, setFlowTx] = useState<Tx[]>([])
  const [tourIndex, setTourIndex] = useState<number | null>(null)
  const guides = useMemo(() => (guidesOn ? buildGuides(layout, zoneStock, wms.master.zoneHeads, stats) : undefined), [guidesOn, layout, zoneStock, wms.master.zoneHeads, stats])
  // ดึงความเคลื่อนไหวล่าสุดจากระบบทุก 20 วินาทีระหว่างเปิด Live flow
  useEffect(() => {
    if (!liveFlow || page !== 'map') return
    let alive = true
    const pull = () =>
      wms.api
        .recentTx(40)
        .then((t) => alive && setFlowTx(t))
        .catch(() => undefined)
    void pull()
    const timer = setInterval(pull, 20000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [liveFlow, page, wms.api])
  const flows = useMemo<FlowSpec[]>(() => {
    if (!liveFlow) return []
    const real = flowsFromTx(flowTx, wms.master.locations, layout)
    return real.length || wms.api.kind !== 'demo' ? real : sampleFlows(layout)
  }, [liveFlow, flowTx, wms.master.locations, wms.api.kind, layout])
  const tourSteps = useMemo(() => buildTourSteps(layout, stats, zoneStock), [layout, stats, zoneStock])
  const pins = useMemo<MapPinSpec[]>(() => {
    const list: MapPinSpec[] = searchZones.map((zoneId) => ({ zoneId, tone: 'search' }))
    if (qcPins)
      for (const [zoneId, z] of zoneStock)
        if (z.pendingQcQty > 0 && !searchZones.includes(zoneId) && layout.zones.some((zone) => zone.id === zoneId)) list.push({ zoneId, tone: 'qc' })
    return list
  }, [searchZones, qcPins, zoneStock, layout.zones])

  /** เลือกผลค้นหา: เปิดชั้นที่ของอยู่, เลือกโซนที่มีของมากสุด, ไฮไลต์กล่อง แล้วบินกล้องไปหา */
  const pickSearch = (hit: StockHit) => {
    const qty = new Map<string, number>()
    for (const b of hit.boxes) if (b.zoneId) qty.set(b.zoneId, (qty.get(b.zoneId) ?? 0) + b.qty)
    const zoneIds = hit.zoneId ? [hit.zoneId] : [...qty].sort((a, b) => b[1] - a[1]).map(([id]) => id)
    const zone = layout.zones.find((z) => z.id === zoneIds[0])
    if (!zone) return
    const floor = layout.floors.find((f) => f.id === zone.floorId)
    const inBuilding = floor?.area === 'building'
    setPage('map')
    setMode(inBuilding ? 'interior' : 'exterior')
    setTopView(false)
    // ซ่อนชั้นที่อยู่เหนือของที่ค้นหา (ไม่ให้บังมุมกล้อง) และเปิดชั้นของมันถ้าซ่อนอยู่
    if (inBuilding && floor)
      setHiddenFloors(new Set(buildingFloors.filter((f) => f.elevation > floor.elevation).map((f) => f.id)))
    setSideTab('zone')
    setSelectedZoneId(zone.id)
    setSearchZones(zoneIds)
    setPanelOpen(true)
    setHighlight(hit.boxes.length ? new Set(hit.boxes.map((b) => b.lpnNo)) : null)
    const index = hit.kind === 'lpn' ? palletsFor(zoneStock.get(zone.id)).findIndex((p) => p.lpnNo === hit.title) : -1
    setSelectedPallet(index >= 0 ? { zoneId: zone.id, index } : null)
    camera({ kind: 'focus', zoneId: zone.id })
  }
  /** จากหน้าปรับผัง: เปิดผัง 3D ภายในอาคารที่โซนนั้น */
  const open3D = (zoneId: string | null) => {
    setPage('map')
    setMode('interior')
    setTopView(false)
    const zone = zoneId ? layout.zones.find((z) => z.id === zoneId) : undefined
    if (!zone) return
    const floor = layout.floors.find((f) => f.id === zone.floorId)
    if (floor) setHiddenFloors(new Set(buildingFloors.filter((f) => f.elevation > floor.elevation).map((f) => f.id)))
    setSelectedZoneId(zone.id)
    setSideTab('zone')
    camera({ kind: 'focus', zoneId: zone.id })
  }
  /** ไปจุดที่ i ของทัวร์นำเสนอ: ตั้งมุมมอง ชั้นที่แสดง heatmap/live flow ไกด์ แล้วบินกล้องไปหา */
  const goTour = (i: number | null) => {
    setTourIndex(i)
    if (i === null) {
      setOpenGuide(null)
      return
    }
    const step = tourSteps[i]
    if (!step) return
    setPage('map')
    setPanelOpen(false)
    setTopView(false)
    setMode(step.mode)
    setHeatmap(!!step.heatmap)
    setLiveFlow(!!step.flow)
    setGuidesOn(true)
    setOpenGuide(step.guide ? step.zoneId : null)
    const zone = step.zoneId ? layout.zones.find((z) => z.id === step.zoneId) : undefined
    const floor = zone && layout.floors.find((f) => f.id === zone.floorId)
    setHiddenFloors(floor && floor.area === 'building' && step.mode === 'interior' ? new Set(buildingFloors.filter((f) => f.elevation > floor.elevation).map((f) => f.id)) : new Set())
    camera(zone ? { kind: 'focus', zoneId: zone.id } : { kind: 'home' })
  }

  const clearSearch = () => {
    setSearchZones([])
    setHighlight(null)
    setSelectedPallet(null)
  }

  // เครื่องนี้ยังไม่เคยเลือกโหมด: ถามครั้งเดียวหลังเข้าระบบ แล้วจำไว้
  if (!view.chosen) return <ModeChooser narrow={view.narrow} userName={auth.profile?.full_name} onPick={view.setPref} />

  // มือถือ: หน้าจอหน้างาน (ไม่โหลดผัง 3D)
  if (view.mode === 'mobile')
    return (
      <ViewModeContext.Provider value="mobile">
        <MobileShell
          layout={layout}
          deepLink={deepLink}
          user={auth.profile ? { name: auth.profile.full_name, code: auth.profile.employee_code, role: ROLE_LABEL[auth.profile.role] } : null}
          onSignOut={auth.profile ? () => void auth.signOut() : undefined}
          onDesktop={() => view.setPref('desktop')}
        />
      </ViewModeContext.Provider>
    )

  return (
    <div className="flex h-full flex-col bg-slate-100">
      <header className="relative z-30 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex items-center gap-2.5">
          <img src={logoUrl} alt={BRAND.shortName} className="h-9 w-11 object-contain" />
          <div className="leading-tight">
            <div className="text-[13px] font-bold tracking-wide" style={{ color: BRAND.primary }}>
              {layout.siteName.toUpperCase()}
            </div>
            <div className="text-[11px] text-slate-500">ระบบบริหารคลังสินค้า · ผังโรงงาน 3 มิติ</div>
          </div>
        </div>

        <nav className="flex rounded-lg bg-slate-100 p-0.5 text-sm" aria-label="เมนูหลัก">
          {(
            [
              ['map', 'ผังโรงงาน 3D'],
              ['wms', 'งานคลัง'],
              ...(canEditLayout ? ([['layout', 'ปรับผัง']] as const) : []),
              ...(canAdmin ? ([['admin', 'หลังบ้าน']] as const) : []),
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setPage(value)}
              className={`rounded-md px-3 py-1 transition ${page === value ? 'font-semibold text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
              style={page === value ? { background: BRAND.primary } : undefined}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="order-last w-full flex-1 md:order-none md:w-auto">
          <SearchBox
            layout={layout}
            lpns={mapData.lpns}
            master={wms.master}
            onPick={pickSearch}
            onClear={clearSearch}
            onWake={() => setSearchAwake(true)}
            active={searchZones.length > 0}
          />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <button
            className="rounded-full px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            onClick={() => view.setPref('mobile')}
            title="หน้าจอสำหรับหน้างาน: สแกน รับของ ค้นหา ผัง 2D (เครื่องนี้จะจำไว้)"
          >
            📱 โหมดมือถือ
          </button>
          <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200 lg:flex" title="แหล่งข้อมูลผัง">
            <i className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {loaded.source === 'supabase' ? 'Supabase' : 'ผังตัวอย่าง'}
          </span>
          {auth.profile ? (
            <span className="flex items-center gap-2 text-xs">
              <span className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: BRAND.primary }}>
                {auth.profile.full_name.slice(0, 2)}
              </span>
              <span className="hidden leading-tight sm:block">
                <span className="block font-semibold text-slate-800">{auth.profile.full_name}</span>
                <span className="text-slate-500">
                  {auth.profile.employee_code} · {ROLE_LABEL[auth.profile.role]}
                </span>
              </span>
              <button className="rounded-md px-2 py-1 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50" onClick={() => void auth.signOut()}>
                ออกจากระบบ
              </button>
            </span>
          ) : (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">โหมดสาธิต</span>
          )}
        </div>
      </header>

      {page === 'layout' && (
        <main className="min-h-0 flex-1">
          <LayoutEditorPage
            layout={layout}
            baseLayout={loaded.layout}
            api={layoutEdits}
            stock={zoneStock}
            canEdit={canEditLayout}
            onSave={loaded.source === 'supabase' ? saveLayout : undefined}
            onOpen3D={open3D}
          />
        </main>
      )}
      {page === 'wms' && (
        <main className="min-h-0 flex-1">
          <WarehousePage deepLink={deepLink} zones={layout.zones} />
        </main>
      )}
      {page === 'admin' && (
        <main className="min-h-0 flex-1">
          <BackofficePage zones={layout.zones} />
        </main>
      )}

      {/* ผังเต็มจอ + แผงลอย · ซ่อนแทนการ unmount เพื่อคงมุมกล้อง */}
      <main className={`relative min-h-0 flex-1 flex-col overflow-y-auto md:overflow-hidden ${page === 'map' ? 'flex md:block' : 'hidden'}`}>
        <div className="relative h-[64vh] shrink-0 md:absolute md:inset-0 md:h-auto">
          <FactoryScene
            layout={layout}
            mode={mode}
            explode={explode}
            hiddenFloors={hiddenFloors}
            selectedZoneIds={[sourceId, targetId, ...(selectedZoneId ? [selectedZoneId] : [])]}
            route={sideTab === 'route' ? route : null}
            onZoneClick={handleZoneClick}
            onBuildingClick={() => setMode('interior')}
            topView={topView}
            active={page === 'map'}
            showSurroundings={showSurroundings}
            zoneStock={zoneStock}
            highlight={highlight}
            selectedPallet={selectedPallet}
            onPalletClick={(zoneId, index) => {
              setSelectedPallet({ zoneId, index })
              setSideTab('zone')
              setPanelOpen(true)
            }}
            pins={pins}
            cameraCommand={cameraCommand}
            focusShiftPx={panelOpen && window.innerWidth >= 768 ? 200 : 0}
            guides={guides}
            openGuide={openGuide}
            onGuideToggle={(id) => setOpenGuide((cur) => (cur === id ? null : id))}
            heatmap={heatmap}
            flows={flows}
          />

          {tourIndex !== null && <ExecTour steps={tourSteps} index={tourIndex} onIndex={goTour} onExit={() => goTour(null)} />}

          {/* มุมซ้ายบน: ตัวเลขสรุป + แถบมุมมอง */}
          <div className={`pointer-events-none absolute left-3 right-16 top-3 z-20 flex flex-col items-start gap-2 ${panelOpen ? 'md:right-[26.5rem]' : 'md:right-16'}`}>
            <div className="pointer-events-auto max-w-full">
              <KpiStrip stats={stats} qcPins={qcPins} onToggleQcPins={() => setQcPins((v) => !v)} />
            </div>
            <div className="pointer-events-auto max-w-full">
              <MapToolbar
                mode={mode}
                onMode={setMode}
                floors={buildingFloors}
                hiddenFloors={hiddenFloors}
                onToggleFloor={toggleFloor}
                explode={explode}
                onExplode={setExplode}
                topView={topView}
                onTopView={setTopView}
                surroundings={showSurroundings}
                onSurroundings={setShowSurroundings}
              />
            </div>
            <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-xl bg-white/95 px-2 py-1.5 shadow-[0_6px_24px_-12px_rgba(15,40,80,0.35)] ring-1 ring-slate-200/80 backdrop-blur">
              {(
                [
                  ['👷 ไกด์ประจำจุด', guidesOn, () => setGuidesOn((v) => !v), 'พนักงานประจำแต่ละจุด คลิกเพื่อดูสรุป'],
                  ['🌡️ Heatmap', heatmap, () => setHeatmap((v) => !v), 'ระบายสีโซนตามความเต็ม (ดูในโหมดภายในอาคาร)'],
                  ['⚡ Live flow', liveFlow, () => setLiveFlow((v) => !v), 'การเคลื่อนไหวล่าสุดในระบบ วิ่งตามเส้นทางจริง'],
                ] as const
              ).map(([label, on, toggle, title]) => (
                <button
                  key={label}
                  onClick={toggle}
                  title={title}
                  className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs transition ${on ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() => goTour(0)}
                className="whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold text-white shadow-sm"
                style={{ background: BRAND.primary }}
                title="ทัวร์อัตโนมัติสำหรับนำเสนอผู้บริหาร"
              >
                ▶ โหมดนำเสนอ
              </button>
            </div>
          </div>

          {/* ขวาบน: ปุ่มกล้อง (ชิดซ้ายของแผงข้อมูล) */}
          <div className={`pointer-events-none absolute right-3 top-3 z-20 flex items-start gap-2 ${panelOpen ? 'md:right-[23.5rem]' : ''}`}>
            <div className="pointer-events-auto flex flex-col gap-2">
              <CameraButtons onCommand={(kind) => camera({ kind })} />
              {!panelOpen && (
                <button
                  className="hidden h-10 w-10 items-center justify-center rounded-xl bg-white/95 text-slate-600 shadow-[0_6px_24px_-12px_rgba(15,40,80,0.35)] ring-1 ring-slate-200/80 hover:text-slate-900 md:flex"
                  onClick={() => setPanelOpen(true)}
                  title="เปิดแผงข้อมูล"
                >
                  <IconPanel />
                </button>
              )}
            </div>
          </div>

          <div className={`pointer-events-none absolute bottom-3 left-3 right-3 z-20 hidden md:block ${panelOpen ? 'md:right-[23.5rem]' : ''}`}>
            <div className="pointer-events-auto flex max-w-full flex-wrap items-end gap-2">
              <MapLegend mode={mode} editMode={false} />
              {heatmap && (
                <div className="rounded-xl bg-white/95 px-3 py-2 text-xs text-slate-600 shadow ring-1 ring-slate-200">
                  <div className="mb-1 font-semibold text-slate-800">Heatmap ความเต็ม</div>
                  <div className="flex gap-3">
                    {(
                      [
                        ['#94a3b8', 'ว่าง'],
                        ['#22c55e', '< 50%'],
                        ['#f59e0b', '50–85%'],
                        ['#ef4444', '> 85%'],
                      ] as const
                    ).map(([c, t]) => (
                      <span key={t} className="flex items-center gap-1">
                        <i className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {liveFlow && tourIndex === null && (
                <div className="max-w-xs rounded-xl bg-white/95 px-3 py-2 text-xs text-slate-600 shadow ring-1 ring-slate-200">
                  <div className="mb-1 font-semibold text-slate-800">⚡ ความเคลื่อนไหวล่าสุด</div>
                  {flows.length === 0 ? (
                    <div className="text-slate-400">ยังไม่มีรายการ (อัปเดตทุก 20 วินาที)</div>
                  ) : (
                    <ul className="space-y-0.5">
                      {flows.slice(0, 6).map((f) => (
                        <li key={f.id} className="flex items-center gap-1.5 truncate">
                          <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: f.color }} />
                          <span className="truncate">
                            {f.label} · {layout.zones.find((z) => z.id === f.from)?.code} → {layout.zones.find((z) => z.id === f.to)?.code}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* แผงข้อมูล: ลอยด้านขวาบนจอใหญ่ · ต่อท้ายผังบนมือถือ */}
        <aside
          className={`flex flex-col bg-white md:absolute md:z-20 md:bottom-3 md:right-3 md:top-3 md:w-[22rem] md:overflow-hidden md:rounded-xl md:shadow-[0_10px_40px_-16px_rgba(15,40,80,0.45)] md:ring-1 md:ring-slate-200 ${
            panelOpen ? '' : 'md:hidden'
          }`}
        >
          <div className="flex items-center gap-1 border-b border-slate-100 p-2 text-sm">
            {(
              [
                ['zone', 'ของในโซน'],
                ['route', 'ระยะเดิน'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSideTab(key)}
                className={`flex-1 rounded-lg px-2 py-1.5 transition ${sideTab === key ? 'font-semibold text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                style={sideTab === key ? { background: BRAND.primary } : undefined}
              >
                {label}
              </button>
            ))}
            <button className="hidden rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 md:block" onClick={() => setPanelOpen(false)} title="ซ่อนแผง">
              <IconClose />
            </button>
          </div>
          {sideTab === 'zone' ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm text-slate-700">
              {selectedPallet && (
                <div className="-mx-1 mb-4">
                  <PalletCard
                    layout={layout}
                    stock={zoneStock.get(selectedPallet.zoneId)}
                    lpns={mapData.lpns}
                    zoneId={selectedPallet.zoneId}
                    index={selectedPallet.index}
                    onClose={() => setSelectedPallet(null)}
                  />
                </div>
              )}
              <ZonePanel
                layout={layout}
                zoneId={selectedZoneId}
                contents={selectedZoneId ? (zoneStock.get(selectedZoneId) ?? emptyZone(selectedZoneId)) : null}
                allZones={zoneStock}
                onSelectZone={(id) => {
                  setSelectedZoneId(id)
                  setSelectedPallet(null)
                  const zone = layout.zones.find((z) => z.id === id)
                  if (zone) {
                    setMode(layout.floors.find((f) => f.id === zone.floorId)?.area === 'building' ? 'interior' : 'exterior')
                    camera({ kind: 'focus', zoneId: id })
                  }
                }}
              />
              {selectedZoneId && (
                <button className="mt-3 text-xs text-sky-700 hover:underline" onClick={() => setSelectedZoneId(null)}>
                  ← ดูทุกโซน
                </button>
              )}
            </div>
          ) : (
            <RoutePanel
              layout={layout}
              sourceId={sourceId}
              targetId={targetId}
              options={options}
              tripsPerDay={tripsPerDay}
              route={route}
              onSourceChange={setSourceId}
              onTargetChange={setTargetId}
              onOptionsChange={setOptions}
              onTripsChange={setTripsPerDay}
            />
          )}
        </aside>
      </main>
    </div>
  )
}

/** Omit ที่กระจายผ่าน union (Omit ธรรมดาจะรวม union เป็นก้อนเดียว) */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
