import { useCallback, useEffect, useMemo, useState } from 'react'
import { errorText } from '../../wms/api'
import { zoneCodeOf } from '../../wms/locations'
import { fmt } from '../../wms/logic'
import type { Lpn } from '../../wms/types'
import { useWms } from '../../wms/useWms'
import { useIsMobile } from '../../lib/viewMode'
import { Alert, BigButton, Card, inputCls } from './ui'

const SHOW = 100
const KIND_NAME = { staging: 'จุดรับของ', hold: 'จุดตรวจ MI3', ng: 'พื้นที่ NG' } as const

/**
 * ย้ายของโดยไม่ต้องสแกน: ค้นกล่อง (เลขป้าย / Part / PL + เคส / ช่อง) → เลือกได้หลายกล่อง → เลือกช่องปลายทางจากรายการ → ยืนยัน
 * ระบบบันทึกว่าย้ายแบบ "เลือกจากรายการ" (หัวหน้าตามได้) · ช่องแนะนำตามกฎโซนตอนนี้
 */
export function MoveBoxes({ initialQuery = '', initialPlace = 'all' }: { initialQuery?: string; initialPlace?: 'all' | 'staging' }) {
  const { api, master, can } = useWms()
  const mobile = useIsMobile()
  const [lpns, setLpns] = useState<Lpn[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState(initialQuery)
  const [place, setPlace] = useState<'all' | 'staging' | 'hold'>(initialPlace)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [zone, setZone] = useState('')
  const [dest, setDest] = useState('')
  /** ช่องแนะนำของชุดที่เลือกอยู่ (key = id กล่องที่เลือก · เปลี่ยนชุดแล้วไม่โชว์ของชุดเก่า) */
  const [suggested, setSuggested] = useState<{ key: string; codes: string[] }>({ key: '', codes: [] })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null)
  const allowed = can('scan.move') || can('scan.put')

  const load = useCallback(async () => {
    try {
      setLpns(await api.activeLpns())
      setError(null)
    } catch (e) {
      setError(errorText(e))
    }
  }, [api])
  useEffect(() => {
    let alive = true
    api
      .activeLpns()
      .then((l) => alive && setLpns(l))
      .catch((e) => alive && setError(errorText(e)))
    return () => {
      alive = false
    }
  }, [api])

  const locs = useMemo(() => new Map(master.locations.map((l) => [l.code, l])), [master.locations])
  const names = useMemo(() => new Map(master.parts.map((p) => [p.partNo, `${p.name} ${p.uamCode ?? ''}`])), [master.parts])
  // จำนวนกล่องในแต่ละช่องตอนนี้
  const used = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of lpns ?? []) m.set(l.locationCode, (m.get(l.locationCode) ?? 0) + 1)
    return m
  }, [lpns])

  const found = useMemo(() => {
    const tokens = q.trim().toUpperCase().split(/\s+/).filter(Boolean)
    return (lpns ?? [])
      .filter((l) => place === 'all' || locs.get(l.locationCode)?.kind === place)
      .filter((l) => {
        if (!tokens.length) return true
        const text = [l.lpnNo, l.caseNo, l.plRef, l.grnNo, l.locationCode, ...l.items.flatMap((i) => [i.partNo, names.get(i.partNo) ?? ''])].join(' ').toUpperCase()
        return tokens.every((t) => text.includes(t))
      })
      .sort((a, b) => a.locationCode.localeCompare(b.locationCode) || (a.caseNo ?? '').localeCompare(b.caseNo ?? '', 'en', { numeric: true }) || a.lpnNo.localeCompare(b.lpnNo))
  }, [lpns, q, place, locs, names])
  const chosen = (lpns ?? []).filter((l) => picked.has(l.id))

  // ช่องแนะนำของกล่องที่เลือก (ตามกฎโซนตอนนี้)
  const chosenKey = chosen.map((l) => l.id).join(',')
  useEffect(() => {
    if (!chosenKey) return
    let alive = true
    api
      .suggestSlots(chosenKey.split(',').slice(0, 30))
      .then((s) => alive && setSuggested({ key: chosenKey, codes: [...new Set(s.map((x) => x.code).filter((c): c is string => !!c))].slice(0, 4) }))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [api, chosenKey])
  const suggest = suggested.key === chosenKey ? suggested.codes : []

  // โซนที่มีช่องเก็บ + จุดพัก/ตรวจ/NG
  const zones = useMemo(() => {
    const m = new Map<string, string>()
    for (const l of master.locations) if (l.active && !l.blocked && (l.kind === 'bin' || l.kind === 'floor') && !m.has(l.zoneId)) m.set(l.zoneId, zoneCodeOf(l.code))
    return [...m].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }))
  }, [master.locations])
  const special = master.locations.filter((l) => l.active && !l.blocked && (l.kind === 'staging' || l.kind === 'hold' || l.kind === 'ng'))
  const slots = zone ? master.locations.filter((l) => l.zoneId === zone && l.active && !l.blocked && (l.kind === 'bin' || l.kind === 'floor')).sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true })) : []
  const destLoc = locs.get(dest.trim().toUpperCase())
  const destOk = !!destLoc?.active && !destLoc.blocked
  // กล่องในพื้นที่ NG ออกไปช่องของดีได้เฉพาะ MI3 (ตรวจซ้ำแล้วผ่าน) · กติกาเดียวกับ move_lpns (0024)
  const ngOut = destOk && destLoc.kind !== 'ng' && !can('scan.qi') ? chosen.filter((l) => locs.get(l.locationCode)?.kind === 'ng') : []

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const move = async () => {
    const to = dest.trim().toUpperCase()
    if (!window.confirm(`ย้าย ${chosen.length} กล่องไป ${to}?`)) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await api.moveLpns(chosen.map((l) => l.id), to)
      setMsg({ tone: 'ok', text: `ย้ายเข้า ${to} แล้ว ${r.moved} กล่อง${r.same ? ` · อยู่ที่ ${to} อยู่แล้ว ${r.same} กล่อง` : ''}` })
      setPicked(new Set())
      setDest('')
      await load()
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  if (!allowed) return <Alert tone="warn">บัญชีนี้ยังไม่มีสิทธิ์ย้าย/จัดเก็บ · ให้ผู้ดูแลระบบเปิดสิทธิ์ "ย้ายที่" หรือ "จัดเก็บเข้าที่"</Alert>

  const slotBtn = (code: string, label = code) => {
    const n = used.get(code) ?? 0
    return (
      <button
        key={code}
        onClick={() => setDest(code)}
        aria-pressed={dest === code}
        className={`flex min-h-[48px] flex-col items-start justify-center rounded-lg px-3 py-1.5 text-left ring-1 transition ${dest === code ? 'bg-sky-600 text-white ring-sky-700' : n ? 'bg-amber-50 ring-amber-200 hover:bg-amber-100' : 'bg-white ring-slate-200 hover:bg-slate-50'}`}
      >
        <span className="font-mono text-sm font-semibold">{label}</span>
        <span className={`text-[11px] ${dest === code ? 'text-sky-100' : 'text-slate-500'}`}>{n ? `มี ${n} กล่อง` : 'ว่าง'}</span>
      </button>
    )
  }

  return (
    <div className={`flex flex-col gap-3 ${chosen.length ? 'pb-28' : ''}`}>
      <Card eyebrow="ไม่ต้องสแกน QR · เลือกหลายกล่องแล้วย้ายทีเดียว" title="ย้าย / จัดเก็บจากรายการ">
        <input
          className={`${inputCls} font-mono text-base`}
          placeholder="ค้น: เลขป้าย / Part / เลข PL + เคส / ช่อง"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
          aria-label="ค้นกล่องที่จะย้าย"
        />
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['all', 'ทุกที่'],
              ['staging', 'ที่จุดรับของ'],
              ['hold', 'ที่จุดตรวจ MI3'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} onClick={() => setPlace(k)} aria-pressed={place === k} className={`min-h-[44px] rounded-full px-4 text-sm font-semibold ring-1 ${place === k ? 'bg-sky-600 text-white ring-sky-700' : 'bg-white text-slate-700 ring-slate-300'}`}>
              {label}
            </button>
          ))}
          <BigButton tone="secondary" disabled={busy} onClick={() => void load()}>
            ↻
          </BigButton>
        </div>
        <p className="text-xs text-slate-500">
          พิมพ์หลายคำได้ เช่น "4957872317 P-12" = PL นั้น เคส P-12 · {lpns ? `พบ ${fmt(found.length)} จาก ${fmt(lpns.length)} กล่อง` : 'กำลังโหลด…'}
        </p>
      </Card>

      {error && <Alert tone="bad">โหลดกล่องไม่สำเร็จ: {error}</Alert>}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {lpns && (
        <Card
          title={`กล่อง (${fmt(found.length)})`}
          action={
            found.length > 0 && (
              <BigButton tone="secondary" onClick={() => setPicked((s) => (found.slice(0, SHOW).every((l) => s.has(l.id)) ? new Set() : new Set([...s, ...found.slice(0, SHOW).map((l) => l.id)])))}>
                {found.slice(0, SHOW).every((l) => picked.has(l.id)) ? 'ล้างที่เลือก' : `เลือกทั้งหมด (${Math.min(found.length, SHOW)})`}
              </BigButton>
            )
          }
        >
          {found.length === 0 && <p className="py-4 text-center text-sm text-slate-500">ไม่พบกล่อง</p>}
          <ul className="flex flex-col gap-1.5">
            {found.slice(0, SHOW).map((l) => {
              const qty = l.items.reduce((s, i) => s + i.qty, 0)
              const where = locs.get(l.locationCode)?.kind
              return (
                <li key={l.id}>
                  <label className={`flex min-h-[56px] cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ring-1 ${picked.has(l.id) ? 'bg-sky-50 ring-sky-400' : 'ring-slate-200 hover:bg-slate-50'}`}>
                    <input type="checkbox" className="h-6 w-6 shrink-0" checked={picked.has(l.id)} onChange={() => toggle(l.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-sm font-semibold text-slate-800">
                        {l.caseNo ? `เคส ${l.caseNo} · ` : ''}
                        {l.items.length === 1 ? l.items[0].partNo : `${l.items.length} part`}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {l.lpnNo}
                        {l.plRef ? ` · PL ${l.plRef}` : ''}
                        {l.items.length > 1 ? ` · ${l.items.map((i) => i.partNo).join(', ')}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-sm font-semibold">{l.locationCode}</span>
                      <span className="block text-xs text-slate-500">
                        {fmt(qty)} ชิ้น{l.hold ? ' · รอ MI3' : where && where in KIND_NAME ? ` · ${KIND_NAME[where as keyof typeof KIND_NAME]}` : ''}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          {found.length > SHOW && <p className="text-xs text-slate-500">แสดง {SHOW} กล่องแรก · พิมพ์คำค้นเพิ่มเพื่อให้แคบลง</p>}
        </Card>
      )}

      {chosen.length > 0 && (
        <Card title={`ปลายทางของ ${chosen.length} กล่อง`} eyebrow="แตะเลือกช่อง หรือพิมพ์รหัสช่อง · ระบบบันทึกว่าย้ายจากรายการ (ไม่ได้สแกน)">
          {suggest.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-500">แนะนำตามกฎโซนตอนนี้ (ช่องว่าง)</span>
              <div className="flex flex-wrap gap-2">{suggest.map((c) => slotBtn(c))}</div>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <select className={inputCls} value={zone} onChange={(e) => setZone(e.target.value)} aria-label="โซนปลายทาง">
              <option value="">— เลือกโซน —</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.label}
                </option>
              ))}
            </select>
            <input
              className={`${inputCls} font-mono uppercase`}
              list="move-slots"
              placeholder="หรือพิมพ์รหัสช่อง เช่น TENT-D-01"
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              aria-label="ช่องปลายทาง"
            />
          </div>
          {slots.length > 0 && <div className="grid max-h-[50vh] grid-cols-2 gap-1.5 overflow-y-auto sm:grid-cols-4 lg:grid-cols-6">{slots.map((l) => slotBtn(l.code))}</div>}
          {!zone && special.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-500">จุดพัก / ตรวจ / NG</span>
              <div className="flex flex-wrap gap-2">{special.map((l) => slotBtn(l.code, `${l.code} · ${KIND_NAME[l.kind as keyof typeof KIND_NAME]}`))}</div>
            </div>
          )}
          <datalist id="move-slots">
            {master.locations
              .filter((l) => l.active && !l.blocked)
              .map((l) => (
                <option key={l.code} value={l.code} />
              ))}
          </datalist>
          {dest && !destOk && <Alert tone="warn">ไม่พบช่อง {dest.trim().toUpperCase()} หรือช่องนี้ปิดใช้อยู่</Alert>}
          {ngOut.length > 0 && (
            <Alert tone="warn">
              กล่อง NG {ngOut.map((l) => l.lpnNo).join(', ')} ย้ายออกไปช่องของดีได้เฉพาะ MI3 (ตรวจซ้ำแล้วผ่าน) · เอาออกจากที่เลือก หรือส่งคืน/ตัดทิ้งด้วยใบเบิก NG
            </Alert>
          )}
        </Card>
      )}

      {chosen.length > 0 && (
        <div className={`sticky bottom-2 z-20 flex flex-wrap items-center justify-between rounded-xl border-2 border-sky-700 bg-white shadow-lg ${mobile ? 'gap-2 px-3 py-2' : 'gap-3 px-4 py-3'}`}>
          <div className="text-sm">
            <strong className="text-base">เลือก {chosen.length} กล่อง</strong>
            <div className="text-xs text-slate-500">
              {fmt(chosen.reduce((s, l) => s + l.items.reduce((t, i) => t + i.qty, 0), 0))} ชิ้น · จาก {[...new Set(chosen.map((l) => l.locationCode))].slice(0, 3).join(', ')}
            </div>
          </div>
          <div className={`flex gap-2 ${mobile ? 'w-full' : ''}`}>
            <BigButton tone="secondary" onClick={() => setPicked(new Set())}>
              ล้าง
            </BigButton>
            <BigButton disabled={busy || !destOk || ngOut.length > 0} onClick={() => void move()} className={`!py-3 text-base ${mobile ? 'flex-1' : ''}`}>
              {!destOk ? 'เลือกช่องปลายทาง' : ngOut.length ? 'มีกล่อง NG ในที่เลือก' : `ย้ายไป ${dest.trim().toUpperCase()}`}
            </BigButton>
          </div>
        </div>
      )}
    </div>
  )
}
