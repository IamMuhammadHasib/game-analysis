<script setup lang="ts">
import Papa from "papaparse";
import type { ECharts, EChartsOption } from "echarts";
import type { Feature, FeatureCollection, Geometry } from "geojson";

type CsvRecord = Record<string, string | undefined>;

interface GameRow {
  countryId: string;
  country: string;
  releaseYear: number;
  genreId: string;
  genre: string;
  gameFrequency: number;
}

interface MapProperties extends Record<string, unknown> {
  name?: string;
  "ISO3166-1-Alpha-2"?: string;
  "ISO3166-1-Alpha-3"?: string;
  displayName?: string;
}

type CountryFeature = Feature<Geometry, MapProperties>;
type CountryCollection = FeatureCollection<Geometry, MapProperties>;

const view = ref<"chart" | "map">("chart");
const selectedGenres = ref<string[]>([]);
const genreMenuOpen = ref(false);
const rows = ref<GameRow[]>([]);
interface ChartRow {
  releaseYear: number;
  genreId: string;
  genre: string;
  gameFrequency: number;
}
const chartRows = ref<ChartRow[]>([]);
const countryCollection = ref<CountryCollection | null>(null);
const selectedYear = ref(2025);
const loading = ref(true);
const dataError = ref("");
const mapError = ref("");
const mapWarning = ref("");

const chartElement = ref<HTMLDivElement | null>(null);
const mapElement = ref<HTMLDivElement | null>(null);
let echarts: typeof import("echarts") | null = null;
let chartInstance: ECharts | null = null;
let mapInstance: ECharts | null = null;
let mapRegistered = false;

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

const genres = computed(() =>
  [
    ...new Set([
      ...rows.value.map((row) => row.genre),
      ...chartRows.value.map((row) => row.genre),
    ]),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b)),
);
const years = computed(() =>
  [...new Set(rows.value.map((row) => row.releaseYear))].sort((a, b) => a - b),
);
const minYear = computed(() => years.value[0] ?? 0);
const maxYear = computed(() => years.value.at(-1) ?? 0);

const filteredRows = computed(() => {
  if (selectedGenres.value.length === 0) return rows.value;
  const selected = new Set(selectedGenres.value);
  return rows.value.filter((row) => selected.has(row.genre));
});

const filteredChartRows = computed(() => {
  if (selectedGenres.value.length === 0) return chartRows.value;

  const selected = new Set(selectedGenres.value);

  return chartRows.value.filter((row) => selected.has(row.genre));
});

const chartData = computed(() => {
  const totals = new Map<number, number>();

  for (const row of filteredChartRows.value) {
    totals.set(
      row.releaseYear,
      (totals.get(row.releaseYear) ?? 0) + row.gameFrequency,
    );
  }

  const chartYears = [
    ...new Set(chartRows.value.map((row) => row.releaseYear)),
  ].sort((a, b) => a - b);

  return chartYears.map((year) => ({
    year,
    frequency: totals.get(year) ?? 0,
  }));
});

const filteredTotal = computed(() =>
  filteredChartRows.value.reduce((sum, row) => sum + row.gameFrequency, 0),
);

const cumulativeTotal = computed(() =>
  filteredRows.value
    .filter((row) => row.releaseYear <= selectedYear.value)
    .reduce((sum, row) => sum + row.gameFrequency, 0),
);

const selectedGenreLabel = computed(() => {
  if (selectedGenres.value.length === 0) return "All genres";
  return selectedGenres.value.join(", ");
});

const countryIndexes = computed(() => {
  const byIso3 = new Map<string, string>();
  const byIso2 = new Map<string, string>();
  const byName = new Map<string, string>();
  const byNumeric = new Map<string, string>();
  const displayNames = new Map<string, string>();

  for (const feature of countryCollection.value?.features ?? []) {
    const properties = feature.properties ?? {};
    const displayName = String(
      properties.displayName ?? properties.name ?? "Unknown",
    );
    const key = String(properties.name ?? normalizeName(displayName));
    const iso3 = String(properties["ISO3166-1-Alpha-3"] ?? "").toUpperCase();
    const iso2 = String(properties["ISO3166-1-Alpha-2"] ?? "").toUpperCase();
    const rawNumeric = String(properties.ISO_N3 ?? "").trim();

    const numeric = /^\d+$/.test(rawNumeric) ? String(Number(rawNumeric)) : "";

    if (numeric) {
      byNumeric.set(numeric, key);
    }

    if (iso3 && iso3 !== "-99") byIso3.set(iso3, key);
    if (iso2 && iso2 !== "-99") byIso2.set(iso2, key);
    byName.set(normalizeName(displayName), key);
    displayNames.set(key, displayName);
  }

  return { byIso3, byIso2, byNumeric, byName, displayNames };
});

