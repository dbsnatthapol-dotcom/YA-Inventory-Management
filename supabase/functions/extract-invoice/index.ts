// Supabase Edge Function: อ่านภาพเอกสารรับของ (Invoice / Packing List) ด้วย Qwen-VL
// เรียกได้เฉพาะพนักงานที่ login แล้ว · ต้องตั้ง secret ก่อน:
//   supabase secrets set QWEN_API_KEY=... [QWEN_MODEL=qwen3-vl-plus] [QWEN_BASE_URL=...]
// ชื่อรุ่นโมเดลต่างกันตามภูมิภาค/บัญชี และรุ่นเก่าถูกปลดได้ — ถ้ารุ่นแรกไม่มี จะลองรุ่นถัดไปเอง
// API key อยู่ฝั่ง server เท่านั้น ห้ามใส่ไว้ในโค้ดหน้าเว็บ
//
// เรียกจากหน้าเว็บ: supabase.functions.invoke('extract-invoice', { body: { imageBase64, mimeType, docType } })
//   docType = 'invoice' (ค่าเริ่มต้น) | 'packing_list'
//   คืน { document, raw } และ { invoice } (รูปแบบเดิม ให้หน้า "รับเข้า & สต็อก" เดิมใช้ต่อได้)

import { CORS, json, staffCaller } from '../_shared/staff.ts'

const BASE_URL = Deno.env.get('QWEN_BASE_URL') ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
const MODELS = [...new Set([Deno.env.get('QWEN_MODEL'), 'qwen3-vl-plus', 'qwen-vl-max', 'qwen-vl-max-latest', 'qwen-vl-plus', 'qwen3-vl-flash'])].filter(
  (m): m is string => !!m,
)

const RULES = `Copy part numbers exactly as printed (keep slashes and suffix letters such as /A, /B).
Read each row across: the quantity MUST come from the same printed row as the part number, even if the photo is tilted.
qty is a whole number. If a field is unreadable use an empty string, never guess. Return ONLY JSON, no prose.`

const PROMPTS = {
  invoice: `You read a customer/supplier INVOICE for an auto-parts warehouse.
Return {"invoiceNo": string, "docDate": "YYYY-MM-DD", "poNo": string, "movementType": string, "supplier": string,
 "lines": [{"lineNo": number, "partNo": string, "description": string, "qty": number}]}
lineNo is the SL No printed on the row. ${RULES}`,
  packing_list: `You read a PACKING LIST delivered with a truck to an auto-parts warehouse.
Return {"refDoc": string, "soNo": string, "packages": string, "title": string,
 "lines": [{"caseNo": string, "partNo": string, "description": string, "qty": number, "invoiceLineNo": number | null}]}
refDoc is "REF. Document No.", soNo is "So.", packages is the packing type / package range (e.g. "F28-F40"),
title is the heading line (e.g. "TWIN 36 SET (72 Wheels)"), qty is "Actual Quantity", invoiceLineNo is "No on Invoice".
caseNo is the case / pallet / box / package number the row is packed in (a column such as "Case No.", "C/No.", "Pallet No.", "Box No." or "Package No.", e.g. "F28");
when rows are grouped under one case heading or the case cell is merged across rows, repeat that number on every row of the group;
use "" when the document shows no case for the row. ${RULES}`,
}

const s = (v: unknown) => String(v ?? '').trim()
const n = (v: unknown) => Math.max(0, Math.round(Number(v) || 0))

