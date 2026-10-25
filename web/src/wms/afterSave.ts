/**
 * บันทึกแล้วโหลดข้อมูลใหม่: บันทึกสำเร็จ = สำเร็จ แม้โหลดใหม่พลาด (เน็ตหลุด)
 * ห้ามขึ้นว่าล้มเหลว ไม่งั้นพนักงานกดซ้ำแล้วตัดสต็อกซ้ำ
 * - save ล้ม ⇒ โยน error (ยังไม่ได้บันทึก)
 * - save ผ่าน ⇒ เรียก onSaved ทันที (แจ้งผล) แล้วค่อยโหลดใหม่ · โหลดพลาดบอกผ่าน reloadFailed
 */
export async function saveThenReload<T>(save: () => Promise<T>, onSaved: (value: T) => void, reloads: (() => unknown)[]): Promise<{ value: T; reloadFailed: boolean }> {
  const value = await save()
  onSaved(value)
  const settled = await Promise.allSettled(reloads.map((f) => Promise.resolve().then(f)))
  return { value, reloadFailed: settled.some((s) => s.status === 'rejected') }
}

export const RELOAD_FAILED = 'โหลดข้อมูลล่าสุดไม่สำเร็จ (บันทึกแล้ว อย่ากดซ้ำ)'
