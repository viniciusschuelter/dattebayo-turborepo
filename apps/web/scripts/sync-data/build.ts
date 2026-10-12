import type {
  CharacterInterface,
  CharacterPersonal,
  CharacterRank,
  VoiceActors,
} from "../../interfaces/character.interface"
import type {
  AlternativeName,
  DebutInterface,
  Era,
  EraValues,
  MangaSeries,
  NamesInterface,
  Ref,
} from "../../interfaces/shared.interface"
import {
  fileName,
  type ListItem,
  noteOf,
  parseList,
  parseTemplate,
  splitTopLevel,
  stripNoise,
  targetOf,
  toPlainText,
  topLevelTemplates,
} from "./wikitext.ts"

export type Params = Record<string, string>

/**
 * Maps any spelling of a page title to its canonical title. During the first
 * pass it only records what is asked, so all titles can be resolved at once.
 */
export class Resolver {
  private canonicalTitles = new Map<string, string | undefined>()
  private existingTitles = new Set<string>()
  readonly seen = new Set<string>()

  addResolved(resolved: Map<string, string | undefined>): void {
    for (const [title, canonical] of resolved) {
      this.canonicalTitles.set(title, canonical)
      if (canonical) this.existingTitles.add(canonical)
    }
  }

  known(title: string): boolean {
    return this.canonicalTitles.has(title)
  }

  canonical(title: string): string {
    this.seen.add(title)
    return this.canonicalTitles.get(title) ?? title
  }

  /** Whether a canonical title is an existing wiki page. */
  exists(title: string): boolean {
    return this.existingTitles.has(title)
  }
}

/** An image reference before its file name is turned into a URL. */
export interface PendingImage {
  file: string
  caption?: string
}

export function get(params: Params, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = params[key]?.trim()
    if (value) return value
  }
  return undefined
}

export function plain(value: string | undefined): string | undefined {
  if (!value) return undefined
  const items = parseList(value).map((item) => {
    const note = noteOf(item.rest)
    const text = toPlainText(item.head)
    return note ? `${text} (${note})` : text
  })
  const text = items.join(", ")
  return text.length > 0 ? text : undefined
}

export function refOf(
  item: ListItem,
  resolver: Resolver,
  notes = item.rest
): Ref {
  const { title, extra } = targetOf(item.head)
  const note = noteOf([...(extra ? [extra] : []), ...notes])
  return { name: resolver.canonical(title), ...(note ? { note } : {}) }
}

export function refs(value: string | undefined, resolver: Resolver): Ref[] {
  return dedupeRefs(parseList(value).map((item) => refOf(item, resolver)))
}

/** List items that are free text (occupations, traits…) rather than links. */
export function textRefs(value: string | undefined): Ref[] {
  return dedupeRefs(
    parseList(value).map((item) => {
      const note = noteOf(item.rest)
      return { name: toPlainText(item.head), ...(note ? { note } : {}) }
    })
  )
}

export function dedupeRefs(list: Ref[]): Ref[] {
  const seen = new Set<string>()
  return list.filter((ref) => {
    if (!ref.name || seen.has(ref.name)) return false
    seen.add(ref.name)
    return true
  })
}

export function namesOf(params: Params, fallback: string): NamesInterface {
  const alternatives: AlternativeName[] = []
  for (const key of ["other", "other names"]) {
    const value = params[key]
    if (!value) continue
    for (const item of splitTopLevel(stripNoise(value), ",")) {
      const templates = topLevelTemplates(item).filter((t) =>
        /^\{\{\s*translation\s*\|/i.test(t)
      )
      if (templates.length === 0) {
        const name = toPlainText(item)
        if (name) alternatives.push({ name })
        continue
      }
      for (const template of templates) {
        const { positional, named } = parseTemplate(template)
        const name = unquote(toPlainText(positional[0] ?? ""))
        if (!name) continue
        alternatives.push(
          compact({
            name,
            kanji: unquote(toPlainText(positional[1] ?? "")) || undefined,
            romaji: unquote(toPlainText(positional[2] ?? "")) || undefined,
            literal: toPlainText(named["lit meaning"] ?? "") || undefined,
            englishTv: toPlainText(named["engtv"] ?? "") || undefined,
            viz: toPlainText(named["viz"] ?? "") || undefined,
          })
        )
      }
    }
  }
  return compact({
    english: plain(get(params, "english")) ?? fallback,
    kanji: plain(get(params, "kanji")),
    romaji: plain(get(params, "romaji")),
    literal: plain(get(params, "literal english", "literal")),
    englishTv: plain(get(params, "english tv", "engtv")),
    viz: plain(get(params, "viz manga", "viz")),
    alternatives,
  })
}

/** Drops quotes wrapped around a whole name: "…", 「…」, “…”. */
function unquote(text: string): string {
  return text.replace(/^(["“「『])(.*)(["”」』])$/u, "$2").trim()
}

export function imagesOf(value: string | undefined): PendingImage[] {
  if (!value) return []
  return stripNoise(value)
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [file = "", caption] = line.split(";")
      const cleanCaption = caption ? toPlainText(caption) : ""
      return {
        file: fileName(file),
        ...(cleanCaption ? { caption: cleanCaption } : {}),
      }
    })
    .filter((image) => /\.\w{3,4}$/.test(image.file))
}