function resolveCountryKey(
  countryId: string,
  countryName: string,
): string | null {
  const id = countryId.trim().toUpperCase();
  if (/^\d+$/.test(id)) {
    const numericMatch = countryIndexes.value.byNumeric.get(String(Number(id)));
    if (numericMatch) return numericMatch;
  }
  if (/^[A-Z]{3}$/.test(id)) {
    const byIso3 = countryIndexes.value.byIso3.get(id);
    if (byIso3) return byIso3;
  }
  if (/^[A-Z]{2}$/.test(id)) {
    const byIso2 = countryIndexes.value.byIso2.get(id);
    if (byIso2) return byIso2;
  }

  const normalized = normalizeName(countryName);
  const direct = countryIndexes.value.byName.get(normalized);
  if (direct) return direct;

  // Try common alternate country names in both directions.
  const candidates = new Set<string>();
  for (const [canonical, aliases] of Object.entries(countryNameAliases)) {
    const normalizedCanonical = normalizeName(canonical);
    const normalizedAliases = aliases.map(normalizeName);
    if (
      normalized === normalizedCanonical ||
      normalizedAliases.includes(normalized)
    ) {
      candidates.add(normalizedCanonical);
      for (const alias of normalizedAliases) candidates.add(alias);
    }
  }
  for (const candidate of candidates) {
    const match = countryIndexes.value.byName.get(candidate);
    if (match) return match;
  }
  return null;
}

const mapData = computed(() => {
  const totals = new Map<string, number>();
  const unmatched = new Set<string>();

  for (const row of filteredRows.value) {
    if (row.releaseYear > selectedYear.value) continue;
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
      displayName: countryIndexes.value.displayNames.get(name) ?? name,
    })),
    unmatched: [...unmatched].sort(),
    countriesWithData: totals.size,
  };
});

const numberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});
const formatNumber = (value: number) => numberFormat.format(value);

function toggleGenre(genre: string) {
  const selected = [...selectedGenres.value];
  if (selected.includes(genre)) {
    selectedGenres.value = selected.filter((item) => item !== genre);
  } else if (selected.length < 2) {
    selected.push(genre);
    selectedGenres.value = selected;
  }
}

function chooseAllGenres() {
  selectedGenres.value = [];
}

function parseGameCsv(csvText: string): GameRow[] {
  const parsed = Papa.parse<CsvRecord>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim().toLowerCase(),
    transform: (value) => value.trim(),
  });

  const required = [
    "country_id",
    "country",
    "release_year",
    "genre_id",
    "genre",
    "game_frequency",
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
    if (!Number.isFinite(releaseYear) || !Number.isFinite(gameFrequency))
      return [];

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

function parseChartCsv(csvText: string): ChartRow[] {
  const parsed = Papa.parse<CsvRecord>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim().toLowerCase(),
    transform: (value) => value.trim(),
  });

  const required = ["release_year", "genre_id", "genre", "game_frequency"];

  const headers = (parsed.meta.fields ?? []).map((header) =>
    header.trim().toLowerCase(),
  );

  const missing = required.filter((field) => !headers.includes(field));

  if (missing.length) {
    throw new Error(`Chart CSV is missing column(s): ${missing.join(", ")}`);
  }

  return parsed.data.flatMap((record) => {
    const releaseYear = Number(record.release_year);
    const gameFrequency = Number(record.game_frequency);

    if (!Number.isFinite(releaseYear) || !Number.isFinite(gameFrequency)) {
      return [];
    }

    return [
      {
        releaseYear,
        genreId: String(record.genre_id ?? "").trim(),
        genre: String(record.genre ?? "").trim(),
        gameFrequency,
      },
    ];
  });
}

