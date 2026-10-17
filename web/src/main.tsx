import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { unlockSound } from './lib/scanFeedback'

// เบราว์เซอร์ให้เล่นเสียงหลังแตะจอครั้งแรก: ปลดล็อกไว้ เสียงสแกนจะดังทันที
unlockSound()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
