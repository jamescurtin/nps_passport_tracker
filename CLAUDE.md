# CLAUDE.md

## Commands

### JavaScript

- `npm run build` — Webpack production build (outputs to `/dist`)
- `npm run server` — Dev server on port 9000 with hot reload
- `npm run lint-check` — Run all JS/CSS linting (stylelint + eslint + prettier)
- `npm run lint-fix` — Auto-fix all linting (sort-visits + eslint + prettier + stylelint)
- `npm run eslint-check` / `npm run eslint-fix` — ESLint only
- `npm run prettier-check` / `npm run prettier-fix` — Prettier only
- `npm run stylelint` — CSS linting

### Python

- `.vscode/scripts/init.sh` — Set up environment (npm install + Python venv + pip install)
- `.github/scripts/python_lint.sh` — Run isort, black, flake8, mypy on `.github/scripts/`
- `.vscode/scripts/lint.sh` — Full lint (JS + Python); pass `--check` for CI mode

## Architecture

D3.js interactive map visualization of National Park Service sites, deployed as a static site to GitHub Pages (nps.jamesandelize.com).

- **Frontend:** ES6 JavaScript + D3.js v7, built with Webpack 5
- **Data pipeline:** Python scripts fetch from NPS API, validate with Pydantic, output JSON
- **CI/CD:** GitHub Actions — linting on PRs, auto-deploy to gh-pages on main push

### Source layout

- `src/index.js` — Main map application entry point
- `src/js/` — Modules: modal, search, statistics, colorscale, state abbreviations
- `src/css/map.css` — Responsive styling with CSS variables (NPS color palette)
- `src/data/parks.json` — NPS park metadata (auto-updated weekly via GitHub Actions)
- `src/data/visits.json` — Manually curated visited parks with dates and notes
- `.github/scripts/update_parks.py` — Fetches NPS API, validates with Pydantic models
- `.github/scripts/sort_visits.py` — Sorts visits.json by parkCode

## Data flow

- **parks.json** — Auto-updated by `update-parks.yml` workflow (weekly cron + on push). Python script fetches NPS API using `NPS_API_KEY` secret, validates with Pydantic, auto-commits changes via PR.
- **visits.json** — Manually edited. Contains `parkCode`, `visitedOn` date array, and `notes`. Sorted by `npm run sort-visits`.
- At build time, `src/index.js` merges both files to flag visited parks and attach visit dates.

## Code style

- **JavaScript:** ESLint flat config (`eslint.config.mjs`) + Prettier, ES2021+
- **Python:** Black (88 chars), isort (Black profile), Flake8, MyPy strict
- **CSS:** Stylelint with standard config
- **Tooling versions:** Node 24, Python 3.14
