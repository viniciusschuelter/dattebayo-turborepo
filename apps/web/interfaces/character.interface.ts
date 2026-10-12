import {
  EraValues,
  PageResponse,
  Ref,
  ShinobiInterface,
} from "./shared.interface"

export interface CharacterPersonal {
  species?: string
  sex?: string
  /** "Alive", "Deceased", "Incapacitated"… */
  status?: string
  /** e.g. "October 10". */
  birthdate?: string
  bloodType?: string
  age?: EraValues
  height?: EraValues
  weight?: EraValues
  classification?: Ref[]
  occupation?: Ref[]
  /** `id` points to villages when the affiliation is a village. */
  affiliation?: Ref[]
  /** `id` points to teams. */
  team?: Ref[]
  /** `id` points to characters. */
  partner?: Ref[]
  /** `id` points to clans. */
  clan?: Ref[]
  /** `id` points to kekkei-genkai. */
  kekkeiGenkai?: Ref[]
  kekkeiMora?: Ref[]
  kekkeiTota?: Ref[]
  /** Tailed beasts sealed in this character (`id` points to tailed-beasts). */
  tailedBeast?: Ref[]
  /** For tailed beasts: their hosts (`id` points to characters). */
  jinchuriki?: Ref[]
}

export interface CharacterRank {
  ninjaRank?: EraValues
  ninjaRegistration?: string
  academyGraduationAge?: string
  chuninPromotionAge?: string
}

export interface FamilyMember extends Ref {
  /** "Father", "Mother", "Son", "Wife", "Adoptive Son", "Godfather"… */
  relation: string
}

export interface VoiceActors {
  japanese?: Ref[]
  english?: Ref[]
  spanish?: Ref[]
  french?: Ref[]
}

export interface CharacterInterface extends ShinobiInterface {
  personal: CharacterPersonal
  rank?: CharacterRank
  /** `id` points to characters. */
  family?: FamilyMember[]
  /** Jutsu this character uses, from each jutsu's "users" list on the wiki. */
  jutsu?: Ref[]
  natureType?: Ref[]
  /** Tools and weapons this character uses. */
  tools?: Ref[]
  uniqueTraits?: string[]
  voiceActors?: VoiceActors
}

export interface ResponseCharacter extends PageResponse {
  characters: CharacterInterface[]
}