function parse(text: string, docType: 'invoice' | 'packing_list') {
  const raw = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
  if (!Array.isArray(raw.lines)) throw new Error('Model response has no lines array')
  const rows = raw.lines as Record<string, unknown>[]
  if (docType === 'packing_list') {
    return {
      refDoc: s(raw.refDoc),
      soNo: s(raw.soNo),
      packages: s(raw.packages),
      title: s(raw.title),
      lines: rows.map((l) => ({ caseNo: s(l.caseNo), partNo: s(l.partNo), description: s(l.description), qty: n(l.qty), invoiceLineNo: l.invoiceLineNo == null ? null : n(l.invoiceLineNo) })),
    }
  }
  return {
    invoiceNo: s(raw.invoiceNo),
    docDate: s(raw.docDate ?? raw.invoiceDate),
    poNo: s(raw.poNo),
    movementType: s(raw.movementType),
    supplier: s(raw.supplier),
    lines: rows.map((l, i) => ({ lineNo: n(l.lineNo) || i + 1, partNo: s(l.partNo), description: s(l.description), qty: n(l.qty) })),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  // เฉพาะพนักงานที่ login แล้ว — กันคนนอกใช้เครดิต Qwen ด้วย anon key
  if (!(await staffCaller(req))) return json({ error: 'ต้องเข้าสู่ระบบด้วยบัญชีพนักงานก่อน' }, 401)
  const apiKey = Deno.env.get('QWEN_API_KEY')
  if (!apiKey) return json({ error: 'ยังไม่ได้ตั้งค่า QWEN_API_KEY ใน Supabase · กรอกข้อมูลเองไปก่อน' }, 500)

  const { imageBase64, mimeType = 'image/jpeg', docType: requested } = await req.json()
  if (!imageBase64) return json({ error: 'imageBase64 is required' }, 400)
  const docType: 'invoice' | 'packing_list' = requested === 'packing_list' ? 'packing_list' : 'invoice'

  const content = [
    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
    { type: 'text', text: PROMPTS[docType] },
  ]
  const call = async (model: string) => {
    const r = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'user', content }] }),
    })
    const body = await r.text()
    return { model, ok: r.ok, status: r.status, body, missing: !r.ok && (r.status === 404 || body.includes('model_not_found')) }
  }

  // ลองรุ่นที่ตั้งไว้ตามลำดับ ถ้าไม่มีสักรุ่น ถาม API ว่ามีรุ่นอ่านภาพ (vl) อะไรให้ใช้บ้าง
  let res = await call(MODELS[0])
  for (const m of MODELS.slice(1)) {
    if (!res.missing) break
    res = await call(m)
  }
  if (res.missing) {
    const list = await fetch(`${BASE_URL}/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .catch(() => ({ data: [] }))
    const vl = ((list.data ?? []) as { id: string }[]).map((m) => m.id).filter((id) => id.includes('vl') && !MODELS.includes(id))
    for (const m of vl.slice(0, 3)) {
      res = await call(m)
      if (!res.missing) break
    }
    if (res.missing)
      return json({ error: `ไม่พบรุ่นโมเดลอ่านภาพในบัญชี Qwen นี้ (ลองแล้ว: ${[...MODELS, ...vl.slice(0, 3)].join(', ')}) · ตรวจ QWEN_BASE_URL ให้ตรงภูมิภาคของ key` }, 502)
  }
  console.log(`extract-invoice model=${res.model} status=${res.status}`)
  if (!res.ok) return json({ error: `Qwen API ${res.status} (${res.model}): ${res.body.slice(0, 300)}` }, 502)

  const data = JSON.parse(res.body)
  const text: string = data.choices?.[0]?.message?.content ?? ''
  try {
    const document = parse(text, docType)
    // รูปแบบเดิมสำหรับหน้า "รับเข้า & สต็อก" (ตัวอย่างเดิม)
    const invoice =
      docType === 'invoice' && 'invoiceNo' in document
        ? { invoiceNo: document.invoiceNo, invoiceDate: document.docDate, supplier: document.supplier, model: '', lines: document.lines, provider: 'qwen' as const }
        : undefined
    return json({ document, invoice, raw: text, model: res.model })
  } catch (e) {
    return json({ error: `อ่านผลจาก AI ไม่ได้: ${(e as Error).message}`, raw: text }, 422)
  }
})
