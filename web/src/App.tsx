import { useEffect, useMemo, useState } from 'react'
import { AuthProvider } from './auth/AuthProvider'
import { ChangePasswordScreen, LoadingScreen, LoginScreen } from './auth/AuthScreens'
import { can, ROLE_LABEL } from './auth/staff'
import { useAuth } from './auth/useAuth'
import { UsersPage } from './components/admin/UsersPage'
import { FactoryScene, type CameraCommand, type MapPinSpec, type ViewMode } from './components/FactoryScene'
import { CameraButtons } from './components/map/CameraButtons'
import { IconClose, IconPanel } from './components/map/icons'
import { KpiStrip } from './components/map/KpiStrip'
import { MapLegend } from './components/map/MapLegend'
import { MapToolbar } from './components/map/MapToolbar'
import { PalletCard } from './components/map/PalletCard'
import { SearchBox } from './components/map/SearchBox'
import { palletsFor } from './data/warehouse'
import { mapStats } from './lib/mapStats'
import type { SearchHit } from './lib/search'
import { InventoryPage } from './components/inventory/InventoryPage'
import { RoutePanel } from './components/RoutePanel'
import logoUrl from './assets/uam-logo.png'
import { BRAND } from './data/brand'
import { sampleLayout } from './data/factoryLayout'
import { applyLayoutEdits, isEditable } from './lib/layoutEdit'
import { loadLayout, type LoadedLayout } from './lib/layoutSource'
import { useLayoutEdits } from './lib/useLayoutEdits'
import { findRoute, type RouteOptions } from './lib/pathfinding'
import { useInventory } from './inventory/useInventory'
import { bangkokDate, zoneContents, zoneTotals } from './inventory/reports'
import { ZonePanel } from './components/ZonePanel'
import { LayoutEditorPanel } from './components/LayoutEditorPanel'
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
  if (!auth.enabled) return <FactoryApp />
  if (auth.loading) return <LoadingScreen />
  if (!auth.session || !auth.profile?.active) return <LoginScreen />
  if (auth.profile.must_change_password) return <ChangePasswordScreen />
  return <FactoryApp />
}

