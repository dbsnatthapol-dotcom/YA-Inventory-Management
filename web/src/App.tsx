import { useEffect, useMemo, useState } from 'react'
import { FactoryScene, type ViewMode } from './components/FactoryScene'
import { InventoryPage } from './components/inventory/InventoryPage'
import { RoutePanel } from './components/RoutePanel'
import logoUrl from './assets/uam-logo.png'
import { BRAND } from './data/brand'
import { sampleLayout } from './data/factoryLayout'
import { ZONE_STYLE } from './data/zoneStyle'
import { loadLayout, type LoadedLayout } from './lib/layoutSource'
import { findRoute, type RouteOptions } from './lib/pathfinding'
import { useInventory } from './inventory/useInventory'
import { zoneContents, zoneTotals } from './inventory/reports'
import { ZonePanel } from './components/ZonePanel'
import type { Zone } from './types/layout'

export default function App() {
  const [loaded, setLoaded] = useState<LoadedLayout>({ layout: sampleLayout, source: 'sample' })
  const layout = loaded.layout
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
  const [page, setPage] = useState<'map' | 'inventory'>('map')
  const inventory = useInventory()

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

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 text-white shadow" style={{ background: BRAND.primary }}>
        <div className="flex items-center gap-3">
          <BrandMark />
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-wide">{layout.siteName.toUpperCase()}</div>
            <div className="text-[11px] text-white/70">ระบบบริหารคลังสินค้า · ผังโรงงาน 3 มิติ</div>
          </div>
        </div>

        <nav className="flex rounded-md bg-white/10 p-0.5 text-sm" aria-label="เมนูหลัก">
          {(
            [
              ['map', 'ผังโรงงาน 3D'],
              ['inventory', 'รับเข้า & สต็อก'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setPage(value)}
              className={`rounded px-3 py-1 transition ${page === value ? 'bg-white font-semibold' : 'text-white/80 hover:bg-white/10'}`}
              style={page === value ? { color: BRAND.primary } : undefined}
            >
              {label}
            </button>
          ))}
        </nav>

        {page === 'map' && (
          <>
        <div className="flex rounded-md bg-white/10 p-0.5 text-xs">
          {(
            [
              ['exterior', 'ภายนอก (สมจริง)'],
              ['interior', 'ภายใน (ผังชั้น)'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className={`rounded px-3 py-1 transition ${mode === value ? 'bg-white font-semibold' : 'text-white/80 hover:bg-white/10'}`}
              style={mode === value ? { color: BRAND.primary } : undefined}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-white/90">
          {mode === 'interior' && (
            <>
              {buildingFloors.map((f) => (
                <label key={f.id} className="flex items-center gap-1">
                  <input type="checkbox" checked={!hiddenFloors.has(f.id)} onChange={() => toggleFloor(f.id)} />
                  {f.name.replace('อาคาร A ', '')}
                </label>
              ))}
              <label className="flex items-center gap-1">
                แยกชั้น
                <input type="range" min={1} max={5} step={0.5} value={explode} onChange={(e) => setExplode(Number(e.target.value))} />
              </label>
            </>
          )}
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={topView} onChange={(e) => setTopView(e.target.checked)} />
            มุมมองด้านบน
          </label>
          <label className="flex items-center gap-1" title="ถนน ต้นไม้ และพื้นที่รอบโรงงาน">
            <input type="checkbox" checked={showSurroundings} onChange={(e) => setShowSurroundings(e.target.checked)} />
            แสดงรอบโรงงาน
          </label>
        </div>
          </>
        )}

        <span className="ml-auto rounded bg-white/10 px-2 py-0.5 text-[11px] text-white/80">
          ข้อมูล: {loaded.source === 'supabase' ? 'Supabase' : 'ผังตัวอย่าง'}
        </span>
      </header>

      {page === 'inventory' && (
        <main className="min-h-0 flex-1">
          <InventoryPage api={inventory} zones={layout.zones} onShowZone={showZone} />
        </main>
      )}
      {/* ซ่อนผัง 3D แทนการ unmount เพื่อคงมุมกล้องและไม่ต้องสร้างฉากใหม่ */}
      <main className={`min-h-0 flex-1 flex-col md:flex-row ${page === 'map' ? 'flex' : 'hidden'}`}>
        <div className="relative min-h-[50vh] flex-1">
          <FactoryScene
            layout={layout}
            mode={mode}
            explode={explode}
            hiddenFloors={hiddenFloors}
            selectedZoneIds={[sourceId, targetId, ...(selectedZoneId ? [selectedZoneId] : [])]}
            route={route}
            onZoneClick={handleZoneClick}
            onBuildingClick={() => setMode('interior')}
            topView={topView}
            active={page === 'map'}
            showSurroundings={showSurroundings}
            zoneStock={zoneStock}
          />
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-white/90 px-3 py-1.5 text-[11px] text-slate-700 shadow">
            {mode === 'exterior' ? (
              <span>คลิกอาคาร A เพื่อดูผังภายใน · คลิกเต็นท์เพื่อเลือกเป็นจุดเก็บต้นทาง</span>
            ) : (
              Object.entries(ZONE_STYLE).map(([kind, s]) => (
                <span key={kind} className="flex items-center gap-1">
                  <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                  {s.label}
                </span>
              ))
            )}
          </div>
        </div>
        <div className="flex w-full flex-col border-l border-slate-200 bg-white md:w-96">
          <div className="flex gap-1 border-b border-slate-200 p-2 text-sm">
            {(
              [
                ['zone', 'ของในโซน'],
                ['route', 'ระยะเดินส่ง Part'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSideTab(key)}
                className={`flex-1 rounded-md px-3 py-1.5 transition ${sideTab === key ? 'font-semibold text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                style={sideTab === key ? { background: BRAND.primary } : undefined}
              >
                {label}
              </button>
            ))}
          </div>
          {sideTab === 'zone' ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm text-slate-700">
              <ZonePanel
                layout={layout}
                zoneId={selectedZoneId}
                contents={selectedZoneId ? zoneContents(inventory.state, selectedZoneId) : null}
                allZones={zoneStock}
                onSelectZone={(id) => {
                  setSelectedZoneId(id)
                  const zone = layout.zones.find((z) => z.id === id)
                  if (zone) setMode(layout.floors.find((f) => f.id === zone.floorId)?.area === 'building' ? 'interior' : 'exterior')
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
        </div>
      </main>
    </div>
  )
}

/** โลโก้ UAM บนพื้นขาว เพื่อให้สีฟ้าของโลโก้เด่นบนแถบสีน้ำเงินเข้ม */
function BrandMark() {
  return (
    <span className="flex h-10 w-12 items-center justify-center rounded-md bg-white p-1 shadow-sm">
      <img src={logoUrl} alt={BRAND.shortName} className="h-full w-full object-contain" />
    </span>
  )
}
