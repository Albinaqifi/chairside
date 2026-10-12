/*
 * Loads .env into the process, once, for whoever imports this first: playwright.config.ts and
 * servers.ts, whose ports read the environment as they load. Local settings come from .env (see
 * .env.example), as for the other tests; a variable already set, as in CI, wins over the file.
 */
try {
  process.loadEnvFile();
} catch {
  // No .env file: e2eDatabase() says what is missing.
}
