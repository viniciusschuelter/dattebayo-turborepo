import { CharacterInterface } from "./character.interface"
import { PageResponse } from "./shared.interface"

/** One of the ten rings worn by Akatsuki members under Nagato. */
export interface AkatsukiRing {
  /** e.g. "Right thumb". */
  finger: string
  kanji: string
  romaji: string
  meaning: string
  colour: string
  /** Other wearers of the same ring, in order. */
  wornBy: string[]
}

export interface AkatsukiMembership {
  /** Qualifier from the wiki, e.g. "Anime only". */
  note?: string
  ring?: AkatsukiRing
}

export interface AkatsukiInterface extends CharacterInterface {
  akatsuki: AkatsukiMembership
}

export interface ResponseAkatsuki extends PageResponse {
  akatsuki: AkatsukiInterface[]
}
