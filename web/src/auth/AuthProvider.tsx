import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/layoutSource'
import { AuthContext, type AuthState } from './authContext'
import { MIN_PASSWORD, staffEmail, type StaffProfile } from './staff'

const userAgent = () => (typeof navigator === 'undefined' ? null : navigator.userAgent)

async function fetchProfile(userId: string): Promise<StaffProfile | null> {
  if (!supabase) return null
  const { data } = await supabase
    .from('staff_profiles')
    .select('id, employee_code, full_name, role, active, must_change_password')
    .eq('id', userId)
    .maybeSingle()
  return data as StaffProfile | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<StaffProfile | null>(null)
  const [loading, setLoading] = useState(!!supabase)

  useEffect(() => {
    if (!supabase) return
    const apply = async (s: Session | null) => {
      setSession(s)
      setProfile(s ? await fetchProfile(s.user.id) : null)
      setLoading(false)
    }
    supabase.auth.getSession().then(({ data }) => apply(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // TOKEN_REFRESHED ไม่ต้องโหลดโปรไฟล์ใหม่
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') void apply(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const signIn = useCallback(async (employeeCode: string, password: string) => {
    if (!supabase) return 'ยังไม่ได้เชื่อมต่อฐานข้อมูล'
    if (!employeeCode.trim() || !password) return 'กรอกรหัสพนักงานและรหัสผ่าน'
    const { data, error } = await supabase.auth.signInWithPassword({ email: staffEmail(employeeCode), password })
    if (error) return 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง'
    const p = await fetchProfile(data.user.id)
    if (!p || !p.active) {
      await supabase.auth.signOut()
      return 'บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน หรือถูกปิดแล้ว — ติดต่อผู้ดูแลระบบ'
    }
    await supabase.rpc('log_access', { p_event: 'login', p_user_agent: userAgent() })
    return null
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    await supabase.rpc('log_access', { p_event: 'logout', p_user_agent: userAgent() })
    await supabase.auth.signOut()
  }, [])

  const changePassword = useCallback(async (password: string) => {
    if (!supabase) return 'ยังไม่ได้เชื่อมต่อฐานข้อมูล'
    if (password.length < MIN_PASSWORD) return `รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัวอักษร`
    const { error } = await supabase.auth.updateUser({ password })
    if (error) return `เปลี่ยนรหัสผ่านไม่สำเร็จ: ${error.message}`
    await supabase.rpc('log_access', { p_event: 'password_changed', p_user_agent: userAgent() })
    const { data } = await supabase.auth.getUser()
    if (data.user) setProfile(await fetchProfile(data.user.id))
    return null
  }, [])

  const value = useMemo<AuthState>(
    () => ({ enabled: !!supabase, loading, session, profile, signIn, signOut, changePassword }),
    [loading, session, profile, signIn, signOut, changePassword],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
