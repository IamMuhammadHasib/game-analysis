import type { Feature, FeatureCollection, Geometry } from "geojson";

export interface GenreOption {
  genreId: string;
  genre: string;
}

export interface GameRow {
  countryId: string;
  releaseYear: number;
  gameFrequency: number;
}

interface MapProperties extends Record<string, unknown> {
  name?: string;
  displayName?: string;
  "ISO3166-1-Alpha-2"?: string;
  "ISO3166-1-Alpha-3"?: string;
  ISO_N3?: string;
  ISO_N3_EH?: string;
  UN_A3?: string;
}

export type CountryFeature = Feature<Geometry, MapProperties>;
export type CountryCollection = FeatureCollection<Geometry, MapProperties>;

export interface DashboardData {
  genres: GenreOption[];
  chartRows: GameRow[];
  mapRows: GameRow[];
  years: number[];
  countryCollection: CountryCollection;
}

interface ApiGenreOption {
  genre_id: string | number;
  genre: string;
}

interface ApiChartRow {
  release_year: number;
  game_frequency: number;
}

interface ApiMapRow extends ApiChartRow {
  country_id: string | number;
}

interface DashboardApiResponse {
  genreOptions: ApiGenreOption[];
  chartRows: ApiChartRow[];
  mapRows: ApiMapRow[];
  yearOptions: { release_year: number }[];
}

const API_URL = "/api/dashboard";
const GEOJSON_URL = "/data/countries.geojson";

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

function normalizeName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

export async function loadDashboardData(
  selectedGenreIds: string[] = [],
): Promise<DashboardData> {
  const params = new URLSearchParams();

  if (selectedGenreIds.length > 0) {
    params.set("genres", selectedGenreIds.join(","));
  }

  const apiUrl = params.size ? `${API_URL}?${params.toString()}` : API_URL;

  const [apiResponse, geoResponse] = await Promise.all([
    fetch(apiUrl),
    fetch(GEOJSON_URL),
  ]);

  if (!apiResponse.ok) {
    const details = await apiResponse.text();

    throw new Error(`SQLite API error (${apiResponse.status}): ${details}`);
  }

  if (!geoResponse.ok) {
    throw new Error("Could not load the world country boundaries.");
  }

  const apiData = (await apiResponse.json()) as DashboardApiResponse;
  const geoJson = (await geoResponse.json()) as CountryCollection;

  const genres: GenreOption[] = apiData.genreOptions.map((item) => ({
    genreId: String(item.genre_id),
    genre: String(item.genre),
  }));

  const chartRows: GameRow[] = apiData.chartRows.map((row) => ({
    countryId: "",
    releaseYear: Number(row.release_year),
    gameFrequency: Number(row.game_frequency),
  }));

  const mapRows: GameRow[] = apiData.mapRows.map((row) => ({
    countryId: String(row.country_id),
    releaseYear: Number(row.release_year),
    gameFrequency: Number(row.game_frequency),
  }));

  return {
    genres,
    chartRows,
    mapRows,
    countryCollection: normalizeGeoJson(geoJson),
    years: apiData.yearOptions.map((row) => Number(row.release_year)),
  };
}

export function getYears(rows: GameRow[]): number[] {
  return [...new Set(rows.map((row) => row.releaseYear))].sort((a, b) => a - b);
}

export function getChartData(rows: GameRow[], allYears: number[]) {
  const totals = new Map<number, number>();

  for (const row of rows) {
    totals.set(
      row.releaseYear,
      (totals.get(row.releaseYear) ?? 0) + row.gameFrequency,
    );
  }

  return {
    data: allYears.map((year) => ({
      year,
      frequency: totals.get(year) ?? 0,
    })),
    total: rows.reduce((sum, row) => sum + row.gameFrequency, 0),
  };
}

export function getMapData(
  rows: GameRow[],
  countryCollection: CountryCollection,
  selectedYear: number,
) {
  const byIso3 = new Map<string, string>();
  const byIso2 = new Map<string, string>();
  const byNumeric = new Map<string, string>();
  const byName = new Map<string, string>();
  const displayNames = new Map<string, string>();

  for (const feature of countryCollection.features) {
    const properties = feature.properties ?? {};
    const key = String(properties.name ?? "");
    const displayName = String(properties.displayName ?? key);

    const iso3 = String(properties["ISO3166-1-Alpha-3"] ?? "").toUpperCase();

    const iso2 = String(properties["ISO3166-1-Alpha-2"] ?? "").toUpperCase();

    const rawNumeric = String(
      properties.ISO_N3_EH ?? properties.UN_A3 ?? properties.ISO_N3 ?? "",
    ).trim();
    const numeric = /^\d+$/.test(rawNumeric) ? String(Number(rawNumeric)) : "";

    if (numeric) byNumeric.set(numeric, key);
    if (iso3 && iso3 !== "-99") byIso3.set(iso3, key);
    if (iso2 && iso2 !== "-99") byIso2.set(iso2, key);

    byName.set(normalizeName(displayName), key);
    displayNames.set(key, displayName);
  }

  function resolveCountryKey(countryId: string): string | null {
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

    const normalized = normalizeName(id);
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

  const totals = new Map<string, number>();
  const unmatched = new Set<string>();

  for (const row of rows) {
    if (row.releaseYear > selectedYear) continue;

    const key = resolveCountryKey(row.countryId);

    if (!key) {
      unmatched.add(row.countryId || "Unknown country");
      continue;
    }

    totals.set(key, (totals.get(key) ?? 0) + row.gameFrequency);
  }

  return {
    data: [...totals.entries()].map(([name, value]) => ({
      name,
      value: Math.sqrt(value),
      actualValue: value,
      displayName: displayNames.get(name) ?? name,
    })),
    unmatched: [...unmatched].sort(),
    countriesWithData: totals.size,
    total: rows
      .filter((row) => row.releaseYear <= selectedYear)
      .reduce((sum, row) => sum + row.gameFrequency, 0),
  };
}
