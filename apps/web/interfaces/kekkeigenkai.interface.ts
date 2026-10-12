import { PageResponse, Ref, ShinobiInterface } from "./shared.interface"

export interface KekkeigenkaiInterface extends ShinobiInterface {
  /** e.g. ["Kekkei Genkai", "Dōjutsu"]. */
  classification?: string[]
  /** Basic natures combined by this release, e.g. Fire + Water for Boil Release. */
  natureTypes?: Ref[]
  /** `id` points to clans. */
  clans?: Ref[]
  /** Users; `id` points to characters. */
  characters: Ref[]
}

export interface ResponseKekkeigenkai extends PageResponse {
  kekkeigenkai: KekkeigenkaiInterface[]
}
