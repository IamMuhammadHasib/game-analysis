<script setup lang="ts">
import type { ECharts, EChartsOption } from "echarts";
import {
  loadDashboardData,
  getChartData,
  getMapData,
  type GameRow,
  type GenreOption,
  type CountryCollection,
} from "../utils/dashboardData";

// --------------------------------------------------
// Dashboard state
// --------------------------------------------------

const view = ref<"chart" | "map">("chart");
const selectedGenres = ref<string[]>([]);
const genreMenuOpen = ref(false);

const genres = ref<GenreOption[]>([]);
const chartRows = ref<GameRow[]>([]);
const mapRows = ref<GameRow[]>([]);
const countryCollection = ref<CountryCollection | null>(null);

const selectedYear = ref(2025);

const loading = ref(true);
const hasLoaded = ref(false);
const dataError = ref("");
const mapWarning = ref("");

const chartElement = ref<HTMLDivElement | null>(null);
const mapElement = ref<HTMLDivElement | null>(null);

// --------------------------------------------------
// ECharts
// --------------------------------------------------

let echarts: typeof import("echarts") | null = null;
let chartInstance: ECharts | null = null;
let mapInstance: ECharts | null = null;
let mapRegistered = false;

let requestId = 0;

// --------------------------------------------------
// Computed data
// --------------------------------------------------

const years = ref<number[]>([]);

const minYear = computed(() => years.value[0] ?? 0);
const maxYear = computed(() => years.value.at(-1) ?? 0);

const chartData = computed(() => getChartData(chartRows.value, years.value));

const genreDropdown = ref<HTMLDetailsElement | null>(null);

const mapData = computed(() => {
  if (!countryCollection.value) {
    return {
      data: [],
      unmatched: [],
      countriesWithData: 0,
      total: 0,
    };
  }

  return getMapData(mapRows.value, countryCollection.value, selectedYear.value);
});

const filteredTotal = computed(() => chartData.value.total);
const cumulativeTotal = computed(() => mapData.value.total);

const selectedGenreLabel = computed(() => {
  if (selectedGenres.value.length === 0) {
    return "All genres";
  }

  return genres.value
    .filter((genre) => selectedGenres.value.includes(genre.genreId))
    .map((genre) => genre.genre)
    .join(", ");
});

const numberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

function formatNumber(value: number): string {
  return numberFormat.format(value);
}

// --------------------------------------------------
// Genre selection
// --------------------------------------------------

function toggleGenre(genreId: string) {
  if (selectedGenres.value.includes(genreId)) {
    selectedGenres.value = selectedGenres.value.filter((id) => id !== genreId);
  } else {
    selectedGenres.value = [...selectedGenres.value, genreId];
  }
}

function chooseAllGenres() {
  selectedGenres.value = [];
}

function handleOutsideClick(event: MouseEvent) {
  const target = event.target as Node | null;

  if (target && !genreDropdown.value?.contains(target)) {
    genreMenuOpen.value = false;
  }
}

// --------------------------------------------------
// Load data
// --------------------------------------------------

async function loadData() {
  const currentRequest = ++requestId;
  const isInitialLoad = !hasLoaded.value;

  if (isInitialLoad) {
    loading.value = true;
  }

  dataError.value = "";

  try {
    // An empty array means All genres.
    const result = await loadDashboardData([...selectedGenres.value]);

    // Ignore outdated responses if another filter request started.
    if (currentRequest !== requestId) return;

    genres.value = result.genres ?? [];
    chartRows.value = result.chartRows ?? [];
    mapRows.value = result.mapRows ?? [];
    countryCollection.value = result.countryCollection;
    years.value = (result.years ?? [])
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    // Keep the selected year within the available range.
    if (years.value.length > 0) {
      selectedYear.value = Math.min(
        Math.max(selectedYear.value, minYear.value),
        maxYear.value,
      );
    } else {
      selectedYear.value = 0;
    }

    // Register the map once the GeoJSON is available.
    if (echarts && countryCollection.value && !mapRegistered) {
      echarts.registerMap("game-world", {
        geoJSON: countryCollection.value,
      });

      mapRegistered = true;
    }

    // IMPORTANT:
    // Reveal the chart/map elements before trying to initialize ECharts.
    hasLoaded.value = true;
    loading.value = false;

    // Wait for Vue to render the chart/map DOM elements.
    await nextTick();

    if (currentRequest !== requestId) return;

    initialiseCharts();
    refreshCharts();
    resizeCharts();
  } catch (error) {
    if (currentRequest !== requestId) return;

    const message =
      error instanceof Error ? error.message : "Could not load dashboard data.";

    if (!hasLoaded.value) {
      // Show the full error panel only if the initial load failed.
      dataError.value = message;
    } else {
      // On a filter refresh, keep the existing chart visible.
      console.error("Could not refresh dashboard data:", error);
    }
  } finally {
    if (currentRequest === requestId) {
      loading.value = false;
      hasLoaded.value = true;
    }
  }
}

// --------------------------------------------------
// Chart configuration
// --------------------------------------------------

