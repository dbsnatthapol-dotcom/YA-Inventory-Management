import type { Session } from '@supabase/supabase-js'
import { createContext } from 'react'
import type { StaffProfile } from './staff'

export interface AuthState {
  /** false = ไม่ได้ต่อ Supabase (โหมดสาธิต ไม่ต้อง login) */
  enabled: boolean
  loading: boolean
  session: Session | null
  profile: StaffProfile | null
  signIn: (employeeCode: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
  changePassword: (password: string) => Promise<string | null>
}

export const AuthContext = createContext<AuthState | null>(null)

