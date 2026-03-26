import { redirect } from 'next/navigation'

// Middleware handles role-based redirect — this is a fallback
export default function RootPage() {
  redirect('/login')
}
