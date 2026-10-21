import { describe, expect, it } from 'vitest'
import { fetchAll } from './supabaseApi'

// แหล่งข้อมูลจำลองที่ตัดผลที่ 1,000 แถวเหมือน PostgREST (Max rows ค่าเริ่มต้น)
const source = (total: number) => {
  const calls: [number, number][] = []
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }))
  const page = (from: number, to: number) => {
    calls.push([from, to])
    return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null })
  }
  return { calls, page }
}

describe('reading every row past the 1,000-row API cap', () => {
  it('pages until a short page and keeps every row once', async () => {
    const s = source(2345)
    const rows = await fetchAll(s.page)
    expect(rows.length).toBe(2345)
    expect(new Set(rows.map((r) => r.id)).size).toBe(2345)
    expect(s.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('asks once more when the last page is exactly full, and once for small tables', async () => {
    const full = source(1000)
    expect((await fetchAll(full.page)).length).toBe(1000)
    expect(full.calls.length).toBe(2)
    const small = source(164)
    expect((await fetchAll(small.page)).length).toBe(164)
    expect(small.calls.length).toBe(1)
  })

  it('stops on an error with a readable message', async () => {
    await expect(fetchAll(() => Promise.resolve({ data: null, error: { message: 'boom' } }))).rejects.toThrow('boom')
  })
})
