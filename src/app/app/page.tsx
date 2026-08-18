"use client"
import Link from "next/link"
import { FormEvent, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"
type Book = { id: string; title: string; description: string; updated_at: string }
export default function AppPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()
  const [books, setBooks] = useState<Book[]>([])
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  async function loadBooks() {
    setLoading(true)
    setError("")
    try {
      const result = await Promise.race([
        supabase
          .from("books")
          .select("id,title,description,updated_at")
          .order("updated_at", { ascending: false }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
      ])
      if (result.error) setError("Não foi possível carregar seus livros.")
      else setBooks(result.data || [])
    } catch {
      setError("O carregamento demorou demais. Verifique sua conexão e tente novamente.")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBooks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  async function createBook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError("")
    try {
      const result = await supabase.rpc("create_book", {
        book_title: title.trim(),
        book_description: description.trim(),
      })
      if (result.error) {
        setError("Não foi possível criar o livro. Tente novamente.")
        return
      }
      setTitle("")
      setDescription("")
      setShowForm(false)
      await loadBooks()
      if (result.data?.id) router.push("/app/livro/" + result.data.id)
    } finally {
      setSaving(false)
    }
  }
  async function signOut() {
    await supabase.auth.signOut()
    router.replace("/login")
    router.refresh()
  }
  return (
    <main className="min-h-screen bg-[#f5f2eb] px-6 py-10 text-[#20251f]">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#d8d4c9] pb-6">
          <div>
            <p className="text-sm font-semibold tracking-[0.2em] text-[#65735f] uppercase">
              Inertia
            </p>
            <h1 className="mt-3 text-4xl font-semibold">Meus livros</h1>
            <p className="mt-2 text-sm text-[#687065]">
              Um lugar para transformar ideias em capítulos.
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={signOut} className="rounded-full px-4 py-2 text-sm text-[#687065]">
              Sair
            </button>
            <button
              onClick={() => setShowForm(!showForm)}
              className="rounded-2xl bg-[#65735f] px-5 py-3 font-semibold text-white"
            >
              + Novo livro
            </button>
          </div>
        </header>
        {error && (
          <div className="mt-6 rounded-2xl border border-[#edb8ad] bg-[#fbe8e3] p-4 text-sm text-[#8d493b]">
            <strong>Atenção:</strong> {error}
            <button onClick={() => void loadBooks()} className="ml-3 underline">
              Tentar novamente
            </button>
          </div>
        )}
        {showForm && (
          <form onSubmit={createBook} className="mt-8 rounded-3xl bg-[#fffdf8] p-6">
            <h2 className="text-xl font-semibold">Criar novo livro</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Título do livro"
                required
                className="rounded-2xl border p-3"
              />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descrição breve (opcional)"
                className="rounded-2xl border p-3"
              />
            </div>
            <button
              disabled={saving}
              className="mt-5 rounded-2xl bg-[#65735f] px-5 py-3 font-semibold text-white"
            >
              {saving ? "Criando…" : "Criar livro"}
            </button>
          </form>
        )}
        {loading ? (
          <p className="mt-10 text-[#687065]">Carregando seus livros…</p>
        ) : books.length === 0 ? (
          <div className="mt-10 rounded-3xl border border-dashed border-[#b8c4b2] bg-[#fbfaf5] p-12 text-center">
            <h2 className="text-2xl font-semibold">Comece seu primeiro livro</h2>
            <p className="mt-3 text-[#687065]">Crie um projeto para organizar capítulos.</p>
            <button
              onClick={() => setShowForm(true)}
              className="mt-6 rounded-2xl bg-[#65735f] px-5 py-3 font-semibold text-white"
            >
              Criar primeiro livro
            </button>
          </div>
        ) : (
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {books.map((book) => (
              <Link
                key={book.id}
                href={"/app/livro/" + book.id}
                className="rounded-3xl bg-[#fffdf8] p-6"
              >
                <p className="text-xs font-semibold text-[#8d6d4c] uppercase">Projeto de escrita</p>
                <h2 className="mt-3 text-2xl font-semibold">{book.title}</h2>
                <p className="mt-3 text-sm text-[#687065]">
                  {book.description || "Sem descrição ainda."}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
