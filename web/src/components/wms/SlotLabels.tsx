import { QrCode } from './QrCode'

/** สติกเกอร์ A4 3×8 ดวง (70×37 มม.) · พิมพ์บนกระดาษธรรมดาแล้วตัดตามเส้นก็ได้ */
export const SLOTS_PER_PAGE = 24

/** ป้าย QR ช่องเก็บ: QR เป็นรหัสช่องล้วน ๆ ให้หน้าสแกนใส่เป็นช่องปลายทางได้ทันที */
export function SlotLabelPages({ codes, zoneName }: { codes: string[]; zoneName: string }) {
  const pages: string[][] = []
  for (let i = 0; i < codes.length; i += SLOTS_PER_PAGE) pages.push(codes.slice(i, i + SLOTS_PER_PAGE))
  return (
    <>
      {pages.map((page, n) => (
        <div key={n} className="print-page grid grid-cols-3 content-start font-sans" style={{ width: '210mm', height: '297mm', boxSizing: 'border-box', gridTemplateRows: 'repeat(8, 37mm)', paddingTop: '0.5mm' }}>
          {page.map((code) => (
            <div key={code} className="flex items-center gap-[3mm] overflow-hidden px-[4mm]" style={{ width: '70mm', height: '37mm', boxSizing: 'border-box', outline: '0.2mm dashed #c8c8c8' }}>
              <div className="shrink-0" style={{ width: '27mm', height: '27mm' }}>
                <QrCode text={code} title={code} />
              </div>
              <div className="min-w-0">
                <div className="font-mono font-bold leading-tight" style={{ fontSize: '15pt' }}>
                  {code}
                </div>
                <div className="truncate" style={{ fontSize: '8pt' }}>
                  {zoneName}
                </div>
                <div style={{ fontSize: '7pt', color: '#444' }}>ป้ายช่องเก็บ · สแกนตอนจัดเก็บ / ย้าย</div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  )
}
