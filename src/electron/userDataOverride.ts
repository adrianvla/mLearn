/**
 * Redirects the Electron userData directory when MLEARN_USER_DATA is set.
 *
 * Must be the first import of the main entry: it runs before any other
 * module can resolve a userData-derived path at import time. Used by
 * perf/testing harnesses to run against a cloned profile without touching
 * the user's real data.
 */
import { app } from 'electron';

const override = process.env.MLEARN_USER_DATA;
if (override) {
  app.setPath('userData', override);
}