async function loadData() {
  loading.value = true;
  dataError.value = "";
  mapError.value = "";
  try {
    const csvResponse = await fetch("/data/games.csv");
    if (!csvResponse.ok)
      throw new Error(
        "Could not load /data/games.csv. Check that the file exists in public/data/.",
      );
    rows.value = parseGameCsv(await csvResponse.text());

    if (!rows.value.length) {
      throw new Error("The map CSV contains no usable data rows.");
    }

    // Load chart dataset
    const chartResponse = await fetch("/data/games-without-country.csv");

    if (!chartResponse.ok) {
      throw new Error("Could not load /data/games-without-country.csv.");
    }

    chartRows.value = parseChartCsv(await chartResponse.text());

    if (!chartRows.value.length) {
      throw new Error("The chart CSV contains no usable data rows.");
    }

    selectedYear.value = maxYear.value;
  } catch (error) {
    dataError.value =
      error instanceof Error ? error.message : "Could not load the CSV data.";
  }

  try {
    const mapResponse = await fetch("/data/countries.geojson");
    if (!mapResponse.ok)
      throw new Error(
        "World boundaries are missing. Run the map-data download script in the project README.",
      );
    const rawGeoJson = (await mapResponse.json()) as CountryCollection;
    const features = rawGeoJson.features
      .filter((feature) => feature.geometry !== null)
      .map((feature: CountryFeature) => {
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
        const key = iso3 || normalizeName(displayName);
        return {
          ...feature,
          properties: {
            ...properties,
            "ISO3166-1-Alpha-3": iso3,
            "ISO3166-1-Alpha-2": iso2,
            name: key,
            displayName,
          },
        };
      }) as CountryFeature[];

    countryCollection.value = { ...rawGeoJson, features };
    echarts?.registerMap("game-world", { geoJSON: countryCollection.value });
    mapRegistered = true;
  } catch (error) {
    mapError.value =
      error instanceof Error
        ? error.message
        : "Could not load world map boundaries.";
  } finally {
    loading.value = false;
    await nextTick();
    initialiseCharts();
    refreshCharts();
  }
}

function buildChartOption(): EChartsOption {
  const data = chartData.value;
  return {
    animationDuration: 450,
    grid: { left: 58, right: 24, top: 34, bottom: 48 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#14283f",
      borderWidth: 0,
      textStyle: { color: "#fff" },
      axisPointer: {
        type: "line",
        lineStyle: { color: "#9bb2c7", type: "dashed" },
      },
      formatter: (params: unknown) => {
        const items = Array.isArray(params)
          ? (params as Array<{ axisValue?: string; data?: number }>)
          : [];
        const first = items[0];
        return `<strong>${first?.axisValue ?? ""}</strong><br/>Game frequency: ${formatNumber(Number(first?.data ?? 0))}`;
      },
    },
    xAxis: {
      type: "category",
      data: data.map((item) => String(item.year)),
      boundaryGap: true,
      axisTick: { alignWithLabel: true },
      axisLine: { lineStyle: { color: "#dbe3eb" } },
      axisLabel: { color: "#718096", hideOverlap: true },
    },
    yAxis: {
      type: "value",
      name: "Game frequency",
      nameTextStyle: { color: "#718096", padding: [0, 0, 10, 0] },
      splitLine: { lineStyle: { color: "#edf1f5", type: "dashed" } },
      axisLabel: { color: "#718096" },
    },
    series: [
      {
        name: "Annual frequency",
        type: "bar",
        barMaxWidth: 28,
        data: data.map((item) => item.frequency),
        itemStyle: { color: "#4b9b9a", borderRadius: [5, 5, 0, 0] },
        emphasis: { itemStyle: { color: "#277b81" } },
      },
      {
        name: "Trend",
        type: "line",
        data: data.map((item) => item.frequency),
        smooth: 0.25,
        symbol: "circle",
        symbolSize: 7,
        lineStyle: { color: "#244f78", width: 2.5 },
        itemStyle: { color: "#244f78", borderColor: "#fff", borderWidth: 2 },
        tooltip: { show: false },
        z: 3,
      },
    ],
  };
}

