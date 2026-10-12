import { PageResponse, Ref, ShinobiInterface } from "./shared.interface"

export interface ClanInterface extends ShinobiInterface {
  /** `id` points to villages. */
  affiliation?: Ref[]
  /** `id` points to kekkei-genkai. */
  kekkeiGenkai?: Ref[]
  /** Members; `id` points to characters. */
  characters: Ref[]
}

export interface ResponseClan extends PageResponse {
  clans: ClanInterface[]
}
