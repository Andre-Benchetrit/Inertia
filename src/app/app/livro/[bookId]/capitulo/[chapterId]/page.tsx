"use client"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import type { RealtimeChannel } from "@supabase/supabase-js"
import { createSupabaseBrowserClient } from "@/lib/supabase-browser"
import OllamaStatus from "./OllamaStatus"
import EditorialPanel from "./EditorialPanel"
import { WattpadMessage } from "@/lib/wattpad-markdown"
type Message = {
  id: string
  author_id: string
  content: string | null
  message_type: "story" | "author_note"
  sequence_number: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  edited_at: string | null
  display_name?: string
}
type Chapter = {
  id: string
  title: string
  description: string
  chapter_number: number
}
export default function ChapterPage() {
  const { bookId, chapterId } = useParams<{ bookId: string; chapterId: string }>()
  const supabase = createSupabaseBrowserClient()
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [chapterTitle, setChapterTitle] = useState("")
  const [chapterDescription, setChapterDescription] = useState("")
  const [editingChapter, setEditingChapter] = useState(false)
  const [savingChapter, setSavingChapter] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [content, setContent] = useState("")
  const [message_type, setMessageType] = useState<"story" | "author_note">("story")
  const [userId, setUserId] = useState("")
  const [error, setError] = useState("")
  const [chapterNotice, setChapterNotice] = useState("")
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [editMessageType, setEditMessageType] = useState<"story" | "author_note">("story")
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [onlineCount, setOnlineCount] = useState(0)
  const [otherTyping, setOtherTyping] = useState(false)
  const presenceChannel = useRef<RealtimeChannel | null>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftKey = useMemo(
    () => (userId ? `inertia:draft:${userId}:${bookId}:${chapterId}` : ""),
    [userId, bookId, chapterId],
  )
  async function load() {
    const c = await supabase
      .from("chapters")
      .select("id,title,description,chapter_number")
      .eq("id", chapterId)
      .maybeSingle()
    if (c.error || !c.data) {
      setError(c.error?.message || "Capítulo não encontrado.")
      setLoading(false)
      return
    }
    const loadedChapter = {
      ...c.data,
      description: c.data.description || "",
    } as Chapter
    setChapter(loadedChapter)
    setChapterTitle(loadedChapter.title)
    setChapterDescription(loadedChapter.description)

    const current = await supabase.auth.getUser()
    if (current.data.user) {
      const member = await supabase
        .from("book_members")
        .select("role")
        .eq("book_id", bookId)
        .eq("user_id", current.data.user.id)
        .maybeSingle()
      setIsOwner(member.data?.role === "owner")
    }

    const m = await supabase.rpc("get_chapter_messages", { target_chapter_id: chapterId })
    if (m.error) {
      setError("Não foi possível carregar a conversa: " + m.error.message)
      setLoading(false)
      return
    }
    const rpcMessages = (m.data || []) as Message[]
    const ids = [...new Set(rpcMessages.map((message) => message.author_id))]
    const p = ids.length
      ? await supabase.from("profiles").select("id,display_name").in("id", ids)
      : { data: [] as { id: string; display_name: string }[], error: null }
    const profileRows = (p.data || []) as { id: string; display_name: string }[]
    const names = new Map(profileRows.map((profile) => [profile.id, profile.display_name]))
    setMessages(
      rpcMessages.map((message) => ({
        ...message,
        display_name: names.get(message.author_id) || "Autor",
      })),
    )
    setLoading(false)
  }
  async function saveChapter() {
    if (!chapter || !isOwner) return
    const title = chapterTitle.trim()
    const description = chapterDescription.trim()
    if (!title) {
      setError("O título do capítulo não pode ficar vazio.")
      return
    }
    if (description.length > 2000) {
      setError("A descrição pode ter no máximo 2.000 caracteres.")
      return
    }

    setSavingChapter(true)
    setError("")
    setChapterNotice("")
    const result = await supabase
      .from("chapters")
      .update({ title, description })
      .eq("id", chapter.id)
      .select("id,title,description,chapter_number")
      .single()

    if (result.error || !result.data) {
      setError(
        "Não foi possível salvar o capítulo: " +
          (result.error?.message ?? "registro não encontrado."),
      )
    } else {
      const updatedChapter = {
        ...result.data,
        description: result.data.description || "",
      } as Chapter
      setChapter(updatedChapter)
      setChapterTitle(updatedChapter.title)
      setChapterDescription(updatedChapter.description)
      setEditingChapter(false)
      setChapterNotice("Capítulo atualizado.")
    }
    setSavingChapter(false)
  }

  function insertMarkup(target: "composer" | "editor", marker: string) {
    const selector = target === "composer" ? "#chat-composer" : `#edit-${editingId}`
    const textarea = document.querySelector(selector) as HTMLTextAreaElement | null
    if (!textarea) return
    const value = target === "composer" ? content : editValue
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = value.slice(start, end)
    const replacement = selected ? `${marker}${selected}${marker}` : `${marker}texto${marker}`
    const next = value.slice(0, start) + replacement + value.slice(end)
    if (target === "composer") handleContentChange(next)
    else setEditValue(next)
    requestAnimationFrame(() => {
      textarea.focus()
      const cursor = selected ? start + replacement.length : start + marker.length
      textarea.setSelectionRange(cursor, cursor)
    })
  }
  function insertHeading(target: "composer" | "editor") {
    const selector = target === "composer" ? "#chat-composer" : `#edit-${editingId}`
    const textarea = document.querySelector(selector) as HTMLTextAreaElement | null
    if (!textarea) return
    const value = target === "composer" ? content : editValue
    const start = textarea.selectionStart
    const lineStart = value.lastIndexOf("\n", start - 1) + 1
    const next = value.slice(0, lineStart) + "## " + value.slice(lineStart)
    if (target === "composer") handleContentChange(next)
    else setEditValue(next)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(start + 3, start + 3)
    })
  }
  function updatePresence(channel: RealtimeChannel) {
    const state = channel.presenceState() as Record<string, Array<{ user_id?: string }>>
    const ids = new Set<string>()
    Object.values(state).forEach((entries) =>
      entries.forEach((entry) => {
        if (entry.user_id && entry.user_id !== userId) ids.add(entry.user_id)
      }),
    )
    setOnlineCount(ids.size)
  }
  function broadcastTyping(typing: boolean) {
    const channel = presenceChannel.current
    if (!channel || !userId) return
    void channel.send({ type: "broadcast", event: "typing", payload: { user_id: userId, typing } })
  }
  function handleContentChange(value: string) {
    setContent(value)
    broadcastTyping(Boolean(value.trim()))
    if (typingTimer.current) clearTimeout(typingTimer.current)
    if (value.trim()) typingTimer.current = setTimeout(() => broadcastTyping(false), 1500)
  }
  async function setup() {
    const u = await supabase.auth.getUser()
    if (u.data.user) {
      setUserId(u.data.user.id)
      const saved = localStorage.getItem(`inertia:draft:${u.data.user.id}:${bookId}:${chapterId}`)
      if (saved) setContent(saved)
    }
    await load()
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void setup()
  }, [chapterId])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!userId) return
    const messageChannel = supabase
      .channel("messages-" + chapterId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: "chapter_id=eq." + chapterId },
        () => {
          void load()
        },
      )
      .subscribe()
    const presence = supabase
      .channel("presence-" + chapterId, {
        config: { presence: { key: userId }, broadcast: { self: false } },
      })
      .on("presence", { event: "sync" }, () => updatePresence(presence))
      .on("presence", { event: "join" }, () => updatePresence(presence))
      .on("presence", { event: "leave" }, () => {
        updatePresence(presence)
        setOtherTyping(false)
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload?.user_id !== userId) setOtherTyping(Boolean(payload?.typing))
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await presence.track({ user_id: userId })
          updatePresence(presence)
        }
      })
    presenceChannel.current = presence
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current)
      void presence.send({
        type: "broadcast",
        event: "typing",
        payload: { user_id: userId, typing: false },
      })
      void presence.untrack()
      void supabase.removeChannel(presence)
      void supabase.removeChannel(messageChannel)
      presenceChannel.current = null
      setOnlineCount(0)
      setOtherTyping(false)
    }
  }, [chapterId, userId])
  useEffect(() => {
    if (draftKey) localStorage.setItem(draftKey, content)
  }, [content, draftKey])
  async function send() {
    const clean = content.trim()
    if (!clean || !userId) return
    setSending(true)
    setError("")
    const r = await supabase.from("messages").insert({
      chapter_id: chapterId,
      author_id: userId,
      content: clean,
      message_type: message_type,
    })
    if (r.error) setError("Não foi possível enviar: " + r.error.message)
    else {
      broadcastTyping(false)
      if (typingTimer.current) clearTimeout(typingTimer.current)
      setContent("")
      if (draftKey) localStorage.removeItem(draftKey)
      await load()
    }
    setSending(false)
  }
  async function saveEdit() {
    const clean = editValue.trim()
    if (!editingId || !clean || !userId) return
    setSending(true)
    setError("")
    const r = await supabase
      .from("messages")
      .update({
        content: clean,
        message_type: editMessageType,
        edited_at: new Date().toISOString(),
      })
      .eq("id", editingId)
      .eq("author_id", userId)
    if (r.error) setError("Não foi possível editar: " + r.error.message)
    else {
      setEditingId(null)
      setEditValue("")
      await load()
    }
    setSending(false)
  }
  async function softDelete(id: string) {
    if (!userId) return
    setDeletingId(id)
    setError("")
    const r = await supabase
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("author_id", userId)
    if (r.error) setError("Não foi possível excluir: " + r.error.message)
    else {
      setConfirmDeleteId(null)
      await load()
    }
    setDeletingId(null)
  }
  async function restoreMessage(id: string) {
    if (!userId) return
    setDeletingId(id)
    setError("")
    const r = await supabase
      .from("messages")
      .update({ deleted_at: null })
      .eq("id", id)
      .eq("author_id", userId)
    if (r.error) setError("Não foi possível recuperar: " + r.error.message)
    else await load()
    setDeletingId(null)
  }
  if (loading)
    return (
      <main className="min-h-screen bg-[#e9ded5] p-6">
        <p>Abrindo conversa…</p>
      </main>
    )
  return (
    <main className="min-h-screen bg-[#f6f1ea] text-[#253126]">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col border-x border-[#e7ddd1] bg-[#efe7dc] shadow-[0_0_50px_rgba(91,73,54,0.08)]">
        <header className="sticky top-0 z-10 flex items-start gap-4 border-b border-[#53624e] bg-[#65735f] px-5 py-4 text-white">
          <Link href={"/app/livro/" + bookId} className="pt-1 text-xl">
            ←
          </Link>
          {editingChapter ? (
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-widest text-white/70">
                Editando capítulo {chapter?.chapter_number}
              </p>
              <div className="mt-2 space-y-2">
                <input
                  value={chapterTitle}
                  onChange={(event) => setChapterTitle(event.target.value)}
                  maxLength={160}
                  className="w-full rounded-xl border border-white/20 bg-white/95 px-3 py-2 text-lg font-semibold text-[#253126] outline-none focus:border-white"
                  aria-label="Título do capítulo"
                />
                <textarea
                  value={chapterDescription}
                  onChange={(event) => setChapterDescription(event.target.value)}
                  maxLength={2000}
                  rows={2}
                  placeholder="Descrição, contexto ou tom deste capítulo"
                  className="w-full resize-y rounded-xl border border-white/20 bg-white/95 px-3 py-2 text-sm leading-5 text-[#253126] outline-none focus:border-white"
                  aria-label="Descrição do capítulo"
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-white/70">{chapterDescription.length}/2000</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setChapterTitle(chapter?.title || "")
                      setChapterDescription(chapter?.description || "")
                      setEditingChapter(false)
                      setError("")
                    }}
                    className="rounded-full px-3 py-1 text-xs text-white/80 hover:bg-white/10"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveChapter()}
                    disabled={savingChapter || !chapterTitle.trim()}
                    className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#53624e] disabled:opacity-50"
                  >
                    {savingChapter ? "Salvando…" : "Salvar"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-widest text-white/70">
                Capítulo {chapter?.chapter_number}
              </p>
              <h1 className="truncate text-xl font-semibold">{chapter?.title}</h1>
              {chapter?.description && (
                <p className="mt-1 line-clamp-2 max-w-2xl text-sm text-white/80">
                  {chapter.description}
                </p>
              )}
              <p className="mt-1 flex items-center gap-1.5 text-xs text-white/80">
                <span
                  className={
                    "inline-block h-2 w-2 rounded-full " +
                    (onlineCount > 0 ? "bg-[#b8e5a6]" : "bg-[#e7aaa1]")
                  }
                  aria-hidden="true"
                />
                {onlineCount > 0 ? "Online" : "Offline"}
              </p>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => {
                    setChapterTitle(chapter?.title || "")
                    setChapterDescription(chapter?.description || "")
                    setEditingChapter(true)
                    setError("")
                    setChapterNotice("")
                  }}
                  className="mt-1 text-xs text-white/80 underline decoration-white/40 underline-offset-2 hover:text-white"
                >
                  Editar capítulo
                </button>
              )}
            </div>
          )}
          <OllamaStatus />
        </header>
        {chapterNotice && (
          <p className="border-b border-[#d5c9bd] bg-[#e4f2dc] px-4 py-2 text-sm text-[#36552d] sm:px-6">
            {chapterNotice}
          </p>
        )}
        <EditorialPanel chapterId={chapterId} messages={messages} />
        <section className="flex-1 space-y-4 bg-[radial-gradient(#d9cfc3_0.7px,transparent_0.7px)] [background-size:14px_14px] p-4 sm:p-6">
          {error && (
            <div className="rounded-2xl bg-[#fbe8e3] p-4 text-sm text-[#8d493b]">{error}</div>
          )}
          {messages.length === 0 ? (
            <p className="mx-auto mt-12 max-w-sm rounded-2xl bg-[#fffdf8] p-5 text-center text-sm text-[#687065]">
              A conversa começa aqui. Escreva a primeira ideia, cena ou observação para o outro
              autor.
            </p>
          ) : (
            messages.map((m) => {
              const removed = Boolean(m.deleted_at)
              return (
                <article
                  key={m.id}
                  className={
                    "w-fit max-w-[88%] break-words rounded-[1.35rem] px-4 py-3 shadow-sm " +
                    ((m.author_id === userId ? "ml-auto " : "") +
                      (m.message_type === "author_note"
                        ? m.author_id === userId
                          ? "bg-[#f2dfbf]"
                          : "bg-[#f8eddc]"
                        : m.author_id === userId
                          ? "bg-[#dcf8c6]"
                          : "bg-[#fffdf8]"))
                  }
                >
                  {m.author_id !== userId && (
                    <p className="mb-1 text-xs font-semibold text-[#65735f]">{m.display_name}</p>
                  )}
                  {editingId === m.id ? (
                    <div>
                      <div className="mb-2 flex gap-1">
                        <button
                          type="button"
                          onClick={() => setEditMessageType("story")}
                          className={
                            "rounded-full px-2 py-1 text-[10px] " +
                            (editMessageType === "story"
                              ? "bg-[#65735f] text-white"
                              : "bg-white/70 text-[#687065]")
                          }
                        >
                          História
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditMessageType("author_note")}
                          className={
                            "rounded-full px-2 py-1 text-[10px] " +
                            (editMessageType === "author_note"
                              ? "bg-[#8d6d4c] text-white"
                              : "bg-white/70 text-[#687065]")
                          }
                        >
                          Comentário
                        </button>
                      </div>
                      <div className="mb-2 flex gap-1">
                        <button
                          type="button"
                          onClick={() => insertMarkup("editor", "**")}
                          className="rounded-full bg-white/70 px-2 py-1 text-[10px] font-bold"
                        >
                          B
                        </button>
                        <button
                          type="button"
                          onClick={() => insertMarkup("editor", "*")}
                          className="rounded-full bg-white/70 px-2 py-1 text-[10px] italic"
                        >
                          I
                        </button>
                        <button
                          type="button"
                          onClick={() => insertHeading("editor")}
                          className="rounded-full bg-white/70 px-2 py-1 text-[10px]"
                        >
                          T
                        </button>
                      </div>
                      <textarea
                        id={`edit-${m.id}`}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        rows={3}
                        className="w-full rounded-xl border border-[#d5c9bd] bg-white p-3 text-[15px] leading-6 outline-none"
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null)
                            setEditValue("")
                          }}
                          className="rounded-full bg-white/70 px-3 py-1 text-xs"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveEdit()}
                          disabled={sending || !editValue.trim()}
                          className="rounded-full bg-[#65735f] px-3 py-1 text-xs font-semibold text-white"
                        >
                          Salvar
                        </button>
                      </div>
                    </div>
                  ) : confirmDeleteId === m.id ? (
                    <div>
                      <p className="text-sm text-[#6f5739]">Remover esta mensagem?</p>
                      <div className="mt-2 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-full px-2 py-1 text-xs text-[#687065]"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => void softDelete(m.id)}
                          disabled={deletingId === m.id}
                          className="rounded-full px-2 py-1 text-xs font-semibold text-[#9a5548]"
                        >
                          {deletingId === m.id ? "…" : "Remover"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className={"text-[15px] " + (removed ? "italic text-[#8b887f]" : "")}>
                        {removed ? (
                          <p>Mensagem removida</p>
                        ) : (
                          <WattpadMessage content={m.content || ""} />
                        )}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-black/5 pt-2 text-[10px] text-[#687065]">
                        <span>
                          {m.message_type === "author_note" ? "Comentário" : "História"} ·{" "}
                          {new Date(m.created_at).toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {m.edited_at ? " · editada" : ""}
                        </span>
                        {m.author_id === userId &&
                          (removed ? (
                            <button
                              type="button"
                              title="Recuperar esta mensagem"
                              aria-label="Recuperar esta mensagem"
                              onClick={() => void restoreMessage(m.id)}
                              disabled={deletingId === m.id}
                              className="rounded p-1 text-[#8b887f] transition hover:bg-black/5 hover:text-[#55704f]"
                            >
                              ↶
                            </button>
                          ) : (
                            <span className="flex items-center gap-1">
                              <button
                                type="button"
                                title="Editar esta mensagem"
                                aria-label="Editar esta mensagem"
                                onClick={() => {
                                  setEditingId(m.id)
                                  setEditValue(m.content || "")
                                  setEditMessageType(m.message_type)
                                }}
                                className="rounded p-1 text-[#8b887f] transition hover:bg-black/5 hover:text-[#55704f]"
                              >
                                ✎
                              </button>
                              <button
                                type="button"
                                title="Excluir esta mensagem"
                                aria-label="Excluir esta mensagem"
                                onClick={() => setConfirmDeleteId(m.id)}
                                className="rounded p-1 text-[#8b887f] transition hover:bg-black/5 hover:text-[#9a5548]"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                      </div>
                    </>
                  )}
                </article>
              )
            })
          )}
          {otherTyping && (
            <div className="sticky bottom-2 mx-auto w-fit rounded-full bg-[#fffdf8]/90 px-3 py-1 text-xs text-[#65735f] shadow-sm">
              Digitando…
            </div>
          )}
        </section>
        <footer className="border-t border-[#d5c9bd] bg-[#fffdf8] p-3 sm:p-4">
          <div className="mb-2 flex gap-2">
            <button
              onClick={() => setMessageType("story")}
              className={
                "rounded-full px-3 py-1 text-xs " +
                (message_type === "story" ? "bg-[#65735f] text-white" : "bg-[#eee8de]")
              }
            >
              História
            </button>
            <button
              onClick={() => setMessageType("author_note")}
              className={
                "rounded-full px-3 py-1 text-xs " +
                (message_type === "author_note" ? "bg-[#8d6d4c] text-white" : "bg-[#eee8de]")
              }
            >
              Comentário
            </button>
          </div>
          <div className="flex items-end gap-2">
            <div className="mb-2 flex gap-1">
              <button
                type="button"
                onClick={() => insertMarkup("composer", "**")}
                className="rounded-full bg-[#eee8de] px-2 py-1 text-[10px] font-bold"
              >
                B
              </button>
              <button
                type="button"
                onClick={() => insertMarkup("composer", "*")}
                className="rounded-full bg-[#eee8de] px-2 py-1 text-[10px] italic"
              >
                I
              </button>
              <button
                type="button"
                onClick={() => insertHeading("composer")}
                className="rounded-full bg-[#eee8de] px-2 py-1 text-[10px]"
              >
                T
              </button>
            </div>
            <textarea
              id="chat-composer"
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              rows={2}
              placeholder={
                message_type === "story"
                  ? "Escreva um trecho da história…"
                  : "Escreva uma observação…"
              }
              className="min-h-12 flex-1 resize-none rounded-2xl border border-[#d5c9bd] bg-white p-3 outline-none"
            />
            <button
              onClick={send}
              disabled={sending || !content.trim()}
              className="rounded-full bg-[#65735f] px-5 py-3 font-semibold text-white disabled:opacity-50"
            >
              {sending ? "…" : "Enviar"}
            </button>
          </div>
          <p className="mt-2 text-xs text-[#687065]">
            Enter envia · Shift+Enter quebra linha · rascunho salvo neste navegador
          </p>
        </footer>
      </div>
    </main>
  )
}