function buildMapOption(): EChartsOption {
  const values = mapData.value.data.map((item) => item.value);
  const maxValue = Math.max(1, ...values);
  return {
    animationDuration: 400,
    tooltip: {
      trigger: "item",
      backgroundColor: "#14283f",
      borderWidth: 0,
      textStyle: { color: "#fff" },
      formatter: (params: unknown) => {
        const item = params as {
          name?: string;
          value?: number;
          data?: { displayName?: string; value?: number };
        };
        const name = item.data?.displayName ?? item.name ?? "Country";
        const value = Number(item.data?.value ?? item.value ?? 0);
        return `<strong>${name}</strong><br/>Cumulative frequency: ${formatNumber(value)}`;
      },
    },
    visualMap: {
      type: "continuous",
      min: 0,
      max: maxValue,

      show: false,

      orient: "horizontal",
      left: "center",
      bottom: 14,

      calculable: false,
      realtime: true,

      text: ["Higher", "Lower"],
      textGap: 10,
      textStyle: {
        color: "#66768a",
        fontSize: 11,
      },

      itemWidth: 220,
      itemHeight: 12,

      inRange: {
        color: ["#edf4e8", "#b8d8b1", "#79bca7", "#3989a8", "#164d7c"],
      },
    },
    series: [
      {
        name: "Cumulative game frequency",
        type: "map",
        map: "game-world",
        roam: true,
        selectedMode: false,
        zoom: 1,
        layoutCenter: ["50%", "52%"],
        layoutSize: "165%",
        itemStyle: {
          areaColor: "#f0f3f5",
          borderColor: "#fff",
          borderWidth: 0.55,
        },
        emphasis: {
          label: { show: false },
          itemStyle: {
            areaColor: "#f2bd63",
            borderColor: "#fff",
            borderWidth: 1,
          },
        },
        data: mapData.value.data,
      },
    ],
  };
}

function initialiseCharts() {
  if (!import.meta.client || !echarts) return;

  if (view.value === "chart") {
    if (chartElement.value && !chartInstance) {
      chartInstance = echarts.init(chartElement.value);
    }
  } else {
    if (mapElement.value && !mapInstance && mapRegistered) {
      mapInstance = echarts.init(mapElement.value);
    }
  }
}

function refreshCharts() {
  if (!echarts) return;

  if (view.value === "chart") {
    if (chartInstance) {
      chartInstance.setOption(buildChartOption(), true);
    }
    return;
  }

  if (view.value === "map" && mapRegistered && mapInstance) {
    mapInstance.setOption(buildMapOption(), true);
  }

  mapWarning.value = mapData.value.unmatched.length
    ? `${mapData.value.unmatched.length} country name(s) could not be matched to map boundaries.`
    : "";
}

function resizeCharts() {
  if (view.value === "chart") {
    chartInstance?.resize();
  } else {
    mapInstance?.resize();
  }
}

watch(
  [selectedGenres, selectedYear, chartData, mapData, view],
  async () => {
    await nextTick();

    initialiseCharts();
    refreshCharts();

    // Wait for the visible container to have its final dimensions.
    await nextTick();

    resizeCharts();
  },
  { deep: true, flush: "post" },
);

onMounted(async () => {
  const echartsModule = await import("echarts");
  echarts = echartsModule;
  await loadData();
  window.addEventListener("resize", resizeCharts);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", resizeCharts);
  chartInstance?.dispose();
  mapInstance?.dispose();
  chartInstance = null;
  mapInstance = null;
});
</script>

