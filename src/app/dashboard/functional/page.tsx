import { redirect } from 'next/navigation'

// The Functional dashboard is now the "Functional" tab on /dashboard. Keep this path working.
export default function FunctionalRedirect() {
  redirect('/dashboard')
}
