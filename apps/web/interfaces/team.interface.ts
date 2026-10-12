import { PageResponse, Ref, ShinobiInterface } from "./shared.interface"

export interface TeamInterface extends ShinobiInterface {
  /** `id` points to villages. */
  affiliation?: Ref[]
  /** `id` points to characters. */
  leaders?: Ref[]
  /** e.g. "Disbanded". */
  status?: string
  /** Members; `id` points to characters. */
  characters: Ref[]
}

export interface ResponseTeam extends PageResponse {
  teams: TeamInterface[]
}
