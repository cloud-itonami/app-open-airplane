/**
 * open-airplane kotoba — flight tier (OOOI lifecycle). AT PDS records (no RW).
 * scheduleFlight / recordFlightStatus (out/off/on/in/cancelled) / getFlight /
 * listFlights.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  AIRPORT_COLLECTION,
  FLIGHT_COLLECTION,
  airportRkey,
  flightDid,
  flightRkey,
  isValidIcao,
  type AirportRecord,
  type FlightRecord,
  type FlightStatus,
  type FlightView,
  type GetFlightInput,
  type GetFlightOutput,
  type ListFlightsInput,
  type ListFlightsOutput,
  type RecordFlightStatusInput,
  type RecordFlightStatusOutput,
  type ScheduleFlightInput,
  type ScheduleFlightOutput,
} from "./types.js";

const OOOI_EVENTS: ReadonlySet<string> = new Set(["out", "off", "on", "in", "cancelled"]);

async function airportExists(e: Etzhayyim, icao: string): Promise<boolean> {
  const resp = await e
    .read<AirportRecord>({ collection: AIRPORT_COLLECTION, rkey: airportRkey(icao) })
    .catch(() => ({ records: [] }));
  return Boolean(resp.records[0]?.value);
}

export async function scheduleFlight(
  e: Etzhayyim,
  input: ScheduleFlightInput
): Promise<ScheduleFlightOutput> {
  if (!input.flightId || !input.originIcao || !input.destIcao) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  const origin = input.originIcao.toUpperCase();
  const dest = input.destIcao.toUpperCase();
  if (!isValidIcao(origin) || !isValidIcao(dest)) {
    return { status: "rejected", error: "invalidIcao" };
  }
  if (origin === dest) return { status: "rejected", error: "originEqualsDestination" };
  if (!(await airportExists(e, origin)) || !(await airportExists(e, dest))) {
    return { status: "rejected", error: "airportNotDefined" };
  }

  const rkey = flightRkey(input.flightId);
  const existing = await e
    .read<FlightRecord>({ collection: FLIGHT_COLLECTION, rkey })
    .catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return {
      status: "alreadyExists",
      flightUri: existing.records[0].uri,
      did: existing.records[0].value.did,
      flightId: input.flightId,
    };
  }

  const did = flightDid(input.flightId);
  const record: FlightRecord = {
    did,
    flightId: input.flightId,
    aircraftTail: input.aircraftTail ? input.aircraftTail.toUpperCase() : undefined,
    originIcao: origin,
    destIcao: dest,
    scheduledDep: input.scheduledDep,
    status: "scheduled",
    oooi: {},
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({
    collection: FLIGHT_COLLECTION,
    record: record as unknown as Record<string, unknown>,
    rkey,
  });
  return { status: "scheduled", flightUri: receipt.uri, did, flightId: input.flightId };
}

export async function recordFlightStatus(
  e: Etzhayyim,
  input: RecordFlightStatusInput
): Promise<RecordFlightStatusOutput> {
  if (!input.flightId || !OOOI_EVENTS.has(input.event)) {
    return { status: "rejected", error: "invalidEvent" };
  }
  const rkey = flightRkey(input.flightId);
  const resp = await e
    .read<FlightRecord>({ collection: FLIGHT_COLLECTION, rkey })
    .catch(() => ({ records: [] }));
  const flight = resp.records[0]?.value;
  if (!flight) return { status: "notFound", error: "flightNotFound" };
  if (flight.status === "cancelled" || flight.status === "in") {
    return { status: "rejected", error: `flightTerminal:${flight.status}` };
  }

  const at = input.at ?? new Date().toISOString();
  const oooi = { ...flight.oooi };
  if (input.event !== "cancelled") oooi[input.event] = at;
  const newStatus: FlightStatus = input.event;

  await e.write({
    collection: FLIGHT_COLLECTION,
    record: { ...flight, status: newStatus, oooi } as unknown as Record<string, unknown>,
    rkey,
  });
  return { status: "updated", flightId: input.flightId, newStatus };
}

export async function getFlight(
  e: Etzhayyim,
  input: GetFlightInput
): Promise<GetFlightOutput> {
  if (!input.flightId) return { error: "invalidFlightId" };
  const resp = await e
    .read<FlightRecord>({ collection: FLIGHT_COLLECTION, rkey: flightRkey(input.flightId) })
    .catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r) return { error: "notFound" };
  return { flight: { ...r.value, flightUri: r.uri } };
}

export async function listFlights(
  e: Etzhayyim,
  input: ListFlightsInput = {}
): Promise<ListFlightsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<FlightRecord>({
    collection: FLIGHT_COLLECTION,
    cursor: input.cursor,
    limit,
  });
  const items: FlightView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.originIcao && v.originIcao !== input.originIcao.toUpperCase()) return false;
      if (input.destIcao && v.destIcao !== input.destIcao.toUpperCase()) return false;
      if (input.status && v.status !== input.status) return false;
      if (input.aircraftTail && v.aircraftTail !== input.aircraftTail.toUpperCase()) return false;
      return true;
    })
    .map((r) => ({ ...r.value, flightUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}
