"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"

type Book = {
  id: string
  title: string
  description: string
  created_by: string
  created_at: string
  updated_at: string
}

type Chapter = {
  id: string
  title: string
  description: string
  chapter_number: number
  status: string
  created_at: string
  updated_at: string
}

export default function BookPage() {
  const { bookId } = useParams<{ bookId: string }>()
  const supabase = createSupabaseBrowserClient()
  const [book, setBook] = useState<Book | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [title, setTitle] = useState("")
  const [bookTitle, setBookTitle] = useState("")
  const [bookDescription, setBookDescription] = useState("")
  const [editingBook, setEditingBook] = useState(false)
  const [savingBook, setSavingBook] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [isOwner, setIsOwner] = useState(false)
  const [inviteUrl, setInviteUrl] = useState("")
  const [inviteExpires, setInviteExpires] = useState("")
  const [inviteLoading, setInviteLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [backupLoading, setBackupLoading] = useState(false)

  async function load() {
    const current = await supabase.auth.getUser()
    const userId = current.data.user?.id
    const b = await supabase
      .from("books")
      .select("id,title,description,created_by,created_at,updated_at")
      .eq("id", bookId)
      .maybeSingle()

    if (b.error || !b.data) {
      setError(b.error?.message || "Livro não encontrado.")
      setLoading(false)
      return
    }

    const loadedBook = b.data as Book
    setBook(loadedBook)
    setBookTitle(loadedBook.title)
    setBookDescription(loadedBook.description || "")

    const c = await supabase
      .from("chapters")
      .select("id,title,description,chapter_number,status,created_at,updated_at")
      .eq("book_id", bookId)
      .order("chapter_number")
    if (c.error) setError(c.error.message)
    else setChapters((c.data || []) as Chapter[])

    if (userId) {
      const member = await supabase
        .from("book_members")
        .select("role")
        .eq("book_id", bookId)
        .eq("user_id", userId)
        .maybeSingle()
      setIsOwner(member.data?.role === "owner")
    }
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [bookId])

  function startBookEdit() {
    if (!book) return
    setBookTitle(book.title)
    setBookDescription(book.description || "")
    setEditingBook(true)
    setError("")
  }

  function cancelBookEdit() {
    if (!book) return
    setBookTitle(book.title)
    setBookDescription(book.description || "")
    setEditingBook(false)
    setError("")
  }

  async function saveBook() {
    const cleanTitle = bookTitle.trim()
    const cleanDescription = bookDescription.trim()
    if (!cleanTitle) {
      setError("O título do livro não pode ficar vazio.")
      return
    }

    setSavingBook(true)
    setError("")
    const result = await supabase
      .from("books")
      .update({ title: cleanTitle, description: cleanDescription })
      .eq("id", bookId)

    if (result.error) {
      setError("Não foi possível salvar os dados do livro: " + result.error.message)
      setSavingBook(false)
      return
    }

    setBook((current) =>
      current ? { ...current, title: cleanTitle, description: cleanDescription } : current,
    )
    setBookTitle(cleanTitle)
    setBookDescription(cleanDescription)
    setEditingBook(false)
    setSavingBook(false)
  }

  async function add() {
    const clean = title.trim()
    if (!clean) return
    setError("")
    const next = chapters.reduce((max, chapter) => Math.max(max, chapter.chapter_number), 0) + 1
    const result = await supabase
      .from("chapters")
      .insert({ book_id: bookId, title: clean, chapter_number: next, status: "draft" })
    if (result.error) {
      setError("Não foi possível criar o capítulo: " + result.error.message)
      return
    }
    setTitle("")
    await load()
  }

  async function createInvite() {
    setInviteLoading(true)
    setCopied(false)
    setError("")
    const result = await supabase.rpc("create_book_invite", {
      p_book_id: bookId,
      p_expires_in_hours: 168,
    })
    if (result.error) {
      setError("Não foi possível criar o convite: " + result.error.message)
      setInviteLoading(false)
      return
    }
    const row = Array.isArray(result.data) ? result.data[0] : result.data
    const token = row?.token as string | undefined
    if (!token) {
      setError("O convite foi criado, mas o link não pôde ser lido.")
      setInviteLoading(false)
      return
    }
    setInviteUrl(`${window.location.origin}/convite/${token}`)
    setInviteExpires(row?.expires_at ? new Date(row.expires_at).toLocaleString("pt-BR") : "")
    setInviteLoading(false)
  }

  async function copyInvite() {
    if (!inviteUrl) return
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  async function exportBackup() {
    if (!book) return
    setBackupLoading(true)
    setError("")
    const memberResult = await supabase
      .from("book_members")
      .select("user_id,role,created_at")
      .eq("book_id", bookId)
    if (memberResult.error) {
      setError("Não foi possível exportar o backup: " + memberResult.error.message)
      setBackupLoading(false)
      return
    }

    const userIds = [...new Set((memberResult.data || []).map((member) => member.user_id))]
    const profileResult = userIds.length
      ? await supabase.from("profiles").select("id,display_name").in("id", userIds)
      : { data: [], error: null }
    if (profileResult.error) {
      setError("Não foi possível exportar os autores: " + profileResult.error.message)
      setBackupLoading(false)
      return
    }

    const names = new Map(
      (profileResult.data || []).map((profile) => [profile.id, profile.display_name]),
    )
    const messageResults = await Promise.all(
      chapters.map((chapter) =>
        supabase.rpc("get_chapter_messages", { target_chapter_id: chapter.id }),
      ),
    )
    const editorialResults = await Promise.all(
      chapters.map(async (chapter) => {
        const [manuscriptResult, versionsResult, suggestionsResult] = await Promise.all([
          supabase
            .from("chapter_manuscripts")
            .select("id,content,created_at,updated_at,updated_by")
            .eq("chapter_id", chapter.id)
            .maybeSingle(),
          supabase
            .from("chapter_versions")
            .select(
              "id,version_number,content,source_snapshot,compilation_provider,model_name,prompt_version,created_by,created_at",
            )
            .eq("chapter_id", chapter.id)
            .order("version_number"),
          supabase
            .from("chapter_suggestions")
            .select(
              "id,version_id,suggestion_type,severity,status,explanation,original_text,suggested_text,anchor,created_by,resolved_by,resolved_at,created_at",
            )
            .eq("chapter_id", chapter.id)
            .order("created_at"),
        ])
        const error = manuscriptResult.error || versionsResult.error || suggestionsResult.error
        return {
          chapter_id: chapter.id,
          error: error?.message || null,
          manuscript: manuscriptResult.data || null,
          versions: versionsResult.data || [],
          suggestions: suggestionsResult.data || [],
        }
      }),
    )
    const editorialFailed = editorialResults.find((result) => result.error)
    if (editorialFailed?.error) {
      setError("Não foi possível exportar as camadas editoriais: " + editorialFailed.error)
      setBackupLoading(false)
      return
    }

    const failed = messageResults.find((result) => result.error)
    if (failed?.error) {
      setError("Não foi possível exportar as mensagens: " + failed.error.message)
      setBackupLoading(false)
      return
    }

    const payload = {
      format: "inertia-book-backup",
      version: 2,
      exported_at: new Date().toISOString(),
      book,
      members: (memberResult.data || []).map((member) => ({
        ...member,
        display_name: names.get(member.user_id) || "Autor",
      })),
      chapters: chapters.map((chapter, index) => {
        const editorial = editorialResults[index]
        return {
          ...chapter,
          messages: messageResults[index].data || [],
          editorial: {
            manuscript: editorial.manuscript,
            versions: editorial.versions,
            suggestions: editorial.suggestions,
          },
        }
      }),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download =
      (book.title || "inertia-livro").toLowerCase().replace(/[^a-z0-9]+/gi, "-") + "-backup.json"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    setBackupLoading(false)
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#f6f1ea] p-6 text-[#253126]">
        <p>Abrindo livro…</p>
      </main>
    )
  }

  if (!book) {
    return (
      <main className="min-h-screen bg-[#f6f1ea] p-6 text-[#253126]">
        <p>Não foi possível abrir este livro.</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#f6f1ea] px-4 py-6 text-[#253126] sm:px-6">
      <div className="mx-auto max-w-4xl">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Link href="/app" className="text-sm font-semibold text-[#65735f]">
              ← Meus livros
            </Link>
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-[#8d6d4c]">
              Livro em colaboração
            </p>
            <div className="mt-2 flex items-center gap-3">
              <h1 className="truncate text-4xl font-bold tracking-tight">{book.title}</h1>
              {isOwner && (
                <button
                  type="button"
                  onClick={startBookEdit}
                  className="shrink-0 rounded-full border border-[#d5c9bd] bg-white/70 px-3 py-1.5 text-xs font-semibold text-[#687065] transition hover:bg-white"
                >
                  Editar livro
                </button>
              )}
            </div>
            {book.description && (
              <p className="mt-3 max-w-2xl whitespace-pre-wrap leading-7 text-[#687065]">
                {book.description}
              </p>
            )}
          </div>
          {isOwner && (
            <button
              type="button"
              onClick={() => void createInvite()}
              disabled={inviteLoading}
              className="shrink-0 rounded-full bg-[#65735f] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#52614e] disabled:opacity-50"
            >
              {inviteLoading ? "Gerando…" : "Convidar coautor"}
            </button>
          )}
        </header>

        {isOwner && editingBook && (
          <section className="mt-6 rounded-3xl border border-[#d7c7ae] bg-white/80 p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8d6d4c]">
                  Dados do livro
                </p>
                <h2 className="mt-1 text-xl font-semibold">Editar título e descrição</h2>
              </div>
              <button
                type="button"
                onClick={cancelBookEdit}
                disabled={savingBook}
                className="text-sm font-semibold text-[#687065] hover:text-[#253126] disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
            <div className="mt-5 space-y-3">
              <label className="block text-sm font-semibold text-[#253126]">
                Título
                <input
                  value={bookTitle}
                  onChange={(event) => setBookTitle(event.target.value)}
                  maxLength={160}
                  className="mt-1 w-full rounded-xl border border-[#d5c9bd] bg-white px-4 py-3 font-normal outline-none transition focus:border-[#8d6d4c]"
                />
              </label>
              <label className="block text-sm font-semibold text-[#253126]">
                Descrição
                <textarea
                  value={bookDescription}
                  onChange={(event) => setBookDescription(event.target.value)}
                  maxLength={2000}
                  rows={4}
                  placeholder="Gênero, tom e contexto do livro para orientar a colaboração e a IA…"
                  className="mt-1 w-full resize-y rounded-xl border border-[#d5c9bd] bg-white px-4 py-3 font-normal leading-6 outline-none transition focus:border-[#8d6d4c]"
                />
              </label>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={cancelBookEdit}
                  disabled={savingBook}
                  className="rounded-xl border border-[#d5c9bd] bg-white px-4 py-2 text-sm font-semibold text-[#687065] disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void saveBook()}
                  disabled={savingBook || !bookTitle.trim()}
                  className="rounded-xl bg-[#65735f] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#52614e] disabled:opacity-50"
                >
                  {savingBook ? "Salvando…" : "Salvar alterações"}
                </button>
              </div>
            </div>
          </section>
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => void exportBackup()}
            disabled={backupLoading}
            className="rounded-full border border-[#d5c9bd] bg-white/60 px-3 py-1.5 text-xs font-semibold text-[#687065] transition hover:bg-white disabled:opacity-50"
          >
            {backupLoading ? "Preparando backup…" : "Exportar backup JSON"}
          </button>
        </div>

        {isOwner && inviteUrl && (
          <section className="mt-6 rounded-3xl border border-[#d7c7ae] bg-[#fff8e9] p-5 shadow-sm">
            <p className="text-sm font-semibold text-[#6f5739]">Link de convite criado</p>
            <p className="mt-1 text-xs text-[#8d6d4c]">
              Válido até {inviteExpires}. Ele pode ser usado uma única vez.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                value={inviteUrl}
                className="min-w-0 flex-1 rounded-xl border border-[#d8c8af] bg-white px-3 py-2 text-sm text-[#687065] outline-none"
              />
              <button
                type="button"
                onClick={() => void copyInvite()}
                className="rounded-xl bg-[#8d6d4c] px-4 py-2 text-sm font-semibold text-white"
              >
                {copied ? "Copiado" : "Copiar link"}
              </button>
            </div>
          </section>
        )}

        {error && (
          <div className="mt-6 rounded-2xl bg-[#fbe8e3] p-4 text-sm text-[#8d493b]">{error}</div>
        )}

        <section className="mt-10 rounded-[2rem] bg-white/70 p-5 shadow-sm sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8d6d4c]">
                Conversas
              </p>
              <h2 className="mt-1 text-2xl font-semibold">Capítulos</h2>
            </div>
            <span className="rounded-full bg-[#e8eee5] px-3 py-1 text-xs font-semibold text-[#65735f]">
              {chapters.length} {chapters.length === 1 ? "capítulo" : "capítulos"}
            </span>
          </div>
          <div className="mt-5 space-y-3">
            {chapters.length === 0 ? (
              <p className="rounded-2xl bg-[#f6f1ea] p-5 text-sm text-[#687065]">
                Crie o primeiro capítulo para começar a conversa.
              </p>
            ) : (
              chapters.map((chapter) => (
                <Link
                  key={chapter.id}
                  href={`/app/livro/${bookId}/capitulo/${chapter.id}`}
                  className="flex items-center justify-between rounded-2xl bg-[#f6f1ea] p-4 transition hover:bg-[#e8eee5]"
                >
                  <span className="min-w-0">
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8d6d4c]">
                      Capítulo {chapter.chapter_number}
                    </span>
                    <h3 className="mt-1 truncate font-semibold">{chapter.title}</h3>
                    {chapter.description && (
                      <p className="mt-1 line-clamp-2 max-w-2xl text-sm leading-5 text-[#687065]">
                        {chapter.description}
                      </p>
                    )}
                  </span>
                  <span className="text-2xl text-[#65735f]">→</span>
                </Link>
              ))
            )}
          </div>
          <div className="mt-7 border-t border-[#e3d8cc] pt-5">
            <p className="mb-3 text-sm font-semibold">Novo capítulo</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void add()
                }}
                placeholder="Ex.: A casa na colina"
                className="min-w-0 flex-1 rounded-xl border border-[#d5c9bd] bg-white px-4 py-3 outline-none"
              />
              <button
                type="button"
                onClick={() => void add()}
                disabled={!title.trim()}
                className="rounded-xl bg-[#65735f] px-5 py-3 font-semibold text-white disabled:opacity-50"
              >
                Criar capítulo
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
