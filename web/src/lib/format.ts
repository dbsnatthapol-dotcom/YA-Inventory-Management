export const fmt = (n: number) => (n === 0 ? '–' : n.toLocaleString('th-TH'))
export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export const inputBase = 'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm tabular-nums focus:border-sky-500 focus:outline-none'
export const inputCls = `w-full ${inputBase}`
