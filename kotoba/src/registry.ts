/**
 * open-airplane kotoba — airport + aircraft registries. AT PDS records (no RW).
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  AIRCRAFT_COLLECTION,
  AIRPORT_COLLECTION,
  aircraftDid,
  aircraftRkey,
  airportDid,
  airportRkey,
  isValidIata,
  isValidIcao,
  isValidIcao24,
  type AircraftRecord,
  type AircraftView,
  type AirportRecord,
  type AirportView,
  type DefineAirportInput,
  type DefineAirportOutput,
  type GetAircraftInput,
  type GetAircraftOutput,
  type GetAirportInput,
  type GetAirportOutput,
  type ListAircraftInput,
  type ListAircraftOutput,
  type ListAirportsInput,
  type ListAirportsOutput,
  type RegisterAircraftInput,
  type RegisterAircraftOutput,
} from "./types.js";

// ─── Airport ────────────────────────────────────────────────────────

export async function defineAirport(
  e: Etzhayyim,
  input: DefineAirportInput
): Promise<DefineAirportOutput> {
  if (!input.icao || !input.name) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  const icao = input.icao.toUpperCase();
  if (!isValidIcao(icao)) return { status: "rejected", error: "invalidIcao" };
  if (input.iata && !isValidIata(input.iata.toUpperCase())) {
    return { status: "rejected", error: "invalidIata" };
  }

  const rkey = airportRkey(icao);
  const existing = await e
    .read<AirportRecord>({ collection: AIRPORT_COLLECTION, rkey })
    .catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return {
      status: "alreadyExists",
      airportUri: existing.records[0].uri,
      did: existing.records[0].value.did,
      icao,
    };
  }

  const did = airportDid(icao);
  const record: AirportRecord = {
    did,
    icao,
    iata: input.iata ? input.iata.toUpperCase() : undefined,
    name: input.name,
    country: input.country,
    runways: input.runways,
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({
    collection: AIRPORT_COLLECTION,
    record: record as unknown as Record<string, unknown>,
    rkey,
  });
  return { status: "defined", airportUri: receipt.uri, did, icao };
}

export async function getAirport(
  e: Etzhayyim,
  input: GetAirportInput
): Promise<GetAirportOutput> {
  if (!input.icao || !isValidIcao(input.icao.toUpperCase())) {
    return { error: "invalidIcao" };
  }
  const resp = await e
    .read<AirportRecord>({ collection: AIRPORT_COLLECTION, rkey: airportRkey(input.icao.toUpperCase()) })
    .catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r) return { error: "notFound" };
  return { airport: { ...r.value, airportUri: r.uri } };
}

export async function listAirports(
  e: Etzhayyim,
  input: ListAirportsInput = {}
): Promise<ListAirportsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<AirportRecord>({
    collection: AIRPORT_COLLECTION,
    cursor: input.cursor,
    limit,
  });
  const items: AirportView[] = resp.records
    .filter((r) => (input.country ? r.value.country === input.country : true))
    .map((r) => ({ ...r.value, airportUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Aircraft ───────────────────────────────────────────────────────

export async function registerAircraft(
  e: Etzhayyim,
  input: RegisterAircraftInput
): Promise<RegisterAircraftOutput> {
  if (!input.tailNumber) return { status: "rejected", error: "missingTailNumber" };
  if (input.icao24 && !isValidIcao24(input.icao24)) {
    return { status: "rejected", error: "invalidIcao24" };
  }

  const tail = input.tailNumber.toUpperCase();
  const rkey = aircraftRkey(tail);
  const existing = await e
    .read<AircraftRecord>({ collection: AIRCRAFT_COLLECTION, rkey })
    .catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return {
      status: "alreadyExists",
      aircraftUri: existing.records[0].uri,
      did: existing.records[0].value.did,
      tailNumber: tail,
    };
  }

  const did = aircraftDid(tail);
  const record: AircraftRecord = {
    did,
    tailNumber: tail,
    icao24: input.icao24 ? input.icao24.toLowerCase() : undefined,
    aircraftType: input.aircraftType,
    operator: input.operator,
    registrationCountry: input.registrationCountry,
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({
    collection: AIRCRAFT_COLLECTION,
    record: record as unknown as Record<string, unknown>,
    rkey,
  });
  return { status: "registered", aircraftUri: receipt.uri, did, tailNumber: tail };
}

export async function getAircraft(
  e: Etzhayyim,
  input: GetAircraftInput
): Promise<GetAircraftOutput> {
  if (!input.tailNumber) return { error: "missingTailNumber" };
  const resp = await e
    .read<AircraftRecord>({
      collection: AIRCRAFT_COLLECTION,
      rkey: aircraftRkey(input.tailNumber.toUpperCase()),
    })
    .catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r) return { error: "notFound" };
  return { aircraft: { ...r.value, aircraftUri: r.uri } };
}

export async function listAircraft(
  e: Etzhayyim,
  input: ListAircraftInput = {}
): Promise<ListAircraftOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<AircraftRecord>({
    collection: AIRCRAFT_COLLECTION,
    cursor: input.cursor,
    limit,
  });
  const items: AircraftView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.operator && v.operator !== input.operator) return false;
      if (input.aircraftType && v.aircraftType !== input.aircraftType) return false;
      return true;
    })
    .map((r) => ({ ...r.value, aircraftUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}
