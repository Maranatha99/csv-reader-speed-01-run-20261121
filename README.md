# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Maranatha99/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Maranatha99/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers
exactly as csv-reader does on every case — same broken-row policy, same
`{columns, rows, errors}` — but reads the text in bulk instead of one
character at a time, so it runs about 4x faster than the house baseline
on the practice set (median CPU over 7 rounds: ~163 ms vs ~703 ms for
csv-reader 1.0.0 on the 6 practice cases).

## How it works

- Unquoted fields are scanned with one sticky regex for the next
  delimiter (`,` / LF / CR) instead of a per-character loop; each field
  is taken with a single `slice()`.
- Quoted fields are scanned in bulk segments: `""` becomes one quote,
  CRLF and lone CR inside quotes become one LF, and the text after a
  closing quote is appended as-is (with a `quote_junk` error when it
  adds characters).
- A quote that never closes is treated as a literal character and the
  rest is re-read as unquoted (`unterminated_quote`), exactly like the
  reference.
- Short rows are padded with `""` (`short_row`), long rows are cut
  (`long_row`), and every error carries the line its record starts on
  and its index in `rows` — byte-for-byte the reference's answers.

Verified against csv-reader 1.0.0 with the kit's scorer (6/6 practice
cases pass) and a differential fuzzer (22,000+ random and targeted
broken-CSV inputs, zero mismatches).

## Run it

```sh
node main.ts
```

`main.ts` reads every case from `/input/cases.json` (or
`$MAKEFUN_INPUT_DIR/cases.json` outside a container), answers each with
`run()` from `solve.js`, and writes `/output/answers.json` (or
`$MAKEFUN_OUTPUT_DIR/answers.json`). Node 22, dependency-free, no
install step.

---

<sub>Entered on [make.fun](https://make.fun/?ref=s11m3687&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