export function mediaOf(params: Params): string[] {
  const value = get(params, "media", "jutsu media", "tool media")
  return [...new Set(textRefs(value).map((ref) => ref.name))]
}

const yes = (value: string | undefined) => value?.trim().toLowerCase() === "yes"

export function debutOf(params: Params): DebutInterface {
  const debut: DebutInterface = {}

  const manga = get(params, "manga debut", "debut manga")
  if (manga) {
    const [number = "", ...rest] = splitTopLevel(stripNoise(manga), "~")
    const series: MangaSeries = yes(params["boruto"])
      ? "Boruto"
      : yes(params["blue vortex"])
        ? "Boruto: Two Blue Vortex"
        : yes(params["sasuke retsuden"])
          ? "Sasuke Retsuden"
          : yes(params["konoha shinden"])
            ? "Konoha Shinden"
            : "Naruto"
    const type = plain(get(params, "manga type")) ?? "Chapter"
    const note = noteOf(rest)
    const value = toPlainText(number)
    if (value) {
      debut.manga = {
        series,
        type,
        number: value,
        ...(note ? { note } : {}),
        label: `${series} ${type} #${value}`,
      }
    }
  }

  const anime = get(params, "anime debut", "debut anime")
  if (anime) {
    const [number = "", ...rest] = splitTopLevel(stripNoise(anime), "~")
    const episode = Number.parseInt(toPlainText(number), 10)
    const series = yes(params["boruto anime"])
      ? "Boruto"
      : yes(get(params, "shippuden", "debut shippuden"))
        ? "Naruto Shippūden"
        : "Naruto"
    const note = noteOf(rest)
    if (Number.isFinite(episode)) {
      debut.anime = {
        series,
        episode,
        ...(note ? { note } : {}),
        label: `${series} Episode #${episode}`,
      }
    }
  }

  const novel = plain(get(params, "novel debut"))
  const movie = plain(get(params, "movie debut", "debut movie"))
  const game = plain(get(params, "game debut", "debut game"))
  const ova = plain(get(params, "ova debut"))
  return compact({ ...debut, novel, movie, game, ova })
}

/**
 * The lead of an article as plain text: the `summary` section when the wiki
 * marks one, otherwise the first prose paragraph.
 */
