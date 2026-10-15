import { useContext } from 'react'
import { WmsContext } from './wmsContext'

export function useWms() {
  const ctx = useContext(WmsContext)
  if (!ctx) throw new Error('useWms ต้องอยู่ภายใน <WmsProvider>')
  return ctx
}
