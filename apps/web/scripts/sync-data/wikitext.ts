/**
 * Small, dependency-free helpers for reading the wikitext used by the
 * Naruto Fandom wiki infoboxes. Not a general MediaWiki parser: it only
 * understands what the infobox fields and article leads actually use.
 */

/** Stands in for commas that must not split a list (`<nowiki>,</nowiki>`). */
const LITERAL_COMMA = "\u0001"

export interface Template {
  name: string
  positional: string[]
  named: Record<string, string>
}

/** Splits `text` on `separator`, ignoring separators nested in {{ }} or [[ ]]. */
export function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = []
  let current = ""
  let braces = 0
  let brackets = 0
  for (let i = 0; i < text.length; i++) {
    const pair = text.slice(i, i + 2)
    if (pair === "{{" || pair === "}}" || pair === "[[" || pair === "]]") {
      if (pair === "{{") braces++
      if (pair === "}}") braces--
      if (pair === "[[") brackets++
      if (pair === "]]") brackets--
      current += pair
      i++
      continue
    }
    if (text[i] === separator && braces <= 0 && brackets <= 0) {
      parts.push(current)
      current = ""
      continue
    }
    current += text[i]
  }
  parts.push(current)
  return parts
}

/** Returns the first balanced `{{…}}` whose name starts with `prefix`. */
export function findTemplate(text: string, prefix: string): string | undefined {
  const lower = text.toLowerCase()
  let start = lower.indexOf("{{" + prefix.toLowerCase())
  while (start >= 0) {
    let depth = 0
    for (let i = start; i < text.length - 1; i++) {
      if (text.startsWith("{{", i)) {
        depth++
        i++
      } else if (text.startsWith("}}", i)) {
        depth--
        i++
        if (depth === 0) return text.slice(start, i + 1)
      }
    }
    start = lower.indexOf("{{" + prefix.toLowerCase(), start + 2)
  }
  return undefined
}

/** Every balanced `{{…}}` at the top level of `text`. */
export function topLevelTemplates(text: string): string[] {
  const found: string[] = []
  let depth = 0
  let start = -1
  for (let i = 0; i < text.length - 1; i++) {
    if (text.startsWith("{{", i)) {
      if (depth === 0) start = i
      depth++
      i++
    } else if (text.startsWith("}}", i) && depth > 0) {
      depth--
      i++
      if (depth === 0) found.push(text.slice(start, i + 1))
    }
  }
  return found
}

export function parseTemplate(template: string): Template {
  const [name = "", ...params] = splitTopLevel(template.slice(2, -2), "|")
  const positional: string[] = []
  const named: Record<string, string> = {}
  for (const param of params) {
    const eq = param.indexOf("=")
    // `=` inside a nested template or link does not make a named parameter.
    const head = eq >= 0 ? param.slice(0, eq) : ""
    if (eq >= 0 && !head.includes("{{") && !head.includes("[[")) {
      named[head.trim()] = param.slice(eq + 1).trim()
    } else {
      positional.push(param.trim())
    }
  }
  return { name: name.trim(), positional, named }
}

/** Removes comments, references and other markup that never carries data. */
export function stripNoise(text: string): string {
  return text
    .replace(/<!--[\s\S]*?(-->|$)/g, "")
    .replace(/<ref[^>/]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<nowiki>,<\/nowiki>/gi, LITERAL_COMMA)
    .replace(/<nowiki\s*\/>/gi, "")
    .replace(/<\/?nowiki>/gi, "")
    .replace(/<\/?noinclude>/gi, "")
    .replace(/<rt>[\s\S]*?<\/rt>/gi, "")
    .replace(/<rp>[\s\S]*?<\/rp>/gi, "")
    .replace(/<br\s*\/?>/gi, " ")
}

export interface Link {
  target: string
  display: string
}

/** If `text` is exactly one wiki link, returns it. */
export function singleLink(text: string): Link | undefined {
  const match = /^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/.exec(text.trim())
  if (!match) return undefined
  const target = (match[1] ?? "").trim()
  return { target, display: (match[2] ?? target).trim() }
}

function renderTemplate(template: string): string {
  const { name, positional } = parseTemplate(template)
  const lower = name.toLowerCase()
  if (lower === "translation" || lower === "nihongo") {
    return positional[0] ?? ""
  }
  if (lower === "w" || lower === "wp" || lower === "sic") {
    return positional[1] ?? positional[0] ?? ""
  }
  if (lower === "m" || lower === "manga" || lower === "anime") {
    return positional[0] ?? ""
  }
  // Layout and maintenance templates carry no text worth keeping.
  return ""
}

/** Converts inline wikitext into plain text. */
export function toPlainText(text: string): string {
  let out = stripNoise(text)
  // Innermost templates first, so nested ones collapse outward.
  for (let guard = 0; guard < 10 && out.includes("{{"); guard++) {
    out = out.replace(/\{\{([^{}]*)\}\}/g, (m) => renderTemplate(m))
  }
  out = out
    .replace(
      /\[\[(?:File|Image|Category):[^\]]*(?:\[\[[^\]]*\]\][^\]]*)*\]\]/gi,
      ""
    )
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[(?:Wikipedia:|wikipedia:)?([^\]]*)\]\]/g, "$1")
    .replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, "$1")
    .replace(/\[https?:\/\/[^\]]*\]/g, "")
    .replace(/'''?/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .trim()
  return out.split(LITERAL_COMMA).join(",")
}

/**
 * One entry of an infobox list. Entries look like `Value`, `Value~~Note` or
 * `Value~Detail~Detail`; `head` is the raw value, `rest` the raw details.
 */
export interface ListItem {
  head: string
  rest: string[]
}

export function parseList(value: string | undefined): ListItem[] {
  if (!value) return []
  return splitTopLevel(stripNoise(value), ",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => {
      const [head = "", ...rest] = splitTopLevel(item, "~")
      return { head: head.trim(), rest: rest.map((r) => r.trim()) }
    })
    .filter((item) => toPlainText(item.head).length > 0)
}

const SHORT_QUALIFIERS: Record<string, string> = {
  anime: "Anime only",
  manga: "Manga only",
  movie: "Movie only",
  game: "Game only",
  novel: "Novel only",
}

/** Joins the detail segments of a list item into a readable note. */
export function noteOf(parts: string[]): string | undefined {
  const text = parts
    .map((part) => toPlainText(part))
    .filter((part) => part.length > 0)
    .map((part) => SHORT_QUALIFIERS[part.toLowerCase()] ?? part)
    .join(", ")
  return text.length > 0 ? text : undefined
}

/**
 * The page a list value refers to, plus anything the link text adds
 * (e.g. `[[Black Zetsu|Black Zetsu (Yin half)]]` → "Black Zetsu", "Yin half").
 */
export function targetOf(raw: string): { title: string; extra?: string } {
  const link = singleLink(raw)
  if (!link) return { title: toPlainText(raw) }
  const display = toPlainText(link.display)
  const extra = /^.*?\(([^)]+)\)\s*$/.exec(display)
  if (extra && !link.target.includes("(")) {
    return { title: link.target, extra: extra[1] }
  }
  return { title: link.target }
}

export function fileName(raw: string): string {
  return raw
    .replace(/^(File|Image):/i, "")
    .replace(/:\d+px$/i, "")
    .replace(/‎/g, "")
    .trim()
}