<template>
  <main class="page-shell">
    <section class="dashboard-card">
      <div class="controls-row">
        <div class="genre-control">
          <!-- <label class="control-label">GENRE</label> -->
          <details
            class="genre-dropdown"
            :open="genreMenuOpen"
            @toggle="genreMenuOpen = ($event.target as HTMLDetailsElement).open"
          >
            <summary>
              <span class="genre-value">{{ selectedGenreLabel }}</span>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m3.5 6 4.5 4 4.5-4" />
              </svg>
            </summary>
            <div class="genre-menu-panel">
              <button
                class="all-genres-option"
                :class="{ active: selectedGenres.length === 0 }"
                type="button"
                @click="chooseAllGenres"
              >
                <span class="checkbox-visual">{{
                  selectedGenres.length === 0 ? "✓" : ""
                }}</span>
                All genres
              </button>
              <div class="genre-divider"></div>
              <label
                v-for="genre in genres"
                :key="genre"
                class="genre-option"
                :class="{
                  disabled:
                    selectedGenres.length >= 2 &&
                    !selectedGenres.includes(genre),
                }"
              >
                <input
                  type="checkbox"
                  :checked="selectedGenres.includes(genre)"
                  :disabled="
                    selectedGenres.length >= 2 &&
                    !selectedGenres.includes(genre)
                  "
                  @change="toggleGenre(genre)"
                />
                <span>{{ genre }}</span>
              </label>
              <p class="genre-help">Choose up to two genres, or select all.</p>
            </div>
          </details>
        </div>

        <div v-if="view === 'map'" class="year-control toolbar-year">
          <div class="year-slider-container">
            <span class="year-min">{{ minYear }}</span>

            <div class="year-slider-track">
              <div
                class="year-slider-thumb"
                :style="{
                  left: `calc(28px + (100% - 56px) * ${
                    maxYear > minYear
                      ? (selectedYear - minYear) / (maxYear - minYear)
                      : 0
                  })`,
                }"
              >
                {{ selectedYear }}
                <span class="drag-indicator">⠿</span>
              </div>

              <input
                id="year-slider"
                v-model.number="selectedYear"
                type="range"
                :min="minYear"
                :max="maxYear"
                :step="1"
                aria-label="Cumulative through year"
              />
            </div>

            <span class="year-max">{{ maxYear }}</span>
          </div>
        </div>

        <div class="view-control">
          <!-- <label class="control-label">VIEW</label> -->
          <div
            class="segmented-control"
            role="group"
            aria-label="Choose visualization"
          >
            <button
              type="button"
              :class="{ active: view === 'chart' }"
              @click="view = 'chart'"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d="M3 16.5V9.5h3v7H3Zm5.5 0V4h3v12.5h-3Zm5.5 0v-5h3v5h-3Z"
                />
              </svg>
              Chart
            </button>
            <button
              type="button"
              :class="{ active: view === 'map' }"
              @click="view = 'map'"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="m2.5 5 4.7-2 5.6 2 4.7-2v12l-4.7 2-5.6-2-4.7 2V5Z" />
                <path d="M7.2 3v12m5.6-10v12" />
              </svg>
              Map
            </button>
          </div>
        </div>
      </div>

      <div v-if="loading" class="status-panel">
        <div class="loader"></div>
        <span>Loading your release data…</span>
      </div>

      <div v-else-if="dataError" class="error-panel">
        <strong>We couldn't load your CSV.</strong>
        <span>{{ dataError }}</span>
        <span class="error-hint"
          >Expected columns: country_id, country, release_year, genre_id, genre,
          game_frequency.</span
        >
      </div>

      <template v-else>
        <div v-show="view === 'chart'" class="visual-section">
          <div class="visual-heading">
            <div>
              <p class="eyebrow">GLOBAL OVERVIEW</p>
              <h2>Release frequency by year</h2>
              <p class="visual-subtitle">
                All countries combined · {{ selectedGenreLabel }}
              </p>
            </div>
            <div class="stat-chip">
              <span class="stat-label">TOTAL FREQUENCY</span>
              <strong>{{ formatNumber(filteredTotal) }}</strong>
            </div>
          </div>
          <div
            ref="chartElement"
            class="chart-canvas"
            role="img"
            aria-label="Bar and line chart showing game release frequency by year"
          ></div>
          <div class="chart-footnote">
            <span class="legend-swatch bar-swatch"></span> Annual frequency
            <span class="legend-swatch line-swatch"></span> Trend line
            <span class="footnote-tail"
              >Counts are summed across all countries.</span
            >
          </div>
        </div>

        <div v-show="view === 'map'" class="visual-section map-section">
          <div v-if="mapError" class="map-missing-panel">
            <strong>World map data is not installed yet.</strong>
            <span>{{ mapError }}</span>
            <code>./scripts/download-map.sh</code>
          </div>

          <div v-else class="map-stage">
            <!-- World map -->
            <div
              ref="mapElement"
              class="map-canvas"
              role="img"
              aria-label="World choropleth map showing cumulative game frequency by country"
            ></div>

            <!-- Floating heading -->
            <div class="floating-map-heading">
              <p class="eyebrow">COUNTRY DISTRIBUTION</p>
              <h2>Cumulative game frequency</h2>
              <p class="visual-subtitle">
                {{ minYear }} through {{ selectedYear }} ·
                {{ selectedGenreLabel }}
              </p>
            </div>

            <!-- Floating cumulative summary -->
            <div class="floating-map-stat">
              <span class="stat-label">CUMULATIVE FREQUENCY</span>
              <strong>{{ formatNumber(cumulativeTotal) }}</strong>
            </div>

            <!-- Floating legend -->
            <div class="custom-map-legend">
              <span>Lower</span>
              <div class="legend-gradient"></div>
              <span>Higher</span>
            </div>
          </div>
        </div>
      </template>
    </section>
  </main>
</template>
