import Papa from "papaparse";
import type { Feature, FeatureCollection, Geometry } from "geojson";

type CsvRecord = Record<string, string | undefined>;

export interface GameRow {
  countryId: string;
  country: string;
  releaseYear: number;
  genreId: string;
  genre: string;
  gameFrequency: number;
}

interface MapProperties extends Record<string, unknown> {
  name?: string;
  displayName?: string;
  "ISO3166-1-Alpha-2"?: string;
  "ISO3166-1-Alpha-3"?: string;
  ISO_N3?: string;
}

export type CountryFeature = Feature<Geometry, MapProperties>;
export type CountryCollection = FeatureCollection<Geometry, MapProperties>;

export interface DashboardData {
  chartRows: GameRow[];
  mapRows: GameRow[];
  countryCollection: CountryCollection;
}

// Change these paths when testing another data source.
const DATA_SOURCES = {
  chart: "/data/games-without-country.csv",
  map: "/data/games.csv",
  boundaries: "/data/countries.geojson",
};

const countryNameAliases: Record<string, string[]> = {
  "united states": ["united states of america", "usa", "us"],
  "united kingdom": ["uk", "great britain", "britain"],
  "russian federation": ["russia"],
  "republic of korea": ["south korea", "korea south"],
  "democratic people's republic of korea": ["north korea", "korea north"],
  "viet nam": ["vietnam"],
  czechia: ["czech republic"],
  "cote d ivoire": ["ivory coast"],
  "iran islamic republic of": ["iran"],
  "syrian arab republic": ["syria"],
  "lao peoples democratic republic": ["laos"],
  "united republic of tanzania": ["tanzania"],
  "bolivia plurinational state of": ["bolivia"],
  "venezuela bolivarian republic of": ["venezuela"],
  taiwan: ["taiwan province of china"],
  "state of palestine": ["palestine"],
};

const normalizeName = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

async function fetchText(path: string): Promise<string> {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`Could not load ${path}. Check that the file exists.`);
  }

  return response.text();
}

function parseCsv(csvText: string, requireCountry: boolean): GameRow[] {
  const parsed = Papa.parse<CsvRecord>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim().toLowerCase(),
    transform: (value) => value.trim(),
  });

  const required = [
    "release_year",
    "genre_id",
    "genre",
    "game_frequency",
    ...(requireCountry ? ["country_id", "country"] : []),
  ];

  const headers = (parsed.meta.fields ?? []).map((header) =>
    header.trim().toLowerCase(),
  );

  const missing = required.filter((field) => !headers.includes(field));

  if (missing.length) {
    throw new Error(`CSV is missing required column(s): ${missing.join(", ")}`);
  }

  return parsed.data.flatMap((record) => {
    const releaseYear = Number(record.release_year);
    const gameFrequency = Number(record.game_frequency);

    if (!Number.isFinite(releaseYear) || !Number.isFinite(gameFrequency)) {
      return [];
    }

    return [
      {
        countryId: String(record.country_id ?? "").trim(),
        country: String(record.country ?? "").trim(),
        releaseYear,
        genreId: String(record.genre_id ?? "").trim(),
        genre: String(record.genre ?? "").trim(),
        gameFrequency,
      },
    ];
  });
}

function normalizeGeoJson(raw: CountryCollection): CountryCollection {
  const features = raw.features
    .filter((feature) => feature.geometry !== null)
    .map((feature) => {
      const properties = feature.properties ?? {};

      const displayName = String(
        properties.name ??
          properties.NAME_EN ??
          properties.ADMIN ??
          properties.NAME ??
          "Unknown",
      );

      const iso3 =
        [
          properties["ISO3166-1-Alpha-3"],
          properties.ISO_A3_EH,
          properties.ISO_A3,
          properties.ADM0_A3,
        ]
          .map((value) => String(value ?? "").toUpperCase())
          .find((value) => value && value !== "-99") ?? "";

      const iso2 =
        [properties["ISO3166-1-Alpha-2"], properties.ISO_A2]
          .map((value) => String(value ?? "").toUpperCase())
          .find((value) => value && value !== "-99") ?? "";

      return {
        ...feature,
        properties: {
          ...properties,
          "ISO3166-1-Alpha-3": iso3,
          "ISO3166-1-Alpha-2": iso2,
          name: iso3 || normalizeName(displayName),
          displayName,
        },
      };
    }) as CountryFeature[];

  return { ...raw, features };
}

