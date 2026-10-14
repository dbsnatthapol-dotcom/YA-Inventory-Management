import { useEffect, useMemo, useState } from 'react'
import { FactoryScene, type ViewMode } from './components/FactoryScene'
import { RoutePanel } from './components/RoutePanel'
import { BRAND } from './data/brand'
import { sampleLayout } from './data/factoryLayout'
import { ZONE_STYLE } from './data/zoneStyle'
import { loadLayout, type LoadedLayout } from './lib/layoutSource'
import { findRoute, type RouteOptions } from './lib/pathfinding'
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

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 text-white shadow" style={{ background: BRAND.navy }}>
        <div className="flex items-center gap-3">
          <BrandMark />
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-wide">{layout.siteName.toUpperCase()}</div>
            <div className="text-[11px] text-white/70">ระบบบริหารคลังสินค้า · ผังโรงงาน 3 มิติ</div>
          </div>
        </div>

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
              style={mode === value ? { color: BRAND.navy } : undefined}
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
        </div>

        <span className="ml-auto rounded bg-white/10 px-2 py-0.5 text-[11px] text-white/80">
          ข้อมูล: {loaded.source === 'supabase' ? 'Supabase' : 'ผังตัวอย่าง'}
        </span>
      </header>

      <main className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-[50vh] flex-1">
          <FactoryScene
            layout={layout}
            mode={mode}
            explode={explode}
            hiddenFloors={hiddenFloors}
            selectedZoneIds={[sourceId, targetId]}
            route={route}
            onZoneClick={handleZoneClick}
            onBuildingClick={() => setMode('interior')}
            topView={topView}
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
      </main>
    </div>
  )
}

/** โลโก้ย่อ (ใกล้เคียง) — แทนที่ด้วยไฟล์โลโก้ทางการได้ภายหลัง */
function BrandMark() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-label={BRAND.shortName}>
      <rect x="1" y="1" width="32" height="32" rx="5" fill="#ffffff" />
      <rect x="4" y="4" width="26" height="26" rx="3" fill={BRAND.navy} />
      <path d="M11 9v9a6 6 0 0 0 12 0V9" fill="none" stroke="#ffffff" strokeWidth="3.6" />
    </svg>
  )
}
