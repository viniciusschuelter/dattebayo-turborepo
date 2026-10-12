import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const API = "https://naruto.fandom.com/api.php"
const USER_AGENT =
  "dattebayo-sync-data/1.0 (Naruto dataset; polite bulk reader)"
const BATCH = 50
const DELAY_MS = 300

export const WIKI_BASE = "https://naruto.fandom.com/wiki/"

export interface WikiPage {
  title: string
  pageId: number
  text: string
  revision: string
}

type Params = Record<string, string>

/** The parts of MediaWiki API responses this script reads. */
interface TitleStep {
  from: string
  to: string
}

interface ApiPage {
  title: string
  pageid: number
  missing?: boolean
  invalid?: boolean
  revisions?: { timestamp: string; slots: { main: { content: string } } }[]
  imageinfo?: { url: string }[]
}

interface ApiQuery {
  pages?: ApiPage[]
  normalized?: TitleStep[]
  redirects?: TitleStep[]
  categorymembers?: { title: string }[]
}

interface ApiResponse {
  query: ApiQuery
  continue?: Record<string, string>
  error?: unknown
}

export class Wiki {
  private cacheDir: string
  private useCache: boolean
  private lastRequest = 0
  requests = 0

  constructor(cacheDir: string, useCache: boolean) {
    this.cacheDir = cacheDir
    this.useCache = useCache
  }

  /** Calls the MediaWiki API, caching every response on disk. */
  async api(params: Params): Promise<ApiResponse> {
    const query = new URLSearchParams({
      format: "json",
      formatversion: "2",
      ...params,
    }).toString()
    const file = path.join(
      this.cacheDir,
      createHash("sha1").update(query).digest("hex") + ".json"
    )
    if (this.useCache) {
      try {
        return JSON.parse(await readFile(file, "utf8"))
      } catch {
        // Not cached yet.
      }
    }
    for (let attempt = 1; ; attempt++) {
      const wait = this.lastRequest + DELAY_MS - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      this.lastRequest = Date.now()
      this.requests++
      try {
        const res = await fetch(`${API}?${query}`, {
          headers: { "User-Agent": USER_AGENT },
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as ApiResponse
        if (data.error) throw new Error(JSON.stringify(data.error))
        await mkdir(this.cacheDir, { recursive: true })
        await writeFile(file, JSON.stringify(data))
        return data
      } catch (error) {
        if (attempt >= 5) throw error
        await new Promise((r) => setTimeout(r, 2000 * attempt))
      }
    }
  }

  async categoryMembers(category: string): Promise<string[]> {
    const titles: string[] = []
    let cont: Params = {}
    for (;;) {
      const data = await this.api({
        action: "query",
        list: "categorymembers",
        cmtitle: `Category:${category}`,
        cmnamespace: "0",
        cmlimit: "500",
        ...cont,
      })
      titles.push(...(data.query.categorymembers ?? []).map((m) => m.title))
      if (!data.continue?.["cmcontinue"]) return titles
      cont = { cmcontinue: data.continue["cmcontinue"] }
    }
  }

  /** Current wikitext of each page that exists, keyed by requested title. */
  async pages(titles: string[]): Promise<Map<string, WikiPage>> {
    const result = new Map<string, WikiPage>()
    for (const batch of chunks(unique(titles), BATCH)) {
      const data = await this.api({
        action: "query",
        prop: "revisions",
        rvprop: "content|timestamp",
        rvslots: "main",
        redirects: "1",
        titles: batch.join("|"),
      })
      const aliases = aliasMap(data.query)
      const byTitle = new Map<string, WikiPage>()
      for (const page of data.query.pages ?? []) {
        const revision = page.revisions?.[0]
        if (page.missing || !revision) continue
        byTitle.set(page.title, {
          title: page.title,
          pageId: page.pageid,
          text: revision.slots.main.content,
          revision: revision.timestamp,
        })
      }
      for (const title of batch) {
        const page = byTitle.get(follow(aliases, title))
        if (page) result.set(title, page)
      }
    }
    return result
  }

  /**
   * Resolves titles through normalisation and redirects. Titles that do not
   * exist on the wiki map to `undefined`.
   */
  async resolve(titles: string[]): Promise<Map<string, string | undefined>> {
    const result = new Map<string, string | undefined>()
    for (const batch of chunks(unique(titles), BATCH)) {
      const data = await this.api({
        action: "query",
        redirects: "1",
        titles: batch.join("|"),
      })
      const aliases = aliasMap(data.query)
      const existing = new Set<string>(
        (data.query.pages ?? [])
          .filter((p) => !p.missing && !p.invalid)
          .map((p) => p.title)
      )
      for (const title of batch) {
        const target = follow(aliases, title)
        result.set(title, existing.has(target) ? target : undefined)
      }
    }
    return result
  }

  /** Direct URLs of uploaded files, keyed by the requested file name. */
  async imageUrls(files: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>()
    for (const batch of chunks(unique(files), BATCH)) {
      const data = await this.api({
        action: "query",
        prop: "imageinfo",
        iiprop: "url",
        redirects: "1",
        titles: batch.map((f) => `File:${f}`).join("|"),
      })
      const aliases = aliasMap(data.query)
      const urls = new Map<string, string>()
      for (const page of data.query.pages ?? []) {
        const url: string | undefined = page.imageinfo?.[0]?.url
        if (url) urls.set(page.title, url.replace(/\/revision\/latest.*$/, ""))
      }
      for (const file of batch) {
        const url = urls.get(follow(aliases, `File:${file}`))
        if (url) result.set(file, url)
      }
    }
    return result
  }
}

/** Maps every requested spelling of a title to the next title it becomes. */
function aliasMap(query: ApiQuery): Map<string, string> {
  const map = new Map<string, string>()
  for (const step of [
    ...(query.normalized ?? []),
    ...(query.redirects ?? []),
  ]) {
    map.set(step.from, step.to)
  }
  return map
}

function follow(aliases: Map<string, string>, title: string): string {
  let current = title
  for (let i = 0; i < 5 && aliases.has(current); i++) {
    current = aliases.get(current)!
  }
  return current
}

export function wikiUrl(title: string): string {
  return (
    WIKI_BASE +
    encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/g, "/")
  )
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size)
    out.push(values.slice(i, i + size))
  return out
}
