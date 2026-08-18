import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { createSupabaseServerClient } from "@/lib/supabase-server"

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login?next=%2Fapp")
  }

  return children
}
