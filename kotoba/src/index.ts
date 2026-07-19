/**
 * open-airplane kotoba — barrel.
 *
 * Per ADR-2605203000 Option B. DID-addressed aviation operations registry on the
 * etzhayyim substrate (AT PDS records; no RW).
 *
 *   airport  : defineAirport / getAirport / listAirports
 *   aircraft : registerAircraft / getAircraft / listAircraft
 *   flight   : scheduleFlight / recordFlightStatus / getFlight / listFlights
 */

export * from "./types.js";
export {
  defineAirport,
  getAirport,
  listAirports,
  registerAircraft,
  getAircraft,
  listAircraft,
} from "./registry.js";
export {
  scheduleFlight,
  recordFlightStatus,
  getFlight,
  listFlights,
} from "./flight.js";
