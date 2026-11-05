# NPS Passport Tracker

Small static site tracking the National Park Service sites that we have visited.

It uses [d3](https://d3js.org/) for map generation and the [NPS API](https://www.nps.gov/subjects/developer/api-documentation.htm)
for park metadata.

## Park Data

A Github Actions job is used to query the National Park Service API. It runs
each time a commit is merged to the default branch, as well as once weekly on a
cron schedule. If changes are detected, a PR is created.

## Deep Links

Every park and state has a shareable URL. The hash holds the route:

- `/#/park/<parkCode>` opens a park's details (and zooms to its state), for
  example `/#/park/yell`. The "Copy link" button in the park sheet copies it.
- `/#/state/<ABBR>` zooms to a state, for example `/#/state/MA`.
- No hash shows the whole map. Unknown codes are ignored.

Opening a park adds one history entry, so the browser Back button closes the
sheet. Zooming and closing replace the current entry.

## Offline Support

Production builds register a service worker (`src/sw.js`). After one visit the
map loads without a network:

- The app shell and data files are precached. The cache name includes a hash
  of the build, so a new deploy replaces the old cache.
- JSON data is fetched network first and falls back to the cache.
- NPS photos are cached on first view (at most 60, oldest evicted).

A new version takes over after all tabs of the site are closed. The dev server
(`npm run server`) does not register a worker. The site also has a web app
manifest, so it can be installed from the browser.

## Local Development

### Installation

Install Node and Python, then

```console
source .vscode/scripts/init.sh
```

### Local Web server

Then run the local dev server:

```console
npm run server
```

Then navigate to [http://localhost:9000](http://localhost:9000).
The server will auto-reload as changes are made.

### Tests

```console
npm test                              # unit tests (Vitest)
npm run build && npm run test:e2e     # browser tests (Playwright, Chromium)
```

### Linting

To run lints (and attempt to fix errors), run

```console
./.vscode/scripts/lint.sh
```

To run lints and fail on error (like in CI), run

```console
./.vscode/scripts/lint.sh --check
```
