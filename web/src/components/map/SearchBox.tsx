import { useEffect, useMemo, useRef, useState } from 'react'
import type { FactoryLayout } from '../../types/layout'
import type { Lpn, MasterData } from '../../wms/types'
import { searchStock, type StockHit } from '../mobile/stockSearch'
import { IconBox, IconClose, IconPin, IconSearch } from './icons'

const fmt = (n: number) => n.toLocaleString('th-TH')
const KIND: Record<StockHit['kind'], string> = { lpn: 'กล่อง', part: 'Part', place: 'ที่เก็บ' }

/**
 * ค้นหาของในคลังจากระบบคลัง (ชุดเดียวกับหน้ามือถือ): เลขป้าย / Part No. / ชื่อ part / รหัส UAM / ช่องเก็บ / โซน
 * เลือกแล้วผังบินไปที่โซนและไฮไลต์กล่อง (กด / เพื่อเริ่มพิมพ์)
 */
export function SearchBox({
  layout,
  lpns,
  master,
  onPick,
  onClear,
  onWake,
  active,
}: {
  layout: FactoryLayout
  lpns: Lpn[]
  master: Pick<MasterData, 'locations' | 'parts'>
  onPick: (hit: StockHit) => void
  onClear: () => void
  /** เริ่มใช้ช่องค้นหา ⇒ โหลดกล่องในคลัง (หน้าอื่นที่ไม่ใช่ผัง) */
  onWake: () => void
  /** มีผลค้นหาที่ปักหมุดอยู่ */
  active: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => searchStock(query, lpns, master, layout).slice(0, 8), [query, lpns, master, layout])
  const zoneCode = (id: string | null) => layout.zones.find((z) => z.id === id)?.code

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

  const pick = (hit: StockHit) => {
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
          onFocus={() => {
            setOpen(true)
            onWake()
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setCursor((c) => Math.min(c + 1, hits.length - 1))
            else if (e.key === 'ArrowUp') setCursor((c) => Math.max(c - 1, 0))
            else if (e.key === 'Enter' && hits[cursor]) pick(hits[cursor])
            else if (e.key === 'Escape') input.current?.blur()
            else return
            e.preventDefault()
          }}
          placeholder="ค้นหา เลขป้าย / Part No. / ชื่อ part / ช่องเก็บ / โซน"
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
          {hits.map((hit, i) => {
            const zones = new Set(hit.boxes.map((b) => b.zoneId).filter(Boolean))
            const held = hit.boxes.filter((b) => b.hold).length
            return (
              <li key={`${hit.kind}-${hit.key}`}>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(hit)}
                  onMouseEnter={() => setCursor(i)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === cursor ? 'bg-sky-50' : ''}`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">{hit.kind === 'place' ? <IconPin /> : <IconBox />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-800">
                      {hit.title} {hit.subtitle && <span className="font-normal text-slate-500">· {hit.subtitle}</span>}
                    </span>
                    <span className="block truncate text-xs text-slate-400">
                      {KIND[hit.kind]}
                      {hit.zoneId ? ` · ${zoneCode(hit.zoneId) ?? ''}` : zones.size > 1 ? ` · ${zones.size} โซน` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs">
                    {hit.qty > 0 ? (
                      <span className="font-semibold tabular-nums text-slate-700">
                        {fmt(hit.qty)} ชิ้น · {hit.boxes.length} กล่อง
                      </span>
                    ) : (
                      <span className="text-slate-400">ไม่มีของในคลัง</span>
                    )}
                    {held > 0 && <span className="block text-amber-600">รอ MI3 {held} กล่อง</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
