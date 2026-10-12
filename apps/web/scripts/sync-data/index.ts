/**
 * Rebuilds apps/web/data/*.json from the Naruto Fandom wiki
 * (https://naruto.fandom.com, CC BY-SA 3.0).
 *
 *   pnpm --filter web sync-data            # reuse cached API responses
 *   pnpm --filter web sync-data --refresh  # re-download everything
 *
 * Existing ids are preserved: records are matched to the current data by wiki
 * page id first, then by name, and only new records get new ids.
 */
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import type {
  AkatsukiInterface,
  AkatsukiRing,
} from "../../interfaces/akatsuki.interface"
import type {
  CharacterInterface,
  FamilyMember,
} from "../../interfaces/character.interface"
import type { ClanInterface } from "../../interfaces/clan.interface"
import type {
  KaraInterface,
  KaraMembership,
} from "../../interfaces/kara.interface"
import type { KekkeigenkaiInterface } from "../../interfaces/kekkeigenkai.interface"
import type {
  ImageInterface,
  Ref,
  ShinobiInterface,
  SourceInterface,
} from "../../interfaces/shared.interface"
import type { TailedInterface } from "../../interfaces/tailed.interface"
import type { TeamInterface } from "../../interfaces/team.interface"
import type {
  KageInterface,
  VillageInterface,
} from "../../interfaces/village.interface"
import {
  buildCharacter,
  compact,
  debutOf,
  dedupeRefs,
  get,
  imagesOf,
  mediaOf,
  namesOf,
  type Params,
  parentsOf,
  type PendingImage,
  plain,
  type RawRelation,
  refOf,
  refs,
  relationshipsOf,
  Resolver,
  summaryOf,
  textRefs,
} from "./build.ts"
import { Wiki, type WikiPage, wikiUrl } from "./wiki.ts"
import {
  fileName,
  findTemplate,
  parseList,
  parseTemplate,
  targetOf,
  toPlainText,
} from "./wikitext.ts"

const WEB_ROOT = path.resolve(import.meta.dirname, "../..")
const DATA_DIR = path.join(WEB_ROOT, "data")
const CACHE_DIR = path.join(WEB_ROOT, "node_modules/.cache/sync-data")

const TAILED_BEASTS: Record<string, [number, string]> = {
  Shukaku: [1, "One-Tails"],
  Matatabi: [2, "Two-Tails"],
  Isobu: [3, "Three-Tails"],
  "Son Gokū": [4, "Four-Tails"],
  Kokuō: [5, "Five-Tails"],
  Saiken: [6, "Six-Tails"],
  Chōmei: [7, "Seven-Tails"],
  Gyūki: [8, "Eight-Tails"],
  Kurama: [9, "Nine-Tails"],
  "Ten-Tails": [10, "Ten-Tails"],
}

const ORDINALS = [
  "First",
  "Second",
  "Third",
  "Fourth",
  "Fifth",
  "Sixth",
  "Seventh",
  "Eighth",
  "Ninth",
  "Tenth",
]

type GroupKind = "clans" | "teams" | "kekkeiGenkai"

const GROUP_TEMPLATES: Record<GroupKind, string> = {
  clans: "Infobox/Naruto/Clan",
  teams: "Infobox/Naruto/Team",
  kekkeiGenkai: "Infobox/Naruto/Genetic",
}

interface Existing {
  id: number
  name: string
  source?: { pageId?: number }
  /** v1 stored member ids, v2 stores references. */
  characters?: (number | Ref)[]
}

/** Hands out ids, reusing the ones already published whenever possible. */
class IdRegistry {
  private byPageId = new Map<number, number>()
  private byName = new Map<string, number[]>()
  private members = new Map<number, Set<number>>()
  private used = new Set<number>()
  private next: number

  constructor(existing: Existing[]) {
    for (const entry of existing) {
      if (entry.source?.pageId !== undefined) {
        this.byPageId.set(entry.source.pageId, entry.id)
      }
      // v1 group names carried qualifiers such as "Senju   (Anime only)".
      const name = normaliseName(entry.name.replace(/\s{2,}\(.*\)$/, ""))
      this.byName.set(name, [...(this.byName.get(name) ?? []), entry.id])
      this.members.set(
        entry.id,
        new Set(
          (entry.characters ?? []).map((c) =>
            typeof c === "number" ? c : (c.id ?? -1)
          )
        )
      )
    }
    this.next = Math.max(-1, ...existing.map((e) => e.id)) + 1
  }

  /** Claims an existing id for this record, by wiki page id or by name. */
  claim(pageId: number | undefined, names: string[]): number | undefined {
    return this.assign([{ pageId, names, members: [] }], false)[0]
  }

