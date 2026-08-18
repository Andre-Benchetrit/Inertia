"use client"

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"

export default function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const [status, setStatus] = useState("Verificando convite…")
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    async function accept() {
      const supabase = createSupabaseBrowserClient()
      const user = await supabase.auth.getUser()
      if (!user.data.user) {
        const next = encodeURIComponent(window.location.pathname)
        router.replace(`/login?next=${next}`)
        return
      }
      const result = await supabase.rpc("accept_book_invite", { p_token: token })
      if (!active) return
      if (result.error) {
        const raw = result.error.message.toLowerCase()
        setError(
          raw.includes("expirou")
            ? "Este convite expirou."
            : raw.includes("utilizado")
              ? "Este convite já foi utilizado."
              : raw.includes("não encontrado")
                ? "Convite não encontrado."
                : result.error.message,
        )
        setStatus("")
        return
      }
      const bookId = result.data as string
      setStatus("Convite aceito. Abrindo o livro…")
      setTimeout(() => router.replace(`/app/livro/${bookId}`), 500)
    }
    void accept()
    return () => {
      active = false
    }
  }, [router, token])

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f1ea] px-4 text-[#253126]">
      <section className="w-full max-w-md rounded-[2rem] bg-[#fffdf8] p-8 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8d6d4c]">Inertia</p>
        <h1 className="mt-3 text-2xl font-bold">Convite para colaborar</h1>
        {status && <p className="mt-5 text-sm text-[#687065]">{status}</p>}
        {error && (
          <>
            <p className="mt-5 rounded-2xl bg-[#fbe8e3] p-4 text-sm text-[#8d493b]">{error}</p>
            <Link
              href="/app"
              className="mt-5 inline-block rounded-full bg-[#65735f] px-5 py-3 text-sm font-semibold text-white"
            >
              Ir para meus livros
            </Link>
          </>
        )}
      </section>
    </main>
  )
}
