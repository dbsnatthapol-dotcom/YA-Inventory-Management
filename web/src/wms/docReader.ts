import { supabase } from '../lib/layoutSource'

/** ผลอ่านเอกสารด้วย AI (Qwen-VL ผ่าน Edge Function extract-invoice — API key อยู่ฝั่ง server) */
export interface ReadInvoice {
  invoiceNo: string
  docDate: string
  poNo: string
  movementType: string
  lines: { lineNo: number; partNo: string; description: string; qty: number }[]
}
export interface ReadPackingList {
  refDoc: string
  soNo: string
  packages: string
  title: string
  lines: { partNo: string; description: string; qty: number; invoiceLineNo: number | null }[]
}

export const aiReaderAvailable = supabase !== null

async function toBase64(file: File, maxSide = 2000): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.88).split(',')[1]
}

async function call<T>(file: File, docType: 'invoice' | 'packing_list'): Promise<T> {
  if (!supabase) throw new Error('หน้าสาธิตอ่านเอกสารด้วย AI ไม่ได้ · กรอกเอง หรือกด "ใช้เอกสารตัวอย่าง"')
  const imageBase64 = await toBase64(file)
  const { data, error } = await supabase.functions.invoke('extract-invoice', { body: { imageBase64, mimeType: 'image/jpeg', docType } })
  if (error) {
    const detail = await (error as { context?: Response }).context?.json?.().catch(() => null)
    throw new Error(detail?.error ?? error.message)
  }
  if (!data?.document) throw new Error(data?.error ?? 'AI ไม่ได้ส่งข้อมูลกลับมา')
  return data.document as T
}

export const readInvoicePhoto = (file: File) => call<ReadInvoice>(file, 'invoice')
export const readPackingListPhoto = (file: File) => call<ReadPackingList>(file, 'packing_list')
