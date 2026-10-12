/**
 * A link to another entity. `id` is set when the target exists in one of our
 * collections (which one depends on the field — e.g. `personal.clan` points to
 * clans, `family` points to characters); `note` carries qualifiers taken from
 * the wiki such as "Anime only", "Formerly" or "Affinity".
 */
export interface Ref {
  id?: number
  name: string
  note?: string
}

export interface ImageInterface {
  url: string
  caption?: string
}

export interface AlternativeName {
  name: string
  kanji?: string
  romaji?: string
  /** Literal English translation of the Japanese name. */
  literal?: string
  /** Name used in the English TV dub. */
  englishTv?: string
  /** Name used by the Viz English manga. */
  viz?: string
}

export interface NamesInterface {
  english?: string
  kanji?: string
  romaji?: string
  literal?: string
  englishTv?: string
  viz?: string
  /** Titles, nicknames and aliases. */
  alternatives?: AlternativeName[]
}

/** Story periods used by the wiki for age, height, weight and rank. */
export type Era =
  | "Part I"
  | "Part II"
  | "Blank Period"
  | "New Era"
  | "Boruto Movie"
  | "Boruto Manga"

export type EraValues = Partial<Record<Era, string>>

export type MangaSeries =
  | "Naruto"
  | "Boruto"
  | "Boruto: Two Blue Vortex"
  | "Sasuke Retsuden"
  | "Konoha Shinden"

export type AnimeSeries = "Naruto" | "Naruto Shippūden" | "Boruto"

export interface DebutInterface {
  manga?: {
    series: MangaSeries
    /** "Chapter", "Volume", "Special"… */
    type: string
    /** Kept as a string: the wiki uses values like "700+4". */
    number: string
    note?: string
    /** Human readable, e.g. "Naruto Chapter #1". */
    label: string
  }
  anime?: {
    series: AnimeSeries
    episode: number
    note?: string
    /** Human readable, e.g. "Naruto Shippūden Episode #205". */
    label: string
  }
  novel?: string
  movie?: string
  game?: string
  ova?: string
}

/** Where a record came from on the Naruto Fandom wiki (CC BY-SA). */
export interface SourceInterface {
  url: string
  pageId: number
  /** ISO timestamp of the wiki revision the record was built from. */
  revision: string
}

export interface ShinobiInterface {
  id: number
  name: string
  images: ImageInterface[]
  names?: NamesInterface
  /** Plain-text lead paragraph of the wiki article. */
  summary?: string
  debut?: DebutInterface
  /** Media the entity appears in: Anime, Manga, Novel, Game, Movie… */
  media?: string[]
  /** Absent for the few records that have no wiki article of their own. */
  source?: SourceInterface
}

export interface PageResponse {
  currentPage: number
  pageSize: number
  total: number
}

export enum CollectionNameEnum {
  characters = "characters",
  akatsuki = "akatsuki",
  clans = "clans",
  kara = "kara",
  kekkeigenkai = "kekkei-genkai",
  tailedbeasts = "tailed-beasts",
  teams = "teams",
  villages = "villages",
}

export const collectionNames = Object.values(CollectionNameEnum)

export interface DocsCollectionInterface {
  enum: CollectionNameEnum
  title: string
  description: string
}
