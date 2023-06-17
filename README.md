# NPS Passport Tracker

Small static site tracking the National Park Service sites that we have visited.

It uses [d3](https://d3js.org/) for map generation and the [NPS API](https://www.nps.gov/subjects/developer/api-documentation.htm)
for park metadata.

## Park Data

A Github Actions job is used to query the National Park Service API. It runs
each time a commit is merged to the default branch, as well as once weekly on a
cron schedule. If changes are detected, a PR is created.

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

### Linting

To run lints (and attempt to fix errors), run

```console
./.vscode/scripts/lint.sh
```

To run lints and fail on error (like in CI), run

```console
./.vscode/scripts/lint.sh --check
```