export function summaryOf(text: string | undefined): string | undefined {
  if (!text) return undefined
  const marked =
    /<section begin=["']?summary["']?\s*\/>([\s\S]*?)<section end=["']?summary["']?\s*\/>/i.exec(
      text
    )
  let lead = marked?.[1]
  if (!lead) {
    const intro = text.split(/\n==[^=]/)[0] ?? ""
    let prose = stripNoise(intro)
    for (const template of topLevelTemplates(prose)) {
      if (!/^\{\{\s*translation\s*\|/i.test(template)) {
        prose = prose.replace(template, "")
      }
    }
    lead = prose
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .find(
        (paragraph) =>
          paragraph.length > 0 &&
          !/^\[\[(File|Image|Category):/i.test(paragraph) &&
          !/^(\{\||\||!)/.test(paragraph) &&
          toPlainText(paragraph).length > 20
      )
  }
  if (!lead) return undefined
  const summary = toPlainText(lead.replace(/<section[^>]*\/>/gi, ""))
  return summary.length > 0 ? summary : undefined
}

const ERA_SUFFIXES: [string, Era][] = [
  ["part1", "Part I"],
  ["part2", "Part II"],
  ["last", "Blank Period"],
  ["part3", "New Era"],
  ["bmovie", "Boruto Movie"],
  ["bmanga", "Boruto Manga"],
]

function eraValues(
  params: Params,
  field: string,
  unit?: string
): EraValues | undefined {
  const values: EraValues = {}
  for (const [suffix, era] of ERA_SUFFIXES) {
    let value = plain(get(params, `${field}-${suffix}`))
    if (!value) continue
    if (unit) {
      value = value
        .replace(new RegExp(`\\s*${unit}\\b`, "g"), "")
        .replace(/(\d+(?:\.\d+)?)/g, `$1 ${unit}`)
    }
    values[era] = value
  }
  return Object.keys(values).length > 0 ? values : undefined
}

/** Everything about a character that does not need the other characters. */
export function buildCharacter(
  title: string,
  params: Params,
  resolver: Resolver
): {
  character: Omit<CharacterInterface, "id" | "images" | "source">
  images: PendingImage[]
} {
  const classification: Ref[] = []
  const tailedBeast: Ref[] = []
  const jinchuriki: Ref[] = []
  for (const item of parseList(params["classification"])) {
    const name = toPlainText(item.head)
    if (/^jinch[uū]riki$/i.test(name)) {
      tailedBeast.push(
        ...item.rest
          .filter(Boolean)
          .map((r) => refOf({ head: r, rest: [] }, resolver))
      )
      classification.push({ name })
    } else if (/^tailed beast$/i.test(name)) {
      jinchuriki.push(
        ...item.rest
          .filter(Boolean)
          .map((r) => refOf({ head: r, rest: [] }, resolver))
      )
      classification.push({ name })
    } else {
      const note = noteOf(item.rest)
      classification.push({ name, ...(note ? { note } : {}) })
    }
  }

  const personal: CharacterPersonal = compact({
    species: plain(params["species"]),
    sex: plain(params["gender"]),
    status: plain(get(params, "deceased state", "state")),
    birthdate: plain(params["birthdate"]),
    bloodType: plain(params["blood type"]),
    age: eraValues(params, "age"),
    height: eraValues(params, "height", "cm"),
    weight: eraValues(params, "weight", "kg"),
    classification: dedupeRefs(classification),
    occupation: textRefs(params["occupations"]),
    affiliation: refs(params["affiliations"], resolver),
    team: refs(get(params, "teams", "team"), resolver),
    partner: refs(params["partners"], resolver),
    clan: refs(params["clan"], resolver),
    kekkeiGenkai: refs(params["Kekkei Genkai"], resolver),
    kekkeiMora: refs(params["Kekkei Mora"], resolver),
    kekkeiTota: refs(params["Kekkei Tota"], resolver),
    tailedBeast: dedupeRefs(tailedBeast),
    jinchuriki: dedupeRefs(jinchuriki),
  })

  const rank: CharacterRank = compact({
    ninjaRank: eraValues(params, "rank"),
    ninjaRegistration: plain(params["ninja registration"]),
    academyGraduationAge: plain(params["academy age"]),
    chuninPromotionAge: plain(params["chunin age"]),
  })

  const voiceActors: VoiceActors = compact({
    japanese: textRefs(get(params, "japanese voice", "seiyū")),
    english: textRefs(params["english voice"]),
    spanish: textRefs(params["spanish voice"]),
    french: textRefs(params["french voice"]),
  })

  return {
    images: imagesOf(params["image name"]),
    character: compact({
      name: title,
      names: namesOf(params, title),
      debut: debutOf(params),
      media: mediaOf(params),
      personal,
      rank,
      natureType: refs(params["nature type"], resolver),
      uniqueTraits: textRefs(params["unique traits"]).map((r) =>
        r.note ? `${r.name} (${r.note})` : r.name
      ),
      voiceActors,
    }),
  }
}

/** A parent or explicit relationship read from a character infobox. */
export interface RawRelation {
  name: string
  relation?: string
  note?: string
}

export function parentsOf(params: Params, resolver: Resolver): RawRelation[] {
  return parseList(params["parents"]).map((item) => {
    // Some entries restate the role ("Sasori's Father~Father"); the role comes
    // from the parent's gender, so only keep real qualifiers as notes.
    const notes = item.rest.filter(
      (r) => !/^(father|mother|parent)$/i.test(toPlainText(r))
    )
    const ref = refOf(item, resolver, notes)
    return { name: ref.name, ...(ref.note ? { note: ref.note } : {}) }
  })
}

export function relationshipsOf(
  params: Params,
  resolver: Resolver
): RawRelation[] {
  return parseList(params["relationship"]).map((item) => {
    const [relation, ...rest] = item.rest
    const ref = refOf(item, resolver, rest)
    const relationText = relation ? toPlainText(relation) : undefined
    return {
      name: ref.name,
      ...(relationText ? { relation: relationText } : {}),
      ...(ref.note ? { note: ref.note } : {}),
    }
  })
}

/** Recursively drops undefined values, empty strings, arrays and objects. */
export function compact<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((v) => compact(v))
      .filter((v) => !isEmpty(v)) as unknown as T
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) {
      const c = compact(v)
      if (!isEmpty(c)) out[key] = c
    }
    return out as T
  }
  return value
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === "object") return Object.keys(value).length === 0
  return false
}
