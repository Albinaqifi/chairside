import { resetDatabase } from '../../src/db/reset.ts';
import { testDatabase } from './test-database.ts';

/** Builds the test database from nothing, using only the migrations, once per test run. */
export default async function setup(): Promise<void> {
  await resetDatabase(testDatabase());
}