function buildChartOption(): EChartsOption {
  const data = chartData.value.data;

  return {
    animationDuration: 450,

    grid: {
      left: 58,
      right: 24,
      top: 34,
      bottom: 48,
    },

    tooltip: {
      trigger: "axis",
      backgroundColor: "#14283f",
      borderWidth: 0,
      textStyle: { color: "#fff" },

      axisPointer: {
        type: "line",
        lineStyle: {
          color: "#9bb2c7",
          type: "dashed",
        },
      },

      formatter: (params: unknown) => {
        const items = Array.isArray(params)
          ? (params as Array<{
              axisValue?: string;
              data?: number | null;
            }>)
          : [];

        const first = items[0];

        return `<strong>${first?.axisValue ?? ""}</strong><br/>Game frequency: ${formatNumber(Number(first?.data ?? 0))}`;
      },
    },

    xAxis: {
      type: "category",
      data: data.map((item) => String(item.year)),
      boundaryGap: true,

      axisTick: {
        alignWithLabel: true,
      },

      axisLine: {
        lineStyle: { color: "#dbe3eb" },
      },

      axisLabel: {
        color: "#718096",
        hideOverlap: true,
      },
    },

    yAxis: {
      type: "value",
      name: "Game frequency",

      nameTextStyle: {
        color: "#718096",
        padding: [0, 0, 10, 0],
      },

      min: 0,

      splitLine: {
        lineStyle: {
          color: "#edf1f5",
          type: "dashed",
        },
      },

      axisLabel: {
        color: "#718096",
      },
    },

    series: [
      {
        name: "Annual frequency",
        type: "bar",
        barMaxWidth: 28,

        data: data.map((item) => item.frequency),

        itemStyle: {
          color: "#4b9b9a",
          borderRadius: [5, 5, 0, 0],
        },

        emphasis: {
          itemStyle: {
            color: "#277b81",
          },
        },
      },

      {
        name: "Trend",
        type: "line",

        data: data.map((item) => item.frequency),

        smooth: 0.25,
        symbol: "circle",
        symbolSize: 7,

        lineStyle: {
          color: "#244f78",
          width: 2.5,
        },

        itemStyle: {
          color: "#244f78",
          borderColor: "#fff",
          borderWidth: 2,
        },

        tooltip: {
          show: false,
        },

        z: 3,
      },
    ],
  };
}

// --------------------------------------------------
// Map configuration
// --------------------------------------------------

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
          value?: number | null;
          data?: {
            displayName?: string;
            value?: number | null;
            actualValue?: number | null;
          };
        };

        const name = item?.data?.displayName ?? item?.name ?? "Country";

        const value = Number(item?.data?.actualValue ?? 0);

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
          label: {
            show: false,
          },

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

// --------------------------------------------------
// Chart lifecycle
// --------------------------------------------------

function initialiseCharts() {
  if (!import.meta.client || !echarts) return;

  if (view.value === "chart" && chartElement.value && !chartInstance) {
    chartInstance = echarts.init(chartElement.value);
  }

  if (
    view.value === "map" &&
    mapElement.value &&
    !mapInstance &&
    mapRegistered
  ) {
    mapInstance = echarts.init(mapElement.value);
  }
}

function refreshCharts() {
  if (!echarts) return;

  if (view.value === "chart") {
    if (chartElement.value) {
      initialiseCharts();

      chartInstance?.setOption(buildChartOption(), true);
    }

    return;
  }

  if (view.value === "map" && mapRegistered) {
    if (mapElement.value) {
      initialiseCharts();

      mapInstance?.setOption(buildMapOption(), true);
    }
  }

  // mapWarning.value = mapData.value.unmatched.length
  //   ? `${mapData.value.unmatched.length} country ID(s) could not be matched to map boundaries.`
  //   : "";
}

function resizeCharts() {
  if (view.value === "chart") {
    chartInstance?.resize();
  } else {
    mapInstance?.resize();
  }
}

async function changeView(nextView: "chart" | "map") {
  view.value = nextView;

  await nextTick();

  initialiseCharts();
  refreshCharts();
  resizeCharts();
}

// --------------------------------------------------
// Watchers
// --------------------------------------------------

watch(selectedGenres, () => {
  loadData();
});

watch(selectedYear, async () => {
  if (view.value !== "map") return;

  await nextTick();

  refreshCharts();
  resizeCharts();
});

watch(view, async () => {
  await nextTick();

  initialiseCharts();
  refreshCharts();
  resizeCharts();
});

// --------------------------------------------------
// Mount / unmount
// --------------------------------------------------

onMounted(async () => {
  echarts = await import("echarts");

  await loadData();

  window.addEventListener("resize", resizeCharts);
});

onBeforeUnmount(() => {
  // Invalidate pending requests.
  requestId++;

  window.removeEventListener("resize", resizeCharts);

  chartInstance?.dispose();
  mapInstance?.dispose();

  chartInstance = null;
  mapInstance = null;
});

onMounted(() => {
  document.addEventListener("click", handleOutsideClick);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", handleOutsideClick);
});
</script>

<template>
  <main class="page-shell">
    <section class="dashboard-card">
      <div class="controls-row">
        <div class="genre-control">
          <!-- <label class="control-label">GENRE</label> -->
          <details
            ref="genreDropdown"
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
                :key="genre.genreId"
                class="genre-option"
              >
                <input
                  type="checkbox"
                  :checked="selectedGenres.includes(genre.genreId)"
                  @change="toggleGenre(genre.genreId)"
                />
                <span>{{ genre.genre }}</span>
              </label>

              <p class="genre-help">
                Select any number of genres. All selected genres must match the
                same game.
              </p>
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
        <span>{{ dataError }}</span>
        <span class="error-hint"
          >Check the SQLite database and world boundaries data.</span
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
          <div class="map-stage">
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

            <div v-if="mapWarning" class="map-warning">
              {{ mapWarning }}
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