  /**
   * Like `claim` for a whole collection at once: every (record, old id)
   * pair is scored by shared members and the best pairs win, so the result
   * does not depend on the order records are built in.
   */
  assign(
    requests: { pageId?: number; names: string[]; members: number[] }[],
    fresh: true
  ): number[]
  assign(
    requests: { pageId?: number; names: string[]; members: number[] }[],
    fresh: false
  ): (number | undefined)[]
  assign(
    requests: { pageId?: number; names: string[]; members: number[] }[],
    fresh: boolean
  ): (number | undefined)[] {
    const ids: (number | undefined)[] = requests.map((r) => {
      const byPage =
        r.pageId !== undefined ? this.byPageId.get(r.pageId) : undefined
      return byPage !== undefined && !this.used.has(byPage)
        ? this.take(byPage)
        : undefined
    })
    const pairs = requests.flatMap((r, index) =>
      ids[index] !== undefined
        ? []
        : [
            ...new Set(
              r.names.flatMap((n) => this.byName.get(normaliseName(n)) ?? [])
            ),
          ].map((id, rank) => ({
            index,
            id,
            rank,
            score: r.members.filter((m) => this.members.get(id)?.has(m)).length,
          }))
    )
    pairs.sort(
      (a, b) => b.score - a.score || a.rank - b.rank || a.index - b.index
    )
    for (const pair of pairs) {
      if (ids[pair.index] === undefined && !this.used.has(pair.id))
        ids[pair.index] = this.take(pair.id)
    }
    return fresh ? ids.map((id) => id ?? this.fresh()) : ids
  }

  private take(id: number): number {
    this.used.add(id)
    return id
  }

  fresh(): number {
    while (this.used.has(this.next)) this.next++
    this.used.add(this.next)
    return this.next++
  }
}

function normaliseName(name: string): string {
  return name.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim()
}

async function readExisting(file: string): Promise<Existing[]> {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, file), "utf8"))
  } catch {
    return []
  }
}

function sourceOf(
  ...pages: (WikiPage | undefined)[]
): SourceInterface | undefined {
  const [main] = pages
  if (!main) return undefined
  const revision = pages
    .filter((p): p is WikiPage => p !== undefined)
    .map((p) => p.revision)
    .sort()
    .at(-1)!
  return { url: wikiUrl(main.title), pageId: main.pageId, revision }
}

function infoboxParams(
  page: WikiPage | undefined,
  prefix = "Infobox"
): Params | undefined {
  if (!page) return undefined
  const template = findTemplate(page.text, prefix)
  return template ? parseTemplate(template).named : undefined
}

/** Rows of every wikitable in `text`, as raw cell wikitext. */
function tableRows(text: string): string[][] {
  const rows: string[][] = []
  for (const table of text.split("{|").slice(1)) {
    const body = table.split("|}")[0] ?? ""
    for (const row of body.split(/\n\|-/).slice(1)) {
      const line = row
        .split("\n")
        .map((l) => l.trim())
        .filter(
          (l) => l.startsWith("|") && !l.startsWith("|+") && !l.startsWith("|-")
        )
        .join(" ")
      if (!line) continue
      rows.push(
        line
          .replace(/^\|/, "")
          .split("||")
          .map((cell) => cell.trim())
      )
    }
  }
  return rows
}

function section(text: string, heading: RegExp): string {
  const match = heading.exec(text)
  if (!match) return ""
  const level = /^=+/.exec(match[0])?.[0].length ?? 2
  const rest = text.slice(match.index + match[0].length)
  const end = new RegExp(`\\n={2,${level}}[^=]`).exec(rest)
  return end ? rest.slice(0, end.index) : rest
}

