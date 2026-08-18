import type { ReactNode } from "react"

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const pattern = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g
  const parts = text.split(pattern)

  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`
    if (
      (part.startsWith("**") && part.endsWith("**")) ||
      (part.startsWith("__") && part.endsWith("__"))
    ) {
      return <strong key={key}>{part.slice(2, -2)}</strong>
    }
    if (
      (part.startsWith("*") && part.endsWith("*")) ||
      (part.startsWith("_") && part.endsWith("_"))
    ) {
      return <em key={key}>{part.slice(1, -1)}</em>
    }
    return <span key={key}>{part}</span>
  })
}

function renderLines(lines: string[], keyPrefix: string): ReactNode[] {
  return lines.flatMap((line, index) => [
    ...(index ? [<br key={`${keyPrefix}-break-${index}`} />] : []),
    ...renderInline(line, `${keyPrefix}-${index}`),
  ])
}

export function renderWattpadMarkdown(markdown: string): ReactNode[] {
  const blocks = markdown
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)

  return blocks.map((block, blockIndex) => {
    const key = `block-${blockIndex}`
    const lines = block.split("\n")
    const heading = lines[0].match(/^(#{1,3})\s+(.+)$/)

    if (heading) {
      const Heading = heading[1].length === 1 ? "h2" : "h3"
      return (
        <Heading
          key={key}
          className="font-serif text-xl font-semibold leading-tight text-[#253126]"
        >
          {renderInline(heading[2], key)}
        </Heading>
      )
    }

    if (lines.every((line) => line.trimStart().startsWith(">"))) {
      return (
        <blockquote
          key={key}
          className="border-l-2 border-[#a89178] pl-4 font-serif italic leading-7 text-[#5d554b]"
        >
          {renderLines(
            lines.map((line) => line.replace(/^\s*>\s?/, "")),
            key,
          )}
        </blockquote>
      )
    }

    if (lines.every((line) => /^\s*(---|\*\s*\*\s*\*|___)\s*$/.test(line))) {
      return <hr key={key} className="border-[#d5c9bd]" />
    }

    return (
      <p key={key} className="font-serif text-[1.05rem] leading-8 text-[#253126]">
        {renderLines(lines, key)}
      </p>
    )
  })
}

export function WattpadPreview({ content }: { content: string }) {
  if (!content.trim())
    return (
      <p className="text-sm text-[#65735f]">
        O manuscrito aparecerá aqui após a primeira compilação.
      </p>
    )

  return (
    <article className="space-y-5 rounded-xl border border-[#e3d8cc] bg-white px-5 py-6 sm:px-8">
      {renderWattpadMarkdown(content)}
    </article>
  )
}

export function WattpadMessage({ content, muted = false }: { content: string; muted?: boolean }) {
  const blocks = content
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
  const textClass = muted ? "text-[#8b887f]" : "text-[#253126]"

  return (
    <div className={`space-y-2 ${textClass}`}>
      {blocks.map((block, blockIndex) => {
        const key = `message-block-${blockIndex}`
        const lines = block.split("\n")
        const heading = lines[0].match(/^(#{1,3})\s+(.+)$/)
        if (heading)
          return (
            <p key={key} className="font-semibold leading-6">
              {renderInline(heading[2], key)}
            </p>
          )
        if (lines.every((line) => line.trimStart().startsWith(">")))
          return (
            <p key={key} className="border-l-2 border-[#a89178] pl-2 italic leading-6">
              {renderLines(
                lines.map((line) => line.replace(/^\s*>\s?/, "")),
                key,
              )}
            </p>
          )
        if (lines.every((line) => /^\s*(---|\*\s*\*\s*\*|___)\s*$/.test(line)))
          return <div key={key} className="border-t border-current/20" />
        return (
          <p key={key} className="whitespace-pre-wrap leading-6">
            {renderLines(lines, key)}
          </p>
        )
      })}
    </div>
  )
}
