# NPS Passport Tracker

Small static site tracking the National Park Service sites that we have visited.

It uses [d3](https://d3js.org/) for map generation and the [NPS API](https://www.nps.gov/subjects/developer/api-documentation.htm)
for park metadata.

## Local Development

### Installation

Install node, then

```console
npm install
```

### Local Web server

Then run the local dev server:

```console
npm run server
```

Then navigate to [http://localhost:9000][http://localhost:9000].
The server will auto-reload as changes are made.

### Linting

To run lints (and attempt to fix errors), run

```console
npm run lint-fix
```

To run lints and fail on error (like in CI), run

```console
npm run lint
```

## To Dos

- [ ] Automated tests
- [ ] Configure cron to check the National Park Service API and update map when new parks open
- [ ] Add additional contextual information to the tooltip when hovering over a park
- [ ] Add additional elements to the page (e.g. total park visit count)
- [ ] Store additional information about visits (e.g. date of visit, picture, etc.)