async function main(): Promise<void> {
  const refresh = process.argv.includes("--refresh")
  const wiki = new Wiki(CACHE_DIR, !refresh)
  const log = (message: string) => console.log(`[sync-data] ${message}`)

  // ---------------------------------------------------------------- download
  log("listing categories…")
  const [
    characterTitles,
    clanTitles,
    villageTitles,
    teamTitles,
    kgTitles,
    jutsuTitles,
    toolTitles,
  ] = (await Promise.all(
    [
      "Characters",
      "Clans",
      "Villages",
      "Teams",
      "Kekkei Genkai",
      "Jutsu",
      "Tools",
    ].map((c) => wiki.categoryMembers(c))
  )) as [string[], string[], string[], string[], string[], string[], string[]]

  log(`downloading ${characterTitles.length} characters…`)
  const articles = await wiki.pages(characterTitles)
  const infoboxes = await wiki.pages(characterTitles.map((t) => `Infobox:${t}`))
  log("downloading clans, villages, teams and kekkei genkai…")
  const groupPages = await wiki.pages([
    ...clanTitles,
    ...villageTitles,
    ...teamTitles,
    ...kgTitles,
  ])
  log(`downloading ${jutsuTitles.length} jutsu and ${toolTitles.length} tools…`)
  const jutsuPages = await wiki.pages(jutsuTitles)
  const toolPages = await wiki.pages(toolTitles)

  // Most characters keep their infobox on an "Infobox:" page; a few still
  // have it inline in the article.
  const characterParams = new Map<string, Params>()
  for (const title of characterTitles) {
    const params =
      infoboxParams(infoboxes.get(`Infobox:${title}`)) ??
      infoboxParams(articles.get(title), "Infobox/Naruto/Character")
    if (params) characterParams.set(title, params)
  }

  // Village leaders (Hokage, Kazekage…) have their own list articles.
  const leaderTitles = villageTitles
    .map((t) => infoboxParams(groupPages.get(t)))
    .map((p) => (p ? targetOf(p["leader"] ?? "").title : ""))
    .filter((t) => /kage$/i.test(t))
  const leaderPages = await wiki.pages(leaderTitles)

  // --------------------------------------------------------------- resolving
  // Pass 1 records every title the data refers to; resolve them in bulk.
  const resolver = new Resolver()
  const extraTitles: Record<GroupKind, string[]> = {
    clans: [],
    teams: [],
    kekkeiGenkai: [],
  }
  const resolveAll = async () => {
    buildEverything()
    const pending = [...resolver.seen].filter((t) => !resolver.known(t))
    log(`resolving ${pending.length} referenced titles…`)
    resolver.addResolved(await wiki.resolve(pending))
    return buildEverything()
  }
  let result = await resolveAll()

  // Some clans, teams and kekkei genkai that characters mention live outside
  // their category (Dust Release is a kekkei tōta, for example). Use those
  // articles when they carry the matching infobox instead of keeping a stub.
  const stubPages = await wiki.pages(
    Object.values(result.stubs)
      .flat()
      .filter((name) => resolver.exists(name))
  )
  for (const kind of Object.keys(extraTitles) as GroupKind[]) {
    for (const name of result.stubs[kind]) {
      const page = stubPages.get(name)
      if (page && findTemplate(page.text, GROUP_TEMPLATES[kind])) {
        groupPages.set(name, page)
        extraTitles[kind].push(name)
      }
    }
  }
  if (Object.values(extraTitles).some((list) => list.length > 0)) {
    result = await resolveAll()
  }

  // ------------------------------------------------------------------ images
  const files = new Set<string>()
  for (const list of result.pendingImages.values())
    list.forEach((i) => files.add(i.file))
  for (const symbol of result.villageSymbols.values()) files.add(symbol)
  log(`resolving ${files.size} image urls…`)
  const urls = await wiki.imageUrls([...files])
  const imagesFor = (entity: object): ImageInterface[] =>
    (result.pendingImages.get(entity) ?? [])
      .map((image) => {
        const url = urls.get(image.file)
        return url
          ? { url, ...(image.caption ? { caption: image.caption } : {}) }
          : undefined
      })
      .filter((image): image is ImageInterface => image !== undefined)
  const withImages = <T extends ShinobiInterface>(entity: T): T =>
    orderKeys({ ...entity, images: imagesFor(entity) })

  const characters = result.characters.map(withImages)
  const tailedBeasts = result.tailedBeasts.map(withImages)
  const akatsuki = result.akatsuki.map(withImages)
  const kara = result.kara.map(withImages)
  const clans = result.clans.map(withImages)
  const teams = result.teams.map(withImages)
  const kekkeiGenkai = result.kekkeiGenkai.map(withImages)
  const villages = result.villages.map((village) => {
    const symbol = result.villageSymbols.get(village)
    const symbolUrl = symbol ? urls.get(symbol) : undefined
    return withImages({
      ...village,
      ...(symbolUrl ? { symbol: { url: symbolUrl } } : {}),
    })
  })

  // ------------------------------------------------------------------ output
  const outputs: [string, ShinobiInterface[]][] = [
    ["characters.json", characters],
    ["tailed-beasts.json", tailedBeasts],
    ["akatsuki.json", akatsuki],
    ["kara.json", kara],
    ["clans.json", clans],
    ["teams.json", teams],
    ["villages.json", villages],
    ["kekkei-genkai.json", kekkeiGenkai],
  ]
  for (const [file, records] of outputs) {
    const sorted = [...records].sort((a, b) => a.id - b.id)
    await writeFile(
      path.join(DATA_DIR, file),
      JSON.stringify(sorted, null, 2) + "\n"
    )
    log(`wrote ${file} (${sorted.length} records)`)
  }
  for (const line of result.report) log(line)
  log(
    `done — ${wiki.requests} API requests (${refresh ? "fresh" : "cache allowed"})`
  )

  // --------------------------------------------------------------- builders
  function buildEverything() {
    const report: string[] = []
    const pendingImages = new Map<object, PendingImage[]>()
    const stubs: Record<GroupKind, string[]> = {
      clans: [],
      teams: [],
      kekkeiGenkai: [],
    }

    // Characters ------------------------------------------------------------
    const characterIds = new IdRegistry(existing.characters)
    const characterByTitle = new Map<string, CharacterInterface>()
    const parents = new Map<string, RawRelation[]>()
    const relationships = new Map<string, RawRelation[]>()

    for (const title of characterTitles) {
      const params = characterParams.get(title)
      const article = articles.get(title)
      if (!params || !article) {
        report.push(`skipped character without infobox: ${title}`)
        continue
      }
      const { character, images } = buildCharacter(title, params, resolver)
      const id =
        characterIds.claim(article.pageId, [title]) ??
        newIds.characters.get(title) ??
        characterIds.fresh()
      newIds.characters.set(title, id)
      const record = compact({
        id,
        ...character,
        summary: summaryOf(article.text),
        source: sourceOf(article, infoboxes.get(`Infobox:${title}`)),
      }) as CharacterInterface
      record.personal ??= {}
      pendingImages.set(record, images)
      characterByTitle.set(title, record)
      parents.set(title, parentsOf(params, resolver))
      relationships.set(title, relationshipsOf(params, resolver))
    }

    const characterId = (name: string) => characterByTitle.get(name)?.id
    const linkCharacters = (list: Ref[] | undefined) =>
      list?.map((ref) => withId(ref, characterId(ref.name)))

    // Family ----------------------------------------------------------------
    const children = new Map<string, string[]>()
    for (const [child, list] of parents) {
      for (const parent of list) {
        children.set(parent.name, [...(children.get(parent.name) ?? []), child])
      }
    }
    // Like the wiki's own family tree, relatives are derived from the
    // `parents` field of every character; qualifiers such as "Anime only"
    // travel along the chain (an anime-only mother is an anime-only
    // grandmother too). Explicit `relationship` entries are added last.
    interface Kin {
      name: string
      notes: string[]
    }
    const sexOf = (name: string) => characterByTitle.get(name)?.personal.sex
    const label = (
      name: string,
      male: string,
      female: string,
      other: string
    ) =>
      sexOf(name) === "Male" ? male : sexOf(name) === "Female" ? female : other
    const noteOfEdge = (child: string, parent: string) =>
      (parents.get(child) ?? []).find((p) => p.name === parent)?.note
    const withNote = (notes: string[], note: string | undefined) =>
      note && !notes.includes(note) ? [...notes, note] : notes
    const up = (kin: Kin): Kin[] =>
      (parents.get(kin.name) ?? []).map((p) => ({
        name: p.name,
        notes: withNote(kin.notes, p.note),
      }))
    const down = (kin: Kin): Kin[] =>
      (children.get(kin.name) ?? []).map((c) => ({
        name: c,
        notes: withNote(kin.notes, noteOfEdge(c, kin.name)),
      }))
    const siblings = (kin: Kin): (Kin & { half: boolean })[] => {
      const mine = (parents.get(kin.name) ?? []).map((p) => p.name)
      const found = new Map<string, Kin & { half: boolean }>()
      for (const parent of up(kin)) {
        for (const sibling of down(parent)) {
          if (sibling.name === kin.name) continue
          const theirs = (parents.get(sibling.name) ?? []).map((p) => p.name)
          const half =
            mine.length >= 2 &&
            theirs.length >= 2 &&
            !mine.every((p) => theirs.includes(p))
          const previous = found.get(sibling.name)
          found.set(sibling.name, {
            ...sibling,
            half: half || (previous?.half ?? false),
          })
        }
      }
      return [...found.values()]
    }

    for (const [title, character] of characterByTitle) {
      const family: FamilyMember[] = []
      const add = (kin: Kin, relation: string) => {
        if (kin.name === title || family.some((m) => m.name === kin.name))
          return
        const adoptive = kin.notes.some((n) => /^adopt/i.test(n))
        const notes = kin.notes.filter((n) => !/^adopt/i.test(n))
        family.push(
          compact({
            relation:
              adoptive && !/^adoptive/i.test(relation)
                ? `Adoptive ${relation.toLowerCase()}`
                : relation,
            id: characterId(kin.name),
            name: kin.name,
            note: notes.join(", "),
          }) as FamilyMember
        )
      }
      const self: Kin = { name: title, notes: [] }
      const parentsOfSelf = up(self)
      const grandparents = parentsOfSelf.flatMap(up)
      for (const p of parentsOfSelf)
        add(p, label(p.name, "Father", "Mother", "Parent"))
      for (const g of grandparents)
        add(g, label(g.name, "Grandfather", "Grandmother", "Grandparent"))
      for (const g of grandparents.flatMap(up))
        add(
          g,
          label(
            g.name,
            "Great-Grandfather",
            "Great-Grandmother",
            "Great-Grandparent"
          )
        )
      for (const s of siblings(self)) {
        add(
          s,
          s.half
            ? label(s.name, "Half-brother", "Half-sister", "Half-sibling")
            : label(s.name, "Brother", "Sister", "Sibling")
        )
      }
      for (const p of parentsOfSelf) {
        for (const u of siblings(p)) {
          add(u, label(u.name, "Uncle", "Aunt", "Parent's sibling"))
          for (const c of down(u)) add(c, "Cousin")
        }
      }
      for (const g of grandparents) {
        for (const u of siblings(g))
          add(
            u,
            label(u.name, "Granduncle", "Grandaunt", "Grandparent's sibling")
          )
      }
      const kids = down(self)
      for (const c of kids) add(c, label(c.name, "Son", "Daughter", "Child"))
      for (const c of kids.flatMap(down))
        add(c, label(c.name, "Grandson", "Granddaughter", "Grandchild"))
      for (const c of kids.flatMap(down).flatMap(down))
        add(
          c,
          label(
            c.name,
            "Great-Grandson",
            "Great-Granddaughter",
            "Great-Grandchild"
          )
        )
      for (const s of siblings(self)) {
        for (const n of down(s)) {
          add(n, label(n.name, "Nephew", "Niece", "Sibling's child"))
          for (const g of down(n))
            add(
              g,
              label(g.name, "Grandnephew", "Grandniece", "Sibling's grandchild")
            )
        }
      }
      for (const relation of relationships.get(title) ?? []) {
        add(
          { name: relation.name, notes: relation.note ? [relation.note] : [] },
          relation.relation ?? "Relative"
        )
      }
      // As on the wiki: a relative who only exists in one medium the
      // character is not limited to gets an "Anime only"-style note.
      const ownMedia = (character.media ?? []).join(", ")
      for (const member of family) {
        const media = characterByTitle.get(member.name)?.media ?? []
        const only = media.length === 1 ? media[0] : undefined
        if (
          only &&
          ["Anime", "Manga", "Novel"].includes(only) &&
          ownMedia !== only
        ) {
          const note = `${only} only`
          if (!member.note?.includes(note))
            member.note = member.note ? `${member.note}, ${note}` : note
        }
      }
      if (family.length > 0) character.family = family

      const personal = character.personal
      personal.partner = linkCharacters(personal.partner)
      personal.jinchuriki = linkCharacters(personal.jinchuriki)
    }

    // Jutsu and tools are listed with their users; invert that. -------------
    const invertUsers = (
      pages: Map<string, WikiPage>,
      prefix: string,
      field: "jutsu" | "tools"
    ) => {
      const seen = new Set<string>()
      for (const page of pages.values()) {
        if (seen.has(page.title)) continue
        seen.add(page.title)
        const params = infoboxParams(page, prefix)
        if (!params) continue
        for (const item of parseList(params["users"])) {
          const user = refOf(item, resolver)
          const character = characterByTitle.get(user.name)
          if (!character) continue
          const list = (character[field] ??= [])
          if (!list.some((r) => r.name === page.title)) {
            list.push({
              name: page.title,
              ...(user.note ? { note: user.note } : {}),
            })
          }
        }
      }
      for (const character of characterByTitle.values()) {
        character[field]?.sort((a, b) => a.name.localeCompare(b.name))
      }
    }
    invertUsers(jutsuPages, "Infobox/Jutsu", "jutsu")
    invertUsers(toolPages, "Infobox/Tools", "tools")

    // Groups ----------------------------------------------------------------
    // Members come from the character infoboxes; each field may hold a
    // qualifier ("Anime only") that is kept on the member reference.
    const membersBy = (pick: (c: CharacterInterface) => Ref[] | undefined) => {
      const members = new Map<string, Ref[]>()
      for (const character of characterByTitle.values()) {
        for (const ref of pick(character) ?? []) {
          const list = members.get(ref.name) ?? []
          if (!list.some((m) => m.id === character.id)) {
            list.push(
              compact({
                id: character.id,
                name: character.name,
                note: ref.note,
              })
            )
          }
          members.set(ref.name, list)
        }
      }
      for (const list of members.values())
        list.sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
      return members
    }

    interface GroupDraft<T> {
      title: string
      page?: WikiPage
      params: Params
      record: T
    }

    /**
     * One record per wiki page in the category, plus a stub for every name
     * characters refer to that has no page there (so no membership is lost).
     */
    function buildGroups<T extends ShinobiInterface & { characters: Ref[] }>(
      kind: "villages" | GroupKind,
      titles: string[],
      members: Map<string, Ref[]>,
      extra: (params: Params, title: string) => Partial<T>,
      allowStubs: boolean
    ): GroupDraft<T>[] {
      const drafts: GroupDraft<T>[] = []
      const requests: {
        pageId?: number
        names: string[]
        members: number[]
      }[] = []
      const covered = new Set<string>()
      const memberIdsOf = (name: string) =>
        (members.get(name) ?? []).flatMap((m) =>
          m.id === undefined ? [] : [m.id]
        )
      for (const title of titles) {
        const page = groupPages.get(title)
        if (!page || covered.has(page.title)) continue
        covered.add(page.title)
        const params = infoboxParams(page) ?? {}
        const names = namesOf(params, page.title)
        const aliases = [
          page.title,
          names.english ?? "",
          ...namesBy(members, resolver, page.title),
        ]
        requests.push({
          pageId: page.pageId,
          names: aliases,
          members: memberIdsOf(page.title),
        })
        const record = compact({
          id: -1,
          name: page.title,
          names,
          summary: summaryOf(page.text),
          debut: debutOf(params),
          media: mediaOf(params),
          ...extra(params, page.title),
          characters: members.get(page.title) ?? [],
          source: sourceOf(page),
        }) as unknown as T
        record.characters ??= []
        pendingImages.set(record, imagesOf(get(params, "image name", "image")))
        drafts.push({ title: page.title, page, params, record })
      }
      if (allowStubs) {
        for (const [name, list] of members) {
          if (covered.has(name) || list.length === 0) continue
          requests.push({ names: [name], members: memberIdsOf(name) })
          const record = {
            id: -1,
            name,
            images: [],
            characters: list,
          } as unknown as T
          drafts.push({ title: name, params: {}, record })
          if (kind !== "villages") stubs[kind].push(name)
          report.push(
            `${kind}: "${name}" has no wiki article of its own; kept with its ${list.length} member(s) only`
          )
        }
      }
      const ids = new IdRegistry(existing[kind]).assign(requests, true)
      drafts.forEach((draft, index) => {
        draft.record.id = ids[index]!
      })
      return drafts
    }

    const clanMembers = membersBy((c) => c.personal.clan)
    const teamMembers = membersBy((c) => [
      ...(c.personal.team ?? []),
      // Organisations such as Akatsuki are teams on the wiki but appear
      // under affiliations in character infoboxes.
      ...(c.personal.affiliation ?? []).filter((a) =>
        teamTitles.includes(a.name)
      ),
    ])
    const villageMembers = membersBy((c) =>
      (c.personal.affiliation ?? []).filter((a) =>
        villageTitles.includes(a.name)
      )
    )
    const kgMembers = membersBy((c) => [
      ...(c.personal.kekkeiGenkai ?? []),
      ...(c.personal.kekkeiMora ?? []),
      ...(c.personal.kekkeiTota ?? []),
    ])

    const villages = buildGroups<VillageInterface>(
      "villages",
      villageTitles,
      villageMembers,
      (params) => {
        const ratings = compact({
          population: rating(params["population"]),
          military: rating(params["military"]),
          economy: rating(params["economy"]),
        })
        // `leader` holds either a title ("Hokage") or the leaders themselves.
        const leaderRefs = refs(params["leader"], resolver)
        const people = leaderRefs.filter((r) => characterByTitle.has(r.name))
        const titles = leaderRefs.filter((r) => !characterByTitle.has(r.name))
        return compact({
          country: plain(params["country"]),
          leaderTitle: titles
            .map((r) => (r.note ? `${r.name} (${r.note})` : r.name))
            .join(", "),
          leaders: linkCharacters(people),
          ratings,
        })
      },
      false
    )

    const clans = buildGroups<ClanInterface>(
      "clans",
      [...clanTitles, ...extraTitles.clans],
      clanMembers,
      (params) => ({
        affiliation: refs(params["affiliations"], resolver),
        kekkeiGenkai: refs(get(params, "Kekkei Genkai"), resolver),
      }),
      true
    )

    const teams = buildGroups<TeamInterface>(
      "teams",
      [...teamTitles, ...extraTitles.teams],
      teamMembers,
      (params) => ({
        affiliation: refs(params["affiliations"], resolver),
        leaders: refs(params["leaders"], resolver),
        status: plain(params["status"]),
      }),
      true
    )

    const kekkeiGenkai = buildGroups<KekkeigenkaiInterface>(
      "kekkeiGenkai",
      [...kgTitles, ...extraTitles.kekkeiGenkai],
      kgMembers,
      (params, title) => ({
        classification: textRefs(params["jutsu classification"]).map(
          (r) => r.name
        ),
        natureTypes: refs(params["jutsu type"], resolver),
        clans: dedupeRefs([
          ...refs(params["clan"], resolver),
          ...[...groupPages.values()]
            .filter((p) =>
              (infoboxParams(p)
                ? refs(get(infoboxParams(p)!, "Kekkei Genkai"), resolver)
                : []
              ).some((r) => r.name === title)
            )
            .map((p) => ({ name: p.title })),
        ]),
      }),
      true
    )

    // Cross-links between collections. ---------------------------------------
    const idIndex = (drafts: GroupDraft<ShinobiInterface>[]) =>
      new Map(drafts.map((d) => [d.record.name, d.record.id]))
    const villageIds = idIndex(villages)
    const clanIds = idIndex(clans)
    const teamIds = idIndex(teams)
    const kgIds = idIndex(kekkeiGenkai)
    const link = (list: Ref[] | undefined, ids: Map<string, number>) =>
      list?.map((ref) => withId(ref, ids.get(ref.name)))

    for (const character of characterByTitle.values()) {
      const p = character.personal
      p.affiliation = link(p.affiliation, villageIds)
      p.team = link(p.team, teamIds)
      p.clan = link(p.clan, clanIds)
      p.kekkeiGenkai = link(p.kekkeiGenkai, kgIds)
      p.kekkeiMora = link(p.kekkeiMora, kgIds)
      p.kekkeiTota = link(p.kekkeiTota, kgIds)
      p.tailedBeast = linkCharacters(p.tailedBeast)
    }
    for (const { record } of clans) {
      record.affiliation = link(record.affiliation, villageIds)
      record.kekkeiGenkai = link(record.kekkeiGenkai, kgIds)
    }
    for (const { record } of teams) {
      record.affiliation = link(record.affiliation, villageIds)
      record.leaders = linkCharacters(record.leaders)
    }
    for (const { record } of kekkeiGenkai) {
      record.clans = link(record.clans, clanIds)
    }

    // Kage ------------------------------------------------------------------
    const villageSymbols = new Map<object, string>()
    for (const { record, params } of villages) {
      const symbol = params["symbol"]
      if (symbol) villageSymbols.set(record, fileName(symbol))
      const leader = record.leaderTitle
        ? leaderPages.get(targetOf(params["leader"] ?? "").title)
        : undefined
      if (!leader) continue
      const list = section(leader.text, /^==\s*List of[^=]*==\s*$/m)
      const kage: KageInterface[] = []
      const heading = /^===\s*(\w+)\s+([^=]+?)\s*===\s*$/gm
      for (let m = heading.exec(list); m; m = heading.exec(list)) {
        const order = ORDINALS.indexOf(m[1] ?? "") + 1
        if (order === 0) continue
        const body = list.slice(m.index + m[0].length).split(/\n===/)[0] ?? ""
        const main = /\{\{\s*Main with-include\s*\|([^}|]+)/i.exec(body)
        if (!main?.[1]) continue
        const name = resolver.canonical(main[1].replace(/‎/g, "").trim())
        kage.push(
          compact({
            order,
            title: `${m[1]} ${(m[2] ?? "").trim()}`,
            id: characterId(name),
            name,
          })
        )
      }
      if (kage.length > 0) record.kage = kage
    }

    // Organisations -------------------------------------------------------------
    const memberOf = (organisation: string) =>
      [...characterByTitle.values()].filter((c) =>
        [...(c.personal.affiliation ?? []), ...(c.personal.team ?? [])].some(
          (r) => r.name === organisation
        )
      )
    const noteFor = (character: CharacterInterface, organisation: string) =>
      [
        ...(character.personal.affiliation ?? []),
        ...(character.personal.team ?? []),
      ].find((r) => r.name === organisation)?.note

    const rings = akatsukiRings(groupPages.get("Akatsuki"), resolver)
    const akatsuki: AkatsukiInterface[] = memberOf("Akatsuki").map(
      (character) => {
        const ring = rings.find((r) => r.wornBy.includes(character.name))
        return {
          ...character,
          akatsuki: compact({ note: noteFor(character, "Akatsuki"), ring }),
        }
      }
    )

    const roster = karaRoster(groupPages.get("Kara"), resolver)
    const karaMembers = new Map(memberOf("Kara").map((c) => [c.name, c]))
    for (const name of roster.keys()) {
      const character = characterByTitle.get(name)
      if (character) karaMembers.set(name, character)
    }
    const kara: KaraInterface[] = [...karaMembers.values()].map(
      (character) => ({
        ...character,
        kara: compact({
          ...roster.get(character.name),
          note: roster.get(character.name)?.note ?? noteFor(character, "Kara"),
        }),
      })
    )

    const tailedBeasts: TailedInterface[] = Object.entries(
      TAILED_BEASTS
    ).flatMap(([name, [tails, numberName]]) => {
      const character = characterByTitle.get(name)
      return character ? [{ ...character, tails, numberName }] : []
    })
    // The organisation records share the character's images.
    for (const record of [...akatsuki, ...kara, ...tailedBeasts]) {
      const original = characterByTitle.get(record.name)
      if (original) pendingImages.set(record, pendingImages.get(original) ?? [])
    }

    // Report ------------------------------------------------------------------
    const kept = new Set([...characterByTitle.values()].map((c) => c.id))
    for (const old of existing.characters) {
      if (!kept.has(old.id))
        report.push(
          `removed character ${old.id} "${old.name}" (no longer on the wiki, or a duplicate)`
        )
    }
    report.push(
      `${[...characterByTitle.values()].filter((c) => !existing.characters.some((o) => o.id === c.id)).length} new characters`
    )

    return {
      characters: [...characterByTitle.values()],
      tailedBeasts,
      akatsuki,
      kara,
      clans: clans.map((d) => d.record),
      teams: teams.map((d) => d.record),
      villages: villages.map((d) => d.record),
      kekkeiGenkai: kekkeiGenkai.map((d) => d.record),
      villageSymbols,
      pendingImages,
      stubs,
      report,
    }
  }
}

const existing = {
  characters: await readExisting("characters.json"),
  clans: await readExisting("clans.json"),
  teams: await readExisting("teams.json"),
  villages: await readExisting("villages.json"),
  kekkeiGenkai: await readExisting("kekkei-genkai.json"),
}
/** Ids handed out during the first pass, so both passes agree. */
const newIds = { characters: new Map<string, number>() }

/** Output key order: identity first, relations in the middle, source last. */
const KEY_ORDER = [
  "id",
  "name",
  "images",
  "names",
  "summary",
  "tails",
  "numberName",
  "akatsuki",
  "kara",
  "country",
  "leaderTitle",
  "leaders",
  "symbol",
  "ratings",
  "kage",
  "classification",
  "natureTypes",
  "status",
  "affiliation",
  "leaders",
  "kekkeiGenkai",
  "clans",
  "debut",
  "media",
  "personal",
  "rank",
  "family",
  "natureType",
  "jutsu",
  "tools",
  "uniqueTraits",
  "voiceActors",
  "characters",
]

function orderKeys<T extends object>(record: T): T {
  const entries = Object.entries(record)
  const rank = (key: string) => {
    if (key === "source") return Number.MAX_SAFE_INTEGER
    const index = KEY_ORDER.indexOf(key)
    return index === -1 ? KEY_ORDER.length : index
  }
  entries.sort(([a], [b]) => rank(a) - rank(b))
  return Object.fromEntries(entries) as T
}

function withId(ref: Ref, id: number | undefined): Ref {
  return id === undefined ? ref : { id, ...ref }
}

function rating(value: string | undefined): number | undefined {
  const match = /^(\d)\s*\/\s*5$/.exec(value?.trim() ?? "")
  return match ? Number(match[1]) : undefined
}

/** Raw names characters use for `title` (e.g. "Team Kakashi" for "Team 7 (Kakashi)"). */
function namesBy(
  _members: Map<string, Ref[]>,
  resolver: Resolver,
  title: string
): string[] {
  return [...resolver.seen].filter(
    (raw) => raw !== title && resolver.canonical(raw) === title
  )
}

function akatsukiRings(
  page: WikiPage | undefined,
  resolver: Resolver
): AkatsukiRing[] {
  if (!page) return []
  const rings: AkatsukiRing[] = []
  const text = section(page.text, /^===\s*Rings\s*===\s*$/m)
  for (const line of text.split("\n")) {
    const match =
      /^\*\s*([^:]+):\s*(\{\{[\s\S]*?\}\})\s*;\s*worn by([\s\S]*?)\.\s*Its colou?r is ([^.]+)\./i.exec(
        line
      )
    if (!match) continue
    const { positional } = parseTemplate(match[2] ?? "")
    const wornBy = [
      ...(match[3] ?? "").matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g),
    ].map((m) => resolver.canonical((m[1] ?? "").trim()))
    rings.push({
      finger: (match[1] ?? "").trim(),
      kanji: toPlainText(positional[1] ?? ""),
      romaji: toPlainText(positional[2] ?? ""),
      meaning: toPlainText(positional[0] ?? "").replace(/"/g, ""),
      colour: (match[4] ?? "").trim(),
      wornBy,
    })
  }
  return rings
}

function karaRoster(
  page: WikiPage | undefined,
  resolver: Resolver
): Map<string, KaraMembership> {
  const roster = new Map<string, KaraMembership>()
  if (!page) return roster
  const groups: [RegExp, KaraMembership["rank"]][] = [
    [/^====\s*Inners\s*====\s*$/gm, "Inner"],
    [/^====\s*Outers\s*====\s*$/gm, "Outer"],
    [/^====\s*Other Members\s*====\s*$/gm, "Other"],
  ]
  for (const [heading, rank] of groups) {
    // Isshiki's Kara is listed first, Code's after: later rows update status.
    for (let m = heading.exec(page.text); m; m = heading.exec(page.text)) {
      const body = page.text.slice(m.index + m[0].length).split(/\n==/)[0] ?? ""
      // Only the roster table; later tables in the section list other facts.
      const table = body.slice(0, body.indexOf("|}") + 2)
      for (const cells of tableRows(table)) {
        const [who = "", ...rest] = cells
        const link = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/.exec(who)
        if (!link?.[1]) continue
        const name = resolver.canonical(link[1].trim())
        const note = /\(([^)]*only)\)/i.exec(toPlainText(who))?.[1]
        const role = /\(([^)]*)\)/.exec(
          toPlainText(who).replace(/\([^)]*only\)/i, "")
        )?.[1]
        const numeral = rest
          .map((c) => toPlainText(c))
          .find((c) => /^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+$/.test(c))
        const texts = rest
          .map((c) => toPlainText(c))
          .filter((c) => c && c !== numeral && c !== "N/A")
        const previous = roster.get(name)
        roster.set(
          name,
          compact({
            rank: previous?.rank ?? rank,
            romanNumeral: previous?.romanNumeral ?? numeral,
            role: previous?.role ?? (rank === "Other" ? texts[0] : role),
            status: rank === "Other" ? texts[1] : texts[0],
            note: note
              ? note.charAt(0).toUpperCase() + note.slice(1).toLowerCase()
              : previous?.note,
          })
        )
      }
    }
  }
  return roster
}

await main()