function FactoryApp() {
  const auth = useAuth()
  const role = auth.enabled ? (auth.profile?.role ?? null) : null
  const staffName = auth.profile ? `${auth.profile.full_name} (${auth.profile.employee_code})` : undefined
  const [loaded, setLoaded] = useState<LoadedLayout>({ layout: sampleLayout, source: 'sample' })
  const layoutEdits = useLayoutEdits()
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
  const [sideTab, setSideTab] = useState<'zone' | 'route' | 'edit'>('zone')
  const [editZoneId, setEditZoneId] = useState<string | null>(null)
  const editMode = sideTab === 'edit'
  const [page, setPage] = useState<'map' | 'inventory' | 'users'>('map')
  const inventory = useInventory(staffName)

  useEffect(() => {
    loadLayout().then(setLoaded)
  }, [])

  const source = layout.zones.find((z) => z.id === sourceId)
  const target = layout.zones.find((z) => z.id === targetId)
  const route = useMemo(
    () => (source && target ? findRoute(layout, source.accessNodeId, target.accessNodeId, options) : null),
    [layout, source, target, options],
  )

  const handleZoneClick = (zone: Zone) => {
    setSelectedPallet(null)
    if (editMode) {
      if (isEditable(zone, layout.floors.find((f) => f.id === zone.floorId))) setEditZoneId(zone.id)
      return
    }
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

  const buildingFloors = layout.floors.filter((f) => f.area === 'building')
  const zoneStock = useMemo(() => zoneTotals(inventory.state), [inventory.state])

  /** เปิดผัง 3D ที่โซนจัดเก็บ (เรียกจากหน้ารับเข้า/สต็อก) */
  const showZone = (zoneId: string) => {
    const zone = layout.zones.find((z) => z.id === zoneId)
    if (!zone) return
    handleZoneClick(zone)
    setMode(layout.floors.find((f) => f.id === zone.floorId)?.area === 'building' ? 'interior' : 'exterior')
    setPage('map')
  }

  // ---- ผังเต็มจอ: ค้นหา, หมุด, พาเลท, กล้อง
  const [panelOpen, setPanelOpen] = useState(true)
  const [qcPins, setQcPins] = useState(true)
  const [searchZoneId, setSearchZoneId] = useState<string | null>(null)
  const [highlightLot, setHighlightLot] = useState<string | null>(null)
  const [selectedPallet, setSelectedPallet] = useState<{ zoneId: string; index: number } | null>(null)
  const [cameraCommand, setCameraCommand] = useState<CameraCommand | null>(null)
  const camera = (cmd: DistributiveOmit<CameraCommand, 'n'>) => setCameraCommand((prev) => ({ ...cmd, n: (prev?.n ?? 0) + 1 }) as CameraCommand)

  const stats = useMemo(() => mapStats(layout, inventory.state, zoneStock, bangkokDate()), [layout, inventory.state, zoneStock])
  const pins = useMemo<MapPinSpec[]>(() => {
    const list: MapPinSpec[] = searchZoneId ? [{ zoneId: searchZoneId, tone: 'search' }] : []
    if (qcPins)
      for (const [zoneId, z] of zoneStock)
        if (z.pendingQcQty > 0 && zoneId !== searchZoneId && layout.zones.some((zone) => zone.id === zoneId)) list.push({ zoneId, tone: 'qc' })
    return list
  }, [searchZoneId, qcPins, zoneStock, layout.zones])

  /** เลือกผลค้นหา: เปิดชั้นที่ของอยู่, เลือกโซน, ไฮไลต์พาเลทของ lot แล้วบินกล้องไปหา */
  const pickSearch = (hit: SearchHit) => {
    const zone = hit.kind === 'zone' ? hit.zone : hit.zone
    if (!zone) return
    const floor = layout.floors.find((f) => f.id === zone.floorId)
    const inBuilding = floor?.area === 'building'
    setPage('map')
    setMode(inBuilding ? 'interior' : 'exterior')
    setTopView(false)
    // ซ่อนชั้นที่อยู่เหนือของที่ค้นหา (ไม่ให้บังมุมกล้อง) และเปิดชั้นของมันถ้าซ่อนอยู่
    if (inBuilding && floor)
      setHiddenFloors(new Set(buildingFloors.filter((f) => f.elevation > floor.elevation).map((f) => f.id)))
    if (sideTab === 'edit') setSideTab('zone')
    setSelectedZoneId(zone.id)
    setSearchZoneId(zone.id)
    setPanelOpen(true)
    if (hit.kind === 'lot') {
      setHighlightLot(hit.lot.id)
      const index = palletsFor(zoneContents(inventory.state, zone.id)).findIndex((p) => p.lotId === hit.lot.id)
      setSelectedPallet(index >= 0 ? { zoneId: zone.id, index } : null)
    } else {
      setHighlightLot(null)
      setSelectedPallet(null)
    }
    camera({ kind: 'focus', zoneId: zone.id })
  }
  const clearSearch = () => {
    setSearchZoneId(null)
    setHighlightLot(null)
    setSelectedPallet(null)
  }

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
              ['inventory', 'รับเข้า & สต็อก'],
              ...(auth.enabled && can(role, 'viewAccessLog') ? ([['users', 'ผู้ใช้งาน']] as const) : []),
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
          <SearchBox layout={layout} state={inventory.state} onPick={pickSearch} onClear={clearSearch} active={!!searchZoneId} />
        </div>

        <div className="ml-auto flex items-center gap-3">
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

      {page === 'inventory' && (
        <main className="min-h-0 flex-1">
          <InventoryPage api={inventory} zones={layout.zones} onShowZone={showZone} lockedOperator={staffName} />
        </main>
      )}
      {page === 'users' && (
        <main className="min-h-0 flex-1">
          <UsersPage />
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
            editMode={editMode}
            editZoneId={editZoneId}
            onZoneChange={layoutEdits.update}
            highlightLot={highlightLot}
            selectedPallet={selectedPallet}
            onPalletClick={(zoneId, index) => {
              setSelectedPallet({ zoneId, index })
              setSideTab('zone')
              setPanelOpen(true)
            }}
            pins={pins}
            cameraCommand={cameraCommand}
            focusShiftPx={panelOpen && window.innerWidth >= 768 ? 200 : 0}
          />

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
            <div className="pointer-events-auto inline-block max-w-full">
              <MapLegend mode={mode} editMode={editMode} />
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
                ...(can(role, 'editLayout') ? ([['edit', 'แก้ไขผัง']] as const) : []),
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => {
                  setSideTab(key)
                  if (key === 'edit') setMode('interior')
                }}
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
          {sideTab === 'edit' ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm text-slate-700">
              <LayoutEditorPanel
                layout={layout}
                edits={layoutEdits.edits}
                zoneId={editZoneId}
                stock={zoneStock}
                onSelect={setEditZoneId}
                onUpdate={layoutEdits.update}
                onAdd={layoutEdits.add}
                onRemove={(id) => {
                  layoutEdits.remove(id)
                  if (sourceId === id) setSourceId('TENT-C')
                  if (targetId === id) setTargetId('F2-ASM')
                }}
                onReset={layoutEdits.reset}
              />
            </div>
          ) : sideTab === 'zone' ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm text-slate-700">
              {selectedPallet && (
                <div className="-mx-1 mb-4">
                  <PalletCard layout={layout} state={inventory.state} zoneId={selectedPallet.zoneId} index={selectedPallet.index} onClose={() => setSelectedPallet(null)} />
                </div>
              )}
              <ZonePanel
                layout={layout}
                zoneId={selectedZoneId}
                contents={selectedZoneId ? zoneContents(inventory.state, selectedZoneId) : null}
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
