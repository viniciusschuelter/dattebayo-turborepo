import clansData from "@/data/clans.json"
import { ClanInterface } from "@/interfaces/clan.interface"
import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  try {
    const items: ClanInterface[] = clansData as ClanInterface[]

    const searchParams = req.nextUrl.searchParams
    const page = Number(searchParams.get("page")) || 1
    const limit = Number(searchParams.get("limit")) || 20
    const name = (searchParams.get("name") || "").toLowerCase()

    const startIndex = (page - 1) * limit
    const endIndex = page * limit

    let result = []

    if (name) {
      result = items
        .filter((_) => _.name.toLowerCase().includes(name))
        .slice(startIndex, endIndex)
    } else {
      result = items.slice(startIndex, endIndex)
    }

    const response = {
      items: result,
      currentPage: page,
      pageSize: limit,
      total: name ? result.length : items.length,
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    return Response.json(error, { status: 500 })
  }
}
