import { CharacterInterface } from "./character.interface"
import { PageResponse } from "./shared.interface"

export interface KaraMembership {
  /** Position in the organisation, as listed on the Kara article. */
  rank?: "Inner" | "Outer" | "Other"
  /** Inner's facial tattoo, e.g. "Ⅳ". */
  romanNumeral?: string
  /** What happened to the member, e.g. "Defected". */
  status?: string
  role?: string
  /** e.g. "Anime only". */
  note?: string
}

export interface KaraInterface extends CharacterInterface {
  kara: KaraMembership
}

export interface ResponseKara extends PageResponse {
  kara: KaraInterface[]
}
