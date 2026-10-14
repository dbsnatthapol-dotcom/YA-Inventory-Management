import { useEffect, useMemo, useState } from 'react'
import { FactoryScene } from './components/FactoryScene'
import { RoutePanel } from './components/RoutePanel'
import { sampleLayout } from './data/factoryLayout'
import { ZONE_STYLE } from './data/zoneStyle'
import { loadLayout, type LoadedLayout } from './lib/layoutSource'
import { findRoute, type RouteOptions } from './lib/pathfinding'
import type { Zone } from './types/layout'

export default function App() {
  const [loaded, setLoaded] = useState<LoadedLayout>({ layout: sampleLayout, source: 'sample' })
  const layout = loaded.layout
  const [sourceId, setSourceId] = useState('F1-RK-A')
  const [targetId, setTargetId] = useState('F3-ASM')
  const [options, setOptions] = useState<Required<Pick<RouteOptions, 'optimize' | 'avoid'>>>({
    optimize: 'time',
    avoid: [],
  })
  const [tripsPerDay, setTripsPerDay] = useState(40)
  const [explode, setExplode] = useState(2.5)
  const [hiddenFloors, setHiddenFloors] = useState<Set<string>>(new Set())

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

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-800 bg-slate-950 px-4 py-2">
        <h1 className="text-lg font-bold text-sky-300">{layout.siteName} · Inventory 3D</h1>
        <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
          ข้อมูล: {loaded.source === 'supabase' ? 'Supabase' : 'ผังตัวอย่าง'}
        </span>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {layout.floors.map((f) => (
            <label key={f.id} className="flex items-center gap-1">
              <input type="checkbox" checked={!hiddenFloors.has(f.id)} onChange={() => toggleFloor(f.id)} />
              {f.name}
            </label>
          ))}
          <label className="flex items-center gap-1">
            แยกชั้น
            <input type="range" min={1} max={5} step={0.5} value={explode} onChange={(e) => setExplode(Number(e.target.value))} />
          </label>
        </div>
        <div className="ml-auto flex flex-wrap gap-2 text-[11px]">
          {Object.entries(ZONE_STYLE).map(([kind, s]) => (
            <span key={kind} className="flex items-center gap-1">
              <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="min-h-[50vh] flex-1">
          <FactoryScene
            layout={layout}
            explode={explode}
            hiddenFloors={hiddenFloors}
            selectedZoneIds={[sourceId, targetId]}
            route={route}
            onZoneClick={handleZoneClick}
          />
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
