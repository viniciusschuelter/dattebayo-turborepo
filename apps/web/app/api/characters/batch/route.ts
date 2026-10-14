import charactersData from "@/data/characters.json"
import { CharacterInterface } from "@/interfaces/character.interface"
import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  try {
    const items: CharacterInterface[] = charactersData as CharacterInterface[]

    const searchParams = req.nextUrl.searchParams
    const ids = searchParams.get("ids")?.split(",") ?? [{}]

    if (!ids.length) {
      return NextResponse.json(`At least one id is required`, { status: 400 })
    }

    const result =
      ids.length === 1
        ? items.find((_) => _.id == ids[0])
        : items.filter((_) => ids.includes(_.id.toString()))

    if (!result) {
      return NextResponse.json(`nothing found with ids: '${ids}'`, {
        status: 404,
      })
    }

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    return Response.json(error, { status: 500 })
  }
}
