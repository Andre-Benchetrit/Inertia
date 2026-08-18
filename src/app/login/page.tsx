"use client"
import Link from "next/link"
import { FormEvent, useState } from "react"
import { useRouter } from "next/navigation"
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"
export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    const result = await createSupabaseBrowserClient().auth.signInWithPassword({ email, password })
    if (result.error) {
      const raw = result.error.message.toLowerCase()
      const friendly = raw.includes("not confirmed")
        ? "Seu e-mail ainda não foi confirmado. Abra a mensagem enviada pelo Supabase e confirme o cadastro."
        : raw.includes("invalid login")
          ? "E-mail ou senha incorretos. Confira os dados e tente novamente."
          : "Não foi possível entrar agora. Tente novamente em alguns instantes."
      setError(friendly)
      return
    }
    const next = new URLSearchParams(window.location.search).get("next")
    router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/app")
    router.refresh()
  }
  return (
    <main className="min-h-screen bg-[#f5f2eb] p-8 text-[#20251f]">
      <div className="mx-auto max-w-md pt-20">
        <Link href="/" className="font-semibold tracking-[0.2em] text-[#65735f] uppercase">
          Inertia
        </Link>
        <div className="mt-8 rounded-3xl bg-[#fffdf8] p-8">
          <h1 className="text-3xl font-semibold">Entrar no Inertia</h1>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <input
              type="email"
              placeholder="E-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-2xl border p-3"
            />
            <input
              type="password"
              placeholder="Senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-2xl border p-3"
            />
            {error && (
              <div className="rounded-2xl border border-[#edb8ad] bg-[#fbe8e3] px-4 py-3 text-sm text-[#8d493b]">
                <p className="font-semibold">Não foi possível entrar</p>
                <p className="mt-1">{error}</p>
              </div>
            )}
            <button className="w-full rounded-2xl bg-[#65735f] p-3 font-semibold text-white">
              Entrar
            </button>
          </form>
          <p className="mt-6 text-sm">
            Ainda nao tem conta?{" "}
            <Link href="/cadastro" className="underline">
              Criar conta
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
