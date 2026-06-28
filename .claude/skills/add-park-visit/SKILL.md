---
name: add-park-visit
description: Add one or more visited NPS sites to src/data/visits.json with a visit date and a fun-fact note. Use when the user says they "visited", "went to", or "want to add" a park (or parks) and gives a date, e.g. "add Yellowstone, visited 2000-01-01".
---

# Add Park Visit

Add visited NPS sites to `src/data/visits.json`. For each park: resolve its `parkCode` from `src/data/parks.json`, draft a fun-fact `note`, insert a sorted entry, then run the canonical formatters.

## Inputs

- One or more park names (as the user phrases them, e.g. "Jean Lafitte", "New Orleans Jazz").
- A visit date (or per-park dates). Normalize to ISO `YYYY-MM-DD`.

## Steps

1. **Resolve parkCodes.** Look each name up in `src/data/parks.json` by matching the `name` field (case-insensitive substring is fine). Confirm the match by showing the resolved `fullName`. If a name matches zero or multiple parks, stop and ask the user to disambiguate — do not guess.

2. **Check for duplicates.** Grep `src/data/visits.json` for each `parkCode`. If it already exists, append the new date to its `visitedOn` array (keep dates sorted) rather than creating a second entry.

3. **Get the fun fact.** Always ask the user first whether they have a fact or note they want to use for each park — their own memory of the visit is preferred. Only if they have none to provide, draft one yourself: one `notes` string per park, matching the style of existing entries: 1–3 sentences, factual, specific, no fluff. Draw from the park's `description` in parks.json plus reliable general knowledge, and surface the proposed fact for approval. Prefer concrete, verifiable details (dates, counts, firsts) over generic praise.

4. **Insert sorted entries.** `visits.json` is a JSON array sorted by `parkCode`. Insert each new object in its correct alphabetical position:
   ```json
   {
     "parkCode": "jazz",
     "visitedOn": ["2026-06-27"],
     "notes": "..."
   }
   ```
   Use `_comment: "TODO"` instead of `notes` only if a fact genuinely cannot be sourced.

5. **Format.** Run the canonical pipeline so output matches committed style:
   ```sh
   npm run sort-visits          # python sort by parkCode (expands arrays)
   npx prettier --write src/data/visits.json   # collapses to committed compact form
   ```
   `npm run sort-visits` alone reformats arrays to multi-line; prettier collapses them back. Always run prettier after.

6. **Verify.** `python3 -c "import json; json.load(open('src/data/visits.json'))"` to confirm valid JSON, and `git diff --stat src/data/visits.json` to confirm the diff is limited to the new entries (a clean add is a small insertion count, not a whole-file reformat).

## Notes

- Do not commit unless the user asks.
- `parks.json` is auto-generated; never edit it here.
