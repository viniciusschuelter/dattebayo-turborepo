# Dattebayo data

Structured data about the Naruto and Boruto universe: characters, clans,
villages, teams, kekkei genkai, tailed beasts, Akatsuki and Kara.

The TypeScript types for every file live in [`../interfaces`](../interfaces).

| File                 | Records | Interface               |
| -------------------- | ------- | ----------------------- |
| `characters.json`    | 1457    | `CharacterInterface`    |
| `clans.json`         | 52      | `ClanInterface`         |
| `teams.json`         | 179     | `TeamInterface`         |
| `villages.json`      | 40      | `VillageInterface`      |
| `kekkei-genkai.json` | 34      | `KekkeigenkaiInterface` |
| `tailed-beasts.json` | 10      | `TailedInterface`       |
| `akatsuki.json`      | 33      | `AkatsukiInterface`     |
| `kara.json`          | 20      | `KaraInterface`         |

## Source and license

All content comes from the [Naruto Fandom wiki](https://naruto.fandom.com) and
is available under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
If you reuse it, credit the Naruto wiki and its contributors and share your
work under the same license. Every record carries a `source` with the URL of
the article it was built from and the revision it reflects.

## How the data is shaped

- **References.** Anything that points to another entity is a `Ref`:
  `{ id?, name, note? }`. `id` is set when the target exists in one of these
  files. The field decides which file: `personal.clan` points to clans,
  `personal.team` to teams, `family` to characters, and so on. `note` keeps the
  wiki's qualifiers: `"Anime only"`, `"Formerly"`, `"Affinity"`…
- **Names.** `name` is the wiki article title, which is unique. `names` holds
  the English, kanji and romaji forms, plus titles and nicknames under
  `names.alternatives`.
- **Story periods.** Age, height, weight and ninja rank are keyed by era:
  `Part I`, `Part II`, `Blank Period`, `New Era`, `Boruto Movie`,
  `Boruto Manga`.
- **Family.** Built the same way the wiki builds its family boxes. Parents,
  grandparents, siblings, aunts, uncles, cousins, children and grandchildren
  are derived from every character's `parents`. Explicit relationships (wife,
  godfather…) are added on top.
- **Jutsu and tools.** Taken from each jutsu's and tool's list of users on the
  wiki.
- **Organisations.** `akatsuki.json`, `kara.json` and `tailed-beasts.json`
  contain full character records plus a membership block: the Akatsuki ring;
  Kara rank, numeral and status; tail count.

## Regenerating

```sh
pnpm --filter web sync-data            # rebuild from the wiki (uses a local cache)
pnpm --filter web sync-data --refresh  # ignore the cache and re-download
pnpm --filter web check-data           # type-check every record against the interfaces
```

The sync keeps ids stable. It matches records to the current files by wiki
page id first, then by name, and only new records get new ids. It is polite to
the wiki: requests are batched 50 titles at a time and spaced out.

## Changes from v1

v2 is a breaking change to the data shape.

- Multi-valued fields are always arrays of `Ref` (v1 mixed strings and
  arrays). `images` is now `{ url, caption }[]`, and `family` is a list of
  `{ relation, id, name }` instead of an object.
- Clans, teams, villages and kekkei genkai list members as `Ref[]`. They no
  longer have one entry per qualifier: v1's "Hyūga" ×2 and
  "Senju (Anime only)" are now one record each, with the qualifier on the
  member.
- Akatsuki and Kara membership now follows the wiki. Twelve people who were
  never members (Chibi, Himeyuri, Nazuna…) were removed from both lists.
  Madara Uchiha is no longer listed in Akatsuki, because the wiki doesn't list
  him as a member (Obito acted under his name). Jūzō Biwa and Merz were added.
- New fields: `summary`, `names`, `source`, `media`, structured `debut`,
  `rank`, `tools`, Kage lists, village ratings, Akatsuki rings, Kara roster,
  kekkei genkai natures and clans.
- Scraper artefacts were removed: the "Local Sitemap" page, duplicate
  "Soul Tao" records, the "Zetsu" hub page and "Sāra's Daughter", which was
  deleted from the wiki. 31 characters that were missing are now included.
