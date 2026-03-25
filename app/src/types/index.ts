export type UserRole = 'hq' | 'school' | 'teacher' | 'student'

export type HQSubRole = 'super_admin' | 'operations' | 'tech_support' | 'analytics' | 'support'

export type SchoolSubRole = 'admin' | 'staff'

export interface Profile {
  id: string
  email: string
  name: string
  role: UserRole
  hq_sub_role?: HQSubRole
  school_sub_role?: SchoolSubRole
  school_id?: string
  created_at: string
}
