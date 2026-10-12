import { CharacterInterface } from "./character.interface"
import { PageResponse } from "./shared.interface"

export interface TailedInterface extends CharacterInterface {
  /** 1 (Shukaku) to 10 (Ten-Tails). */
  tails: number
  /** Common English name, e.g. "Nine-Tails". */
  numberName: string
}

export interface ResponseTailed extends PageResponse {
  tailedBeasts: TailedInterface[]
}
