import initSqlJs from "sql.js/dist/sql-wasm-inline.js";
import path from "node:path";
import { createError } from "nuxt/internal/server-default";

let dbPromise: Promise<import("sql.js").Database> | null = null;

async function getDatabase() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const SQL = await initSqlJs();

      const storage = useStorage("assets:server");

      const file = await storage.getItemRaw<Uint8Array>(
        "game_research_light.db",
      );

      if (!file) {
        console.error("SQLite database missing from Nitro server assets.");

        throw createError({
          statusCode: 500,
          statusMessage: "SQLite database file was not found in server assets.",
        });
      }

      console.log("SQLite database loaded. Bytes:", file.length);

      return new SQL.Database(new Uint8Array(file));
    })().catch((error) => {
      dbPromise = null;
      throw error;
    });
  }

  return dbPromise;
}

function executeQuery(
  db: import("sql.js").Database,
  sql: string,
  params: (string | number)[] = [],
) {
  const statement = db.prepare(sql);
  const rows: Record<string, unknown>[] = [];

  try {
    statement.bind(params);

    while (statement.step()) {
      rows.push(statement.getAsObject() as Record<string, unknown>);
    }
  } finally {
    statement.free();
  }

  return rows;
}

export default defineEventHandler(async (event) => {
  try {
    console.log("[dashboard] Starting API request");

    const db = await getDatabase();

    console.log("[dashboard] Database initialized");

    const query = getQuery(event);

    // Read selected genre IDs from the URL.
    const rawGenres = query.genres;
    const requestedIds = (
      Array.isArray(rawGenres) ? rawGenres : String(rawGenres ?? "").split(",")
    )
      .map((id) => String(id).trim())
      .filter(Boolean);

    const selectedGenreIds = [...new Set(requestedIds)];

    // Always return every genre, even if no games use it.
    const genreOptions = executeQuery(
      db,
      `SELECT genre_id, genre
     FROM genres
     ORDER BY genre`,
    );

    // Reject IDs that do not exist in the genres table.
    const availableIds = new Set(
      genreOptions.map((item) => String(item.genre_id)),
    );

    const invalidIds = selectedGenreIds.filter((id) => !availableIds.has(id));

    if (invalidIds.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: `Unknown genre ID(s): ${invalidIds.join(", ")}`,
      });
    }

    // Each qualifying game must have every selected genre.
    const genreCondition = selectedGenreIds.length
      ? `AND g.game_id IN (
         SELECT gg.game_id
         FROM game_genres gg
         WHERE gg.genre_id IN (${selectedGenreIds.map(() => "?").join(", ")})
         GROUP BY gg.game_id
         HAVING COUNT(DISTINCT gg.genre_id) = ?
       )`
      : "";

    const genreParams: (string | number)[] = selectedGenreIds.length
      ? [...selectedGenreIds, selectedGenreIds.length]
      : [];

    // Count each qualifying game once per release year.
    const chartRows = executeQuery(
      db,
      `SELECT
       g.release_year,
       COUNT(DISTINCT g.game_id) AS game_frequency
     FROM games g
     WHERE g.release_year IS NOT NULL
       ${genreCondition}
     GROUP BY g.release_year
     ORDER BY g.release_year`,
      genreParams,
    );

    // Count each qualifying game once per country and release year.
    const mapRows = executeQuery(
      db,
      `SELECT
       gc.country_id,
       g.release_year,
       COUNT(DISTINCT g.game_id) AS game_frequency
     FROM games g
     JOIN game_countries gc
       ON gc.game_id = g.game_id
     WHERE g.release_year IS NOT NULL
       AND gc.country_id IS NOT NULL
       ${genreCondition}
     GROUP BY gc.country_id, g.release_year
     ORDER BY g.release_year`,
      genreParams,
    );

    const yearOptions = executeQuery(
      db,
      `SELECT DISTINCT release_year
   FROM games
   WHERE release_year IS NOT NULL
   ORDER BY release_year`,
    );

    return {
      genreOptions,
      yearOptions,
      chartRows,
      mapRows,
    };
  } catch (error) {
    console.error("[dashboard] API failed:", error);

    throw createError({
      statusCode: 500,
      statusMessage: "Dashboard API failed. Check Vercel function logs.",
    });
  }
});
