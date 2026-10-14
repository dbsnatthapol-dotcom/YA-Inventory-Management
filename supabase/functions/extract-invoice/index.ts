// Supabase Edge Function: อ่านภาพ invoice ด้วย Qwen-VL แล้วคืนรายการในรูปแบบ ExtractedInvoice
// ⚠️ ยังไม่ได้ทดสอบกับ API จริง — ต้องตั้ง secret ก่อน:
//   supabase secrets set QWEN_API_KEY=... [QWEN_MODEL=qwen-vl-max] [QWEN_BASE_URL=...]
// API key อยู่ฝั่ง server เท่านั้น ห้ามใส่ไว้ในโค้ดหน้าเว็บ
//
// เรียกจากหน้าเว็บ: supabase.functions.invoke('extract-invoice', { body: { imageBase64, mimeType } })

const BASE_URL = Deno.env.get('QWEN_BASE_URL') ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
const MODEL = Deno.env.get('QWEN_MODEL') ?? 'qwen-vl-max'

const PROMPT = `You read supplier delivery invoices for an auto-parts warehouse.
Return ONLY a JSON object, no prose, with this shape:
{"invoiceNo": string, "invoiceDate": "YYYY-MM-DD", "supplier": string, "model": string,
 "lines": [{"partNo": string, "description": string, "qty": number}]}
Copy part numbers exactly as printed (keep slashes and suffix letters). qty is a whole number of pieces.
If a field is unreadable use an empty string, never guess.`

interface Line {
  partNo: string
  description: string
  qty: number
}

function parseInvoice(text: string) {
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  const raw = JSON.parse(json)
  if (!Array.isArray(raw.lines)) throw new Error('Model response has no lines array')
  const lines: Line[] = raw.lines.map((l: Record<string, unknown>) => ({
    partNo: String(l.partNo ?? '').trim(),
    description: String(l.description ?? '').trim(),
    qty: Math.max(0, Math.round(Number(l.qty) || 0)),
  }))
  return {
    invoiceNo: String(raw.invoiceNo ?? ''),
    invoiceDate: String(raw.invoiceDate ?? ''),
    supplier: String(raw.supplier ?? ''),
    model: String(raw.model ?? ''),
    lines,
    provider: 'qwen' as const,
  }
}

// หน้าเว็บเรียกจากโดเมนอื่น จึงต้องตอบ CORS (รวม preflight OPTIONS)
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const apiKey = Deno.env.get('QWEN_API_KEY')
  if (!apiKey) return json({ error: 'QWEN_API_KEY is not set on the server' }, 500)

  const { imageBase64, mimeType = 'image/jpeg' } = await req.json()
  if (!imageBase64) return json({ error: 'imageBase64 is required' }, 400)

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    }),
  })
  if (!res.ok) return json({ error: `Qwen API ${res.status}: ${await res.text()}` }, 502)

  const data = await res.json()
  const text: string = data.choices?.[0]?.message?.content ?? ''
  try {
    // ส่งข้อความดิบกลับไปด้วย เพื่อเก็บใน inbound_receipts.extraction เป็นหลักฐาน
    return json({ invoice: parseInvoice(text), raw: text })
  } catch (e) {
    return json({ error: `อ่านผลจาก AI ไม่ได้: ${(e as Error).message}`, raw: text }, 422)
  }
})
