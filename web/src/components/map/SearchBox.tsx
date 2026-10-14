import { useEffect, useMemo, useRef, useState } from 'react'
import { modelColor } from '../../data/modelColors'
import type { InventoryState } from '../../inventory/types'
import { searchMap, type SearchHit } from '../../lib/search'
import type { FactoryLayout } from '../../types/layout'
import { IconClose, IconPin, IconSearch } from './icons'

const fmt = (n: number) => n.toLocaleString('th-TH')

/** ช่องค้นหา part / lot / invoice / โซน — เลือกแล้วผังบินไปที่ตำแหน่ง (กด / เพื่อเริ่มพิมพ์) */
export function SearchBox({
  layout,
  state,
  onPick,
  onClear,
  active,
}: {
  layout: FactoryLayout
  state: InventoryState
  onPick: (hit: SearchHit) => void
  onClear: () => void
  /** มีผลค้นหาที่ปักหมุดอยู่ */
  active: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => searchMap(query, layout, state), [query, layout, state])
  const floorName = (id: string | undefined) => layout.floors.find((f) => f.id === id)?.name ?? ''

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement
      if (e.key === '/' && !typing) {
        e.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pick = (hit: SearchHit) => {
    onPick(hit)
    setOpen(false)
    input.current?.blur()
  }

  return (
    <div className="relative w-full max-w-xl">
      <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-slate-500 ring-1 ring-transparent focus-within:bg-white focus-within:ring-sky-400">
        <IconSearch size={16} />
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setCursor(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setCursor((c) => Math.min(c + 1, hits.length - 1))
            else if (e.key === 'ArrowUp') setCursor((c) => Math.max(c - 1, 0))
            else if (e.key === 'Enter' && hits[cursor]) pick(hits[cursor])
            else if (e.key === 'Escape') input.current?.blur()
            else return
            e.preventDefault()
          }}
          placeholder="ค้นหา Part No. / ชื่อ part / Invoice / Lot / โซน"
          className="w-full bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
          aria-label="ค้นหาบนผัง"
        />
        {query || active ? (
          <button
            className="rounded p-0.5 hover:bg-slate-200"
            title="ล้างการค้นหา"
            onClick={() => {
              setQuery('')
              onClear()
            }}
          >
            <IconClose size={14} />
          </button>
        ) : (
          <kbd className="hidden rounded border border-slate-300 bg-white px-1.5 text-[10px] text-slate-400 sm:block">/</kbd>
        )}
      </div>

      {open && query.trim().length >= 2 && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl bg-white py-1 text-sm shadow-xl ring-1 ring-slate-200">
          {hits.length === 0 && <li className="px-3 py-2 text-slate-400">ไม่พบ "{query}"</li>}
          {hits.map((hit, i) => (
            <li key={hit.kind === 'zone' ? hit.zone.id : hit.lot.id}>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(hit)}
                onMouseEnter={() => setCursor(i)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === cursor ? 'bg-sky-50' : ''}`}
              >
                {hit.kind === 'zone' ? (
                  <>
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">
                      <IconPin />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-slate-800">
                        {hit.zone.code} <span className="font-normal text-slate-500">· {hit.zone.name}</span>
                      </span>
                      <span className="block text-xs text-slate-400">{floorName(hit.zone.floorId)}</span>
                    </span>
                    <span className="text-xs text-slate-400">โซน</span>
                  </>
                ) : (
                  <>
                    <span className="h-7 w-7 shrink-0 rounded-md" style={{ background: modelColor(hit.lot.model) }} title={hit.lot.model} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-slate-800">
                        {hit.lot.partNo} <span className="font-normal text-slate-500">· {hit.part?.description ?? ''}</span>
                      </span>
                      <span className="block truncate text-xs text-slate-400">
                        {hit.lot.model} · {hit.zone?.code ?? hit.lot.zoneId} · {hit.lot.invoiceNo}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-xs">
                      {hit.boi > 0 ? <span className="font-semibold tabular-nums text-slate-700">{fmt(hit.boi)} ชิ้น</span> : <span className="text-slate-400">ไม่มีบนชั้นวาง</span>}
                      {hit.pendingQc > 0 && <span className="block text-amber-600">รอคัด {fmt(hit.pendingQc)}</span>}
                    </span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