export async function loadDashboardData(): Promise<DashboardData> {
  const [chartCsv, mapCsv, geoJson] = await Promise.all([
    fetchText(DATA_SOURCES.chart),
    fetchText(DATA_SOURCES.map),
    fetch(DATA_SOURCES.boundaries).then(async (response) => {
      if (!response.ok) {
        throw new Error(
          "World boundaries are missing. Check /data/countries.geojson.",
        );
      }
      return (await response.json()) as CountryCollection;
    }),
  ]);

  const chartRows = parseCsv(chartCsv, false);
  const mapRows = parseCsv(mapCsv, true);
  const countryCollection = normalizeGeoJson(geoJson);

  if (!chartRows.length || !mapRows.length) {
    throw new Error("The CSV files loaded, but contain no usable data rows.");
  }

  return { chartRows, mapRows, countryCollection };
}

export function getGenres(rows: GameRow[]): string[] {
  return [...new Set(rows.map((row) => row.genre).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
}

export function getYears(rows: GameRow[]): number[] {
  return [...new Set(rows.map((row) => row.releaseYear))].sort((a, b) => a - b);
}

function filterByGenres(rows: GameRow[], selectedGenres: string[]): GameRow[] {
  if (selectedGenres.length === 0) return rows;

  const selected = new Set(selectedGenres);
  return rows.filter((row) => selected.has(row.genre));
}

export function getChartData(rows: GameRow[], selectedGenres: string[]) {
  const filtered = filterByGenres(rows, selectedGenres);
  const totals = new Map<number, number>();

  for (const row of filtered) {
    totals.set(
      row.releaseYear,
      (totals.get(row.releaseYear) ?? 0) + row.gameFrequency,
    );
  }

  return {
    data: getYears(rows).map((year) => ({
      year,
      frequency: totals.get(year) ?? 0,
    })),
    total: filtered.reduce((sum, row) => sum + row.gameFrequency, 0),
  };
}

export function getMapData(
  rows: GameRow[],
  countryCollection: CountryCollection,
  selectedGenres: string[],
  selectedYear: number,
) {
  const byIso3 = new Map<string, string>();
  const byIso2 = new Map<string, string>();
  const byName = new Map<string, string>();
  const byNumeric = new Map<string, string>();
  const displayNames = new Map<string, string>();

  for (const feature of countryCollection.features) {
    const properties = feature.properties ?? {};
    const key = String(properties.name ?? "");
    const displayName = String(properties.displayName ?? key);
    const iso3 = String(properties["ISO3166-1-Alpha-3"] ?? "").toUpperCase();
    const iso2 = String(properties["ISO3166-1-Alpha-2"] ?? "").toUpperCase();
    const rawNumeric = String(properties.ISO_N3 ?? "").trim();
    const numeric = /^\d+$/.test(rawNumeric) ? String(Number(rawNumeric)) : "";

    if (numeric) byNumeric.set(numeric, key);
    if (iso3 && iso3 !== "-99") byIso3.set(iso3, key);
    if (iso2 && iso2 !== "-99") byIso2.set(iso2, key);

    byName.set(normalizeName(displayName), key);
    displayNames.set(key, displayName);
  }

  function resolveCountryKey(countryId: string, countryName: string) {
    const id = countryId.trim().toUpperCase();

    if (/^\d+$/.test(id)) {
      const match = byNumeric.get(String(Number(id)));
      if (match) return match;
    }

    if (/^[A-Z]{3}$/.test(id)) {
      const match = byIso3.get(id);
      if (match) return match;
    }

    if (/^[A-Z]{2}$/.test(id)) {
      const match = byIso2.get(id);
      if (match) return match;
    }

    const normalized = normalizeName(countryName);
    const direct = byName.get(normalized);
    if (direct) return direct;

    for (const [canonical, aliases] of Object.entries(countryNameAliases)) {
      const candidates = [canonical, ...aliases].map(normalizeName);

      if (candidates.includes(normalized)) {
        for (const candidate of candidates) {
          const match = byName.get(candidate);
          if (match) return match;
        }
      }
    }

    return null;
  }

  const filtered = filterByGenres(rows, selectedGenres);
  const totals = new Map<string, number>();
  const unmatched = new Set<string>();

  for (const row of filtered) {
    if (row.releaseYear > selectedYear) continue;

    const key = resolveCountryKey(row.countryId, row.country);

    if (!key) {
      unmatched.add(row.country || row.countryId || "Unknown country");
      continue;
    }

    totals.set(key, (totals.get(key) ?? 0) + row.gameFrequency);
  }

  return {
    data: [...totals.entries()].map(([name, value]) => ({
      name,
      value,
      displayName: displayNames.get(name) ?? name,
    })),
    unmatched: [...unmatched].sort(),
    countriesWithData: totals.size,
    total: filtered
      .filter((row) => row.releaseYear <= selectedYear)
      .reduce((sum, row) => sum + row.gameFrequency, 0),
  };
}
