// ไอคอนเส้นขนาดเล็ก (stroke = currentColor) ใช้ในแผงลอยบนผัง
import type { ReactNode } from 'react'

function Svg({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  )
}

export const IconBox = () => (
  <Svg>
    <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
    <path d="m3 8 9 5 9-5M12 13v8" />
  </Svg>
)
export const IconScan = () => (
  <Svg>
    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </Svg>
)
export const IconLine = () => (
  <Svg>
    <path d="M3 17h18M5 17V9h5v8M14 17V6h5v11" />
    <path d="m8 5 2-2 2 2" />
  </Svg>
)
export const IconAlert = () => (
  <Svg>
    <path d="M12 3 2 20h20L12 3Z" />
    <path d="M12 10v4M12 17.5v.01" />
  </Svg>
)
export const IconSearch = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
)
export const IconPlus = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)
export const IconMinus = () => (
  <Svg>
    <path d="M5 12h14" />
  </Svg>
)
export const IconRotateLeft = () => (
  <Svg>
    <path d="M4 5v5h5" />
    <path d="M5.5 15a7 7 0 1 0 1.2-7.6L4 10" />
  </Svg>
)
export const IconRotateRight = () => (
  <Svg>
    <path d="M20 5v5h-5" />
    <path d="M18.5 15a7 7 0 1 1-1.2-7.6L20 10" />
  </Svg>
)
export const IconHome = () => (
  <Svg>
    <path d="m3 11 9-7 9 7" />
    <path d="M5 10v10h14V10" />
  </Svg>
)
export const IconClose = ({ size = 16 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
)
export const IconPanel = () => (
  <Svg>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </Svg>
)
export const IconPin = ({ size = 14 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Svg>
)
