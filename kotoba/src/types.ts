/**
 * open-airplane kotoba — record types.
 *
 * Per ADR-2605203000 Option B. DID-addressed aviation operations: airports,
 * aircraft, flights (OOOI). Public aviation registry → AT PDS records (replaces
 * createKyselyDb). ADR-2605172000 kotoba.
 *
 * Identity hierarchy:
 *   did:web:open-airplane.etzhayyim.com                       — controller
 *   did:web:open-airplane.etzhayyim.com:airport:{icao}        — an airport
 *   did:web:open-airplane.etzhayyim.com:aircraft:{tail}       — an aircraft
 *   did:web:open-airplane.etzhayyim.com:flight:{flightId}     — a flight
 */

export const OAP_DID_PREFIX = "did:web:open-airplane.etzhayyim.com:" as const;

export const AIRPORT_COLLECTION = "com.etzhayyim.apps.openAirplane.airport";
export const AIRCRAFT_COLLECTION = "com.etzhayyim.apps.openAirplane.aircraft";
export const FLIGHT_COLLECTION = "com.etzhayyim.apps.openAirplane.flight";

// ─── Airport ────────────────────────────────────────────────────────

export interface AirportRecord {
  did: string;
  /** ICAO 4-letter code (canonical key, e.g. "RJTT"). */
  icao: string;
  /** IATA 3-letter code (e.g. "HND"). */
  iata?: string;
  name: string;
  /** ISO 3166-1 alpha-2 country. */
  country?: string;
  runways?: number;
  createdAt: string;
}

export interface AirportView extends AirportRecord {
  airportUri: string;
}

export interface DefineAirportInput {
  icao: string;
  name: string;
  iata?: string;
  country?: string;
  runways?: number;
}

export interface DefineAirportOutput {
  status: "defined" | "alreadyExists" | "rejected";
  airportUri?: string;
  did?: string;
  icao?: string;
  error?: string;
}

export interface GetAirportInput {
  icao: string;
}

export interface GetAirportOutput {
  airport?: AirportView;
  error?: string;
}

export interface ListAirportsInput {
  country?: string;
  limit?: number;
  cursor?: string;
}

export interface ListAirportsOutput {
  items: AirportView[];
  cursor?: string;
  total: number;
}

// ─── Aircraft ───────────────────────────────────────────────────────

export interface AircraftRecord {
  did: string;
  /** Registration / tail number (canonical key, e.g. "JA8089"). */
  tailNumber: string;
  /** ICAO 24-bit address, 6 hex. */
  icao24?: string;
  aircraftType?: string;
  operator?: string;
  registrationCountry?: string;
  createdAt: string;
}

export interface AircraftView extends AircraftRecord {
  aircraftUri: string;
}

export interface RegisterAircraftInput {
  tailNumber: string;
  icao24?: string;
  aircraftType?: string;
  operator?: string;
  registrationCountry?: string;
}

export interface RegisterAircraftOutput {
  status: "registered" | "alreadyExists" | "rejected";
  aircraftUri?: string;
  did?: string;
  tailNumber?: string;
  error?: string;
}

export interface GetAircraftInput {
  tailNumber: string;
}

export interface GetAircraftOutput {
  aircraft?: AircraftView;
  error?: string;
}

export interface ListAircraftInput {
  operator?: string;
  aircraftType?: string;
  limit?: number;
  cursor?: string;
}

export interface ListAircraftOutput {
  items: AircraftView[];
  cursor?: string;
  total: number;
}

// ─── Flight (OOOI) ──────────────────────────────────────────────────

/** OOOI lifecycle: scheduled → out → off → on → in (or cancelled). */
export type FlightStatus = "scheduled" | "out" | "off" | "on" | "in" | "cancelled";

export interface OooiTimes {
  out?: string;
  off?: string;
  on?: string;
  in?: string;
}

export interface FlightRecord {
  did: string;
  flightId: string;
  aircraftTail?: string;
  /** ICAO codes. */
  originIcao: string;
  destIcao: string;
  scheduledDep?: string;
  status: FlightStatus;
  oooi: OooiTimes;
  createdAt: string;
}

export interface FlightView extends FlightRecord {
  flightUri: string;
}

export interface ScheduleFlightInput {
  flightId: string;
  originIcao: string;
  destIcao: string;
  aircraftTail?: string;
  scheduledDep?: string;
}

export interface ScheduleFlightOutput {
  status: "scheduled" | "alreadyExists" | "rejected";
  flightUri?: string;
  did?: string;
  flightId?: string;
  error?: string;
}

export interface RecordFlightStatusInput {
  flightId: string;
  /** One of the OOOI events or "cancelled". */
  event: Exclude<FlightStatus, "scheduled">;
  /** ISO timestamp for the OOOI event (ignored for cancelled). */
  at?: string;
}

export interface RecordFlightStatusOutput {
  status: "updated" | "notFound" | "rejected";
  flightId?: string;
  newStatus?: FlightStatus;
  error?: string;
}

export interface GetFlightInput {
  flightId: string;
}

export interface GetFlightOutput {
  flight?: FlightView;
  error?: string;
}

export interface ListFlightsInput {
  originIcao?: string;
  destIcao?: string;
  status?: FlightStatus;
  aircraftTail?: string;
  limit?: number;
  cursor?: string;
}

export interface ListFlightsOutput {
  items: FlightView[];
  cursor?: string;
  total: number;
}

// ─── Validation + helpers ───────────────────────────────────────────

export function isValidIcao(s: string): boolean {
  return /^[A-Z]{4}$/.test(s);
}

export function isValidIata(s: string): boolean {
  return /^[A-Z]{3}$/.test(s);
}

export function isValidIcao24(s: string): boolean {
  return /^[0-9a-f]{6}$/i.test(s);
}

export function airportDid(icao: string): string {
  return `${OAP_DID_PREFIX}airport:${icao.toLowerCase()}`;
}

export function airportRkey(icao: string): string {
  return `airport-${icao.toLowerCase()}`;
}

export function aircraftDid(tail: string): string {
  return `${OAP_DID_PREFIX}aircraft:${tail.toLowerCase()}`;
}

export function aircraftRkey(tail: string): string {
  return `aircraft-${tail.toLowerCase()}`;
}

export function flightDid(flightId: string): string {
  return `${OAP_DID_PREFIX}flight:${flightId.toLowerCase()}`;
}

export function flightRkey(flightId: string): string {
  return `flight-${flightId.toLowerCase()}`;
}
