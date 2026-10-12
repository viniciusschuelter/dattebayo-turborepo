/**
 * Verifies that every record in apps/web/data matches its interface by
 * compiling the JSON as `<records> satisfies Interface[]` with tsc, which
 * also rejects values outside literal unions (e.g. an unknown anime series).
 *
 *   pnpm --filter web check-data
 */
import { execFileSync } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

const WEB_ROOT = path.resolve(import.meta.dirname, "../..")
const OUT_DIR = path.join(WEB_ROOT, "node_modules/.cache/check-data")
// Large files are split: one huge literal is too complex for tsc to infer.
const CHUNK = 50

const COLLECTIONS: [file: string, type: string, module: string][] = [
  ["characters", "CharacterInterface", "character"],
  ["akatsuki", "AkatsukiInterface", "akatsuki"],
  ["kara", "KaraInterface", "kara"],
  ["tailed-beasts", "TailedInterface", "tailed"],
  ["clans", "ClanInterface", "clan"],
  ["teams", "TeamInterface", "team"],
  ["villages", "VillageInterface", "village"],
  ["kekkei-genkai", "KekkeigenkaiInterface", "kekkeigenkai"],
]

await rm(OUT_DIR, { recursive: true, force: true })
await mkdir(OUT_DIR, { recursive: true })

const files: string[] = []
for (const [file, type, module] of COLLECTIONS) {
  const records: unknown[] = JSON.parse(
    await readFile(path.join(WEB_ROOT, "data", `${file}.json`), "utf8")
  )
  const ids = new Set<unknown>()
  for (const record of records) {
    const id = (record as { id: unknown }).id
    if (ids.has(id)) throw new Error(`${file}.json: duplicate id ${String(id)}`)
    ids.add(id)
  }
  for (let i = 0; i < records.length; i += CHUNK) {
    const name = `${file}-${i / CHUNK}.ts`
    await writeFile(
      path.join(OUT_DIR, name),
      `import type { ${type} } from '../../../interfaces/${module}.interface';\n` +
        `export const data = ${JSON.stringify(records.slice(i, i + CHUNK))} satisfies ${type}[];\n`
    )
    files.push(name)
  }
}

await writeFile(
  path.join(OUT_DIR, "tsconfig.json"),
  JSON.stringify({
    extends: "../../../tsconfig.json",
    compilerOptions: { noEmit: true },
    include: [],
    files,
  })
)

try {
  execFileSync(path.join(WEB_ROOT, "node_modules/.bin/tsc"), ["-p", OUT_DIR], {
    stdio: "inherit",
  })
  console.log(
    `[check-data] all ${COLLECTIONS.length} collections match their interfaces`
  )
} catch {
  console.error(
    "[check-data] data does not match the interfaces (see errors above)"
  )
  process.exitCode = 1
}
