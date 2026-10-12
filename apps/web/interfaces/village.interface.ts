import { CharacterInterface } from "./character.interface"
import {
  ImageInterface,
  PageResponse,
  Ref,
  ShinobiInterface,
} from "./shared.interface"

export interface KageInterface {
  /** 1 for the First Hokage, 2 for the Second… */
  order: number
  /** e.g. "Fourth Hokage". */
  title: string
  /** `id` points to characters. */
  id?: number
  name: string
}

/** The wiki's 1–5 ratings shown on village infoboxes. */
export interface VillageRatings {
  population?: number
  military?: number
  economy?: number
}

export interface VillageInterface extends ShinobiInterface {
  country?: string
  /** Title of the village leader, e.g. "Hokage". */
  leaderTitle?: string
  /** Named leaders, for villages whose infobox lists people instead of a title. `id` points to characters. */
  leaders?: Ref[]
  /** Ordered list of Kage, for the villages that have one. */
  kage?: KageInterface[]
  symbol?: ImageInterface
  ratings?: VillageRatings
  /** Members; `id` points to characters. */
  characters: Ref[]
}

export interface ResponseVillage extends PageResponse {
  villages: VillageInterface[]
  totalVillages: number
}

/** A village with its members expanded to full character records. */
export interface VillageWithCharacters extends Omit<
  VillageInterface,
  "characters"
> {
  characters: CharacterInterface[]
}
