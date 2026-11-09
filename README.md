# Game Atlas — Nuxt dashboard starter

A one-page Nuxt 4 app for exploring game release frequency by year, genre, and country.

## What is included

- Chart view: yearly frequency summed across every country, using bars and a trend line.
- Map view: country totals accumulated from the earliest year in the data through the selected slider year.
- Genre dropdown: all genres by default, or one/two selected genres.
- CSV parsing in the browser; no database or API is required for this first version.
- Docker Compose development setup for Ubuntu on WSL.

## 1. Put the project in the WSL Linux filesystem

Keep the project inside Ubuntu's Linux filesystem (for example `~/projects/game-release-explorer`) rather than under `/mnt/c`, which is usually faster for file watching and hot reload.

Open Ubuntu/WSL and move into this project directory:

```bash
cd ~/projects/game-release-explorer
```

## 2. Add your CSV

Replace `public/data/games.csv` with your real CSV. Keep these exact headers:

```csv
country_id,country,release_year,genre_id,genre,game_frequency
```

The sample file in this starter is synthetic and only exists to demonstrate the app.

### Country matching

The map code first tries `country_id` as an ISO-3166 alpha-3 code (for example `USA`, `JPN`, `DEU`) and then alpha-2 (for example `US`, `JP`, `DE`). If it cannot match the ID, it tries the `country` text against the map's country names, with several common aliases.

If your `country_id` is a database-specific integer, that's okay: the app will fall back to the `country` column. If your country labels use unusual names, we can add them to the alias list after checking a few rows from your CSV.

## 3. Download world map boundaries (one time)

The map uses the lightweight Natural Earth 1:110m country GeoJSON (about 820 KB), which is suitable for a world overview. Download the GeoJSON once:

```bash
./scripts/download-map.sh
```

If you prefer Windows PowerShell, run this from the project directory:

```powershell
New-Item -ItemType Directory -Force public/data | Out-Null
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson" -OutFile "public/data/countries.geojson"
```

The GeoJSON file is intentionally not bundled in this starter archive. The script places it at the path the app expects. The loader recognizes both Natural Earth field names and the ISO field names used by other GeoJSON country datasets.

## 4. Start with Docker

Make sure Docker Desktop is running and WSL integration is enabled for this Ubuntu distribution. From the project directory:

```bash
docker compose up
```

Then open:

```text
http://localhost:3000
```

The compose service uses the official Node 24 Alpine image, installs dependencies into a Docker-managed `node_modules` volume, and starts Nuxt with `--host 0.0.0.0` so your Windows browser can reach the container.

Stop the app with `Ctrl+C`. To stop and remove the container:

```bash
docker compose down
```

## 5. Update dependencies

If you change `package.json`, restart the container so the `npm install` command runs again:

```bash
docker compose down
docker compose up
```

To reset the installed dependency volume (only do this if dependencies become inconsistent):

```bash
docker compose down -v
docker compose up
```

## Data aggregation rules

- Chart: sum `game_frequency` by `release_year` after the genre filter. Country is not used as a chart dimension.
- Map: sum `game_frequency` by country after the genre filter, including all rows where `release_year <= selectedYear`.
- Selecting no genres means all genres. Selecting one or two genres filters both views.
- If duplicate country/year/genre rows exist, they are added together.

## Useful notes

- The map is a choropleth (graduated country shading), not a calculation of the statistical Gini coefficient.
- This is a client-side prototype. If the CSV becomes very large, the next improvement would be to aggregate it server-side and return compact chart/map datasets.
