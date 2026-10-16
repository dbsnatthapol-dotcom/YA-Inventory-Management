import { useState } from 'react'
import { BRAND } from '../../data/brand'
import { errorText } from '../../wms/api'
import { planFgImport, planPartImport, type FgImport, type ImportStatus, type PartImport } from '../../wms/masterImport'
import { useWms } from '../../wms/useWms'
import { Alert, BigButton, Card, Pill, tdCls, thCls, type Tone } from '../wms/ui'

const STATUS: Record<ImportStatus, [string, Tone]> = {
  new: ['ใหม่', 'info'],
  update: ['แก้ไข', 'warn'],
  same: ['เหมือนเดิม', 'muted'],
  error: ['ผิด', 'bad'],
}

/**
 * นำเข้าจาก Excel: ดาวน์โหลดแบบฟอร์ม (มีข้อมูลปัจจุบัน) → กรอก → อัปโหลด → ตรวจทีละแถว → บันทึกเฉพาะแถวที่ถูก
 * kind = parts (รหัส UAM / ชื่อ / Model) หรือ bom (ชุดวงล้อ)
 */
export function MasterImport({ kind }: { kind: 'parts' | 'bom' }) {
  const { api, master, reload } = useWms()
  const [plan, setPlan] = useState<(PartImport | FgImport)[] | null>(null)
  const [file, setFile] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null)
  const label = kind === 'parts' ? 'Part / รหัส UAM' : 'BOM ชุดวงล้อ'

  const template = async () => {
    const x = await import('../../wms/masterExcel')
    await (kind === 'parts' ? x.downloadPartTemplate(master) : x.downloadBomTemplate(master))
  }
  const upload = async (f: File) => {
    setMsg(null)
    setFile(f.name)
    try {
      const { readSheetRows } = await import('../../wms/masterExcel')
      const rows = await readSheetRows(f)
      const p = kind === 'parts' ? planPartImport(rows, master) : planFgImport(rows, master)
      setPlan(p)
      if (!p.length) setMsg({ tone: 'warn', text: 'ไม่พบข้อมูลในไฟล์ · ใช้แบบฟอร์มที่ดาวน์โหลดจากปุ่มด้านบน (หัวตารางแถวแรก)' })
    } catch (e) {
      setPlan(null)
      setMsg({ tone: 'bad', text: `อ่านไฟล์ไม่ได้: ${errorText(e)} · รองรับ .xlsx` })
    }
  }
  const todo = (plan ?? []).filter((x) => x.status === 'new' || x.status === 'update')
  const bad = (plan ?? []).filter((x) => x.status === 'error').length
  const save = async () => {
    setBusy(true)
    let done = 0
    try {
      for (const x of todo) {
        if ('part' in x) await api.upsertPart(x.part)
        else await api.saveFg(x.fg)
        done++
      }
      await reload()
      setPlan(null)
      setMsg({ tone: 'ok', text: `บันทึก ${done} รายการแล้ว${bad ? ` · ข้าม ${bad} รายการที่ผิด (แก้ในไฟล์แล้วอัปโหลดใหม่ได้)` : ''}` })
    } catch (e) {
      await reload()
      setMsg({ tone: 'bad', text: `บันทึกได้ ${done}/${todo.length} แล้วหยุด: ${errorText(e)}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title={`นำเข้า ${label} จาก Excel`}
      eyebrow="ดาวน์โหลดแบบฟอร์ม (มีข้อมูลปัจจุบันให้แล้ว) → กรอก/แก้ → อัปโหลด → ตรวจ → บันทึก"
      action={
        <div className="flex flex-wrap gap-2">
          <BigButton tone="secondary" onClick={() => void template()}>
            ดาวน์โหลดแบบฟอร์ม
          </BigButton>
          <label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-lg px-4 text-[15px] font-semibold text-white shadow-sm hover:opacity-90" style={{ background: BRAND.primary }}>
            อัปโหลดไฟล์
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void upload(f)
                e.target.value = ''
              }}
            />
          </label>
        </div>
      }
    >
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {plan && plan.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{file}</span>
            {(['new', 'update', 'same', 'error'] as ImportStatus[]).map((s) => {
              const n = plan.filter((x) => x.status === s).length
              return n ? <Pill key={s} tone={STATUS[s][1]}>{`${STATUS[s][0]} ${n}`}</Pill> : null
            })}
            <span className="flex-1" />
            <BigButton tone="secondary" onClick={() => setPlan(null)}>
              ยกเลิก
            </BigButton>
            <BigButton disabled={busy || !todo.length} onClick={() => void save()}>
              {busy ? 'กำลังบันทึก…' : `บันทึก ${todo.length} รายการ`}
            </BigButton>
          </div>
          <div className="max-h-[50vh] overflow-auto rounded-lg ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0">
                <tr>
                  <th className={thCls}>แถว</th>
                  <th className={thCls}>สถานะ</th>
                  {kind === 'parts' ? (
                    <>
                      <th className={thCls}>Part No.</th>
                      <th className={thCls}>รหัส UAM</th>
                      <th className={thCls}>ชื่อ</th>
                      <th className={thCls}>Model</th>
                    </>
                  ) : (
                    <>
                      <th className={thCls}>ชุด</th>
                      <th className={thCls}>Model</th>
                      <th className={thCls}>BOM ต่อ 1 วง</th>
                    </>
                  )}
                  <th className={thCls}>หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {[...plan]
                  .sort((a, b) => Number(b.status === 'error') - Number(a.status === 'error'))
                  .map((x) => (
                    <tr key={'part' in x ? `p${x.row}` : `f${x.fg.code}`} className={x.status === 'same' ? 'text-slate-400' : ''}>
                      <td className={`${tdCls} font-mono text-xs`}>{'part' in x ? x.row : x.rows.join(', ')}</td>
                      <td className={tdCls}>
                        <Pill tone={STATUS[x.status][1]}>{STATUS[x.status][0]}</Pill>
                      </td>
                      {'part' in x ? (
                        <>
                          <td className={`${tdCls} font-mono font-semibold`}>{x.part.partNo}</td>
                          <td className={`${tdCls} font-mono`}>{x.part.uamCode ?? ''}</td>
                          <td className={tdCls}>{x.part.name}</td>
                          <td className={`${tdCls} text-xs`}>{x.part.models.join(', ')}</td>
                        </>
                      ) : (
                        <>
                          <td className={tdCls}>
                            <span className="font-mono font-semibold">{x.fg.code}</span> {x.fg.name}
                          </td>
                          <td className={tdCls}>{x.fg.modelCode}</td>
                          <td className={`${tdCls} font-mono text-xs`}>{x.fg.lines.map((l) => `${l.partNo}×${l.qtyPer}`).join(' · ')}</td>
                        </>
                      )}
                      <td className={`${tdCls} text-xs text-rose-700`}>{x.messages.join(' · ')}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  )
}
