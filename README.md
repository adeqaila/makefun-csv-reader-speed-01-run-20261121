# csv-reader-speed-01 — fast drop-in for csv-reader 1.0.0

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![Rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/adeqaila/makefun-csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![Reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/adeqaila/makefun-csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

Entry for make.fun bounty `csv-reader-speed-01-run-20261121`
("Read broken CSV files faster, 21 November 2026").

## What it is

`solve.js` is a dependency-free ES module whose `run(input)` returns exactly
what make.fun's own csv-reader 1.0.0 returns for every input `{text, header}`:
`{columns, rows, errors}` — same broken-row policy (BOM, CRLF/LF, stray_cr,
quote_junk, unterminated_quote, short_row/long_row), same error order, same
line/row accounting. It is written from scratch; it does not copy or import
the reference implementation.

`main.ts` is the kit's driver, unchanged (reads `/input/cases.json`, answers
each case with `run`, writes `/output/answers.json`, V8 incremental marking
off, exactly as the house baseline runs).

## How it is faster

The reference walks one character at a time and builds each field a character
at a time. This one jumps instead:

- one sticky regex exec (`/[,\r\n]/g`) per unquoted field, then the field is
  taken as a single `slice`;
- one `indexOf` per closing quote; a plain quoted field (no doubled quotes, no
  line break inside) is a single `slice`; doubled quotes go through
  `replaceAll('""', '"')`, and only quoted fields holding a line break go
  through the slow segment builder.

## Measured (practice set, 6 cases, 10.2M chars, this box, run() only)

| | best | mean |
|---|---|---|
| this entry | 92 ms | 112 ms |
| csv-reader 1.0.0 | 416 ms | 487 ms |
| speedup | **4.5x** | **4.3x** |

Full driver pipeline (`node main.ts`, incl. JSON parse + stringify):
0.79 s vs 1.62 s for the reference. Answers are byte-identical to the
reference's on the practice set, and 6/6 identical to the kit's published
`expected.json`.

## Verification (reproduce)

From the workdir (not part of the repo — see `../test/`):

- `node test/difftest.mjs` — 6 practice cases + 64 hand-written edge cases +
  40,000 fuzz cases vs the reference: 0 mismatches.
- `node test/freshsets.mjs` — 3 fresh sets drawn with the kit's own generator
  from other seeds: 18/18 cases identical to the published expected answers.
- `node test/bench.mjs` — timings above.

## Repo contents (this is the whole entry; 1 MiB limit)

- `solve.js` — the fast reader
- `main.ts` — the kit driver, unchanged
- `package.json` — `{"type": "module"}`
- `LICENSE` — MIT
- `README.md` — this file
