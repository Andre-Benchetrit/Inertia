"use client"
import Link from "next/link"
import { FormEvent, useState } from "react"
import { useRouter } from "next/navigation"
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"
import Brand from "@/components/Brand"
export default function CadastroPage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState("")
  const [success, setSuccess] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSuccess(false)
    setMessage("")
    const result = await createSupabaseBrowserClient().auth.signUp({
      email,
      password,
      options: { data: { display_name: name } },
    })
    if (result.error) {
      setMessage("Verifique os dados informados e tente novamente.")
      return
    }
    if (result.data.session) {
      router.replace("/app")
      router.refresh()
    } else {
      setSuccess(true)
      setMessage("Seu cadastro foi concluído. Verifique o e-mail de confirmação antes de entrar.")
    }
  }
  return (
    <main className="min-h-screen bg-[#f5f2eb] p-8 text-[#20251f]">
      <div className="mx-auto max-w-md pt-20">
        <Brand />
        <div className="mt-8 rounded-3xl bg-[#fffdf8] p-8">
          <h1 className="text-3xl font-semibold">Criar conta</h1>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <input
              placeholder="Seu nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-2xl border p-3"
            />
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
              minLength={6}
              className="w-full rounded-2xl border p-3"
            />
            {message && (
              <div
                className={
                  success
                    ? "rounded-2xl border border-[#b8d6ad] bg-[#e4efdf] px-4 py-3 text-sm text-[#45603f]"
                    : "rounded-2xl border border-[#edb8ad] bg-[#fbe8e3] px-4 py-3 text-sm text-[#8d493b]"
                }
              >
                <p className="font-semibold">
                  {success ? "Cadastro concluído" : "Não foi possível criar a conta"}
                </p>
                <p className="mt-1">{message}</p>
                {success && (
                  <div className="mt-4 border-t border-[#b8d6ad] pt-4">
                    <p className="font-semibold">Próximos passos</p>
                    <ol className="mt-3 space-y-2 text-sm">
                      <li className="flex gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#b8d6ad] text-xs font-bold text-[#45603f]">
                          1
                        </span>
                        <span>Confirme o e-mail recebido na sua caixa de entrada.</span>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#b8d6ad] text-xs font-bold text-[#45603f]">
                          2
                        </span>
                        <span>Volte para a tela de entrada do Inertia.</span>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#b8d6ad] text-xs font-bold text-[#45603f]">
                          3
                        </span>
                        <span>Informe seu e-mail e sua senha para entrar.</span>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#b8d6ad] text-xs font-bold text-[#45603f]">
                          4
                        </span>
                        <span>
                          Na área <strong>Meus livros</strong>, você poderá começar seu primeiro
                          projeto.
                        </span>
                      </li>
                    </ol>
                  </div>
                )}
              </div>
            )}
            <button className="w-full rounded-2xl bg-[#65735f] p-3 font-semibold text-white">
              Criar conta
            </button>
          </form>
          <p className="mt-6 text-sm">
            Ja tem conta?{" "}
            <Link href="/login" className="underline">
              Entrar
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
