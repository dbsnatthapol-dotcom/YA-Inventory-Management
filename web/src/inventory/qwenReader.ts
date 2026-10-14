import { supabase } from '../lib/layoutSource'
import type { ExtractedInvoice } from './types'

/** เปิดใช้ได้เมื่อหน้าเว็บตั้งค่า Supabase ไว้ (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) */
export const qwenAvailable = supabase !== null

/** ย่อภาพจากกล้องมือถือ (มัก 4000px+) ให้เหลือด้านยาวไม่เกิน maxSide เพื่อส่งเร็วและประหยัดค่า API */
async function toJpegBase64(file: File, maxSide = 1800): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.88).split(',')[1]
}

/** ส่งภาพ invoice ไปให้ Qwen-VL อ่านผ่าน Edge Function (API key อยู่ฝั่ง server) */
export async function readInvoiceWithQwen(image: File): Promise<{ invoice: ExtractedInvoice; raw: string }> {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า Supabase สำหรับหน้าเว็บนี้')
  const imageBase64 = await toJpegBase64(image)
  const { data, error } = await supabase.functions.invoke('extract-invoice', { body: { imageBase64, mimeType: 'image/jpeg' } })
  if (error) {
    // ข้อความจาก function (เช่น Qwen ตอบผิดรูปแบบ) อยู่ใน body ของ response
    const detail = await (error as { context?: Response }).context?.json?.().catch(() => null)
    throw new Error(detail?.error ?? error.message)
  }
  if (!data?.invoice) throw new Error(data?.error ?? 'Qwen ไม่ได้ส่งรายการกลับมา')
  return data
}
