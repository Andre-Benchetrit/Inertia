"use client"

import { useCallback, useEffect, useState } from "react"
import {
  checkOllamaModel,
  getOllamaStatus,
  type OllamaModel,
  type OllamaStatus as OllamaStatusValue,
} from "@/lib/ollama-browser"

export default function OllamaStatus() {
  const [status, setStatus] = useState<OllamaStatusValue>({ available: false, models: [] })
  const [open, setOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (window.localStorage.getItem("inertia:ollama:model") ?? ""),
  )
  const [checking, setChecking] = useState(false)
  const [connectionMessage, setConnectionMessage] = useState("")

  const refresh = useCallback(async (showMessage = false) => {
    setChecking(true)
    if (showMessage) setConnectionMessage("")
    try {
      const storedModel = window.localStorage.getItem("inertia:ollama:model") ?? ""
      const baseStatus = await getOllamaStatus()
      const models = baseStatus.models
      const nextModel =
        (storedModel && models.some((item) => item.name === storedModel) ? storedModel : "") ||
        models.find((item) => /instruct/i.test(item.name))?.name ||
        models[0]?.name ||
        ""
      const modelCheck = nextModel
        ? await checkOllamaModel(nextModel)
        : { modelAvailable: false, modelWarning: null, recommendedModel: null }
      const next = {
        ...baseStatus,
        modelAvailable: modelCheck.modelAvailable,
        modelWarning: modelCheck.modelWarning,
        recommendedModel: modelCheck.recommendedModel,
      }
      setStatus(next)
      setSelectedModel(nextModel)
      if (nextModel && nextModel !== storedModel)
        window.localStorage.setItem("inertia:ollama:model", nextModel)
      if (showMessage) {
        setConnectionMessage(
          next.available
            ? (next.modelWarning ??
                (nextModel && next.modelAvailable
                  ? `Conexão confirmada: ${nextModel} disponível em localhost:11434.`
                  : "Ollama acessível, mas o modelo escolhido não foi encontrado."))
            : (next.error ?? "Ollama não está acessível em localhost:11434."),
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao testar a conexão."
      setStatus({ available: false, models: [], error: message })
      if (showMessage)
        setConnectionMessage(`Ollama não está acessível em localhost:11434. ${message}`)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  function selectModel(model: OllamaModel) {
    setSelectedModel(model.name)
    window.localStorage.setItem("inertia:ollama:model", model.name)
    setConnectionMessage("")
    void refresh()
  }

  const label = !status.available
    ? "IA local offline"
    : status.models.length
      ? "IA local online"
      : "Sem modelos"
  const dot = status.available && status.models.length ? "bg-[#b8e5a6]" : "bg-[#e7aaa1]"

  return (
    <div className="relative ml-auto text-right text-xs text-white/85">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-2.5 py-1 hover:bg-white/10"
        title="Configurar IA local"
      >
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
        <span>{label}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 w-72 rounded-xl border border-[#d9cfc3] bg-[#fffdf8] p-3 text-left text-[#253126] shadow-lg">
          <div className="flex items-center justify-between gap-3">
            <strong className="text-sm">Ollama local</strong>
            <button
              type="button"
              onClick={() => void refresh(true)}
              disabled={checking}
              className="text-xs text-[#65735f] disabled:opacity-50"
            >
              {checking ? "Testando..." : "Testar conex\u00e3o"}
            </button>
          </div>
          <p className="mt-1 text-xs text-[#65735f]">
            {status.available
              ? "Servidor local acess\u00edvel para a aplica\u00e7\u00e3o."
              : "Inicie o Ollama para habilitar a compila\u00e7\u00e3o local."}
          </p>
          {connectionMessage && (
            <p
              className={`mt-2 rounded-md px-2 py-1.5 text-xs ${status.available ? "bg-[#e4f2dc] text-[#36552d]" : "bg-[#f9e1dc] text-[#7b302b]"}`}
            >
              {connectionMessage}
            </p>
          )}
          {status.available && status.models.length > 0 ? (
            <label className="mt-3 block text-xs font-semibold text-[#65735f]">
              Modelo
              <select
                value={selectedModel}
                onChange={(event) => {
                  const selected = status.models.find((item) => item.name === event.target.value)
                  if (selected) selectModel(selected)
                }}
                className="mt-1 w-full rounded-lg border border-[#d9cfc3] bg-white px-2 py-1.5 text-sm font-normal text-[#253126]"
              >
                {status.models.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="mt-3 text-xs text-[#7b302b]">Nenhum modelo foi encontrado pelo Ollama.</p>
          )}
        </div>
      )}
    </div>
  )
}
