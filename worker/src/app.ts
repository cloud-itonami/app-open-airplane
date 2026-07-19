// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 etzhayyim Japan株式会社 / etzhayyim. All rights reserved.
// Licensed under the Apache License, Version 2.0 — see LICENSE at repo root.

// etzhayyim-project-open-airplane — aviation operations + airport network
//
// 8 XRPC under com.etzhayyim.apps.openAirplane.*:
//   defineAirport         (proc)  airport (ICAO + IATA + runways)
//   listAirports          (query) airport directory
//   registerAircraft      (proc)  aircraft (tail + ICAO 24-bit)
//   scheduleFlight        (proc)  publish a flight (origin → destination)
//   recordFlightStatus    (proc)  OOOI events (off|airborne|landed|in)
//   listFlights           (query) flights by airport / date / status
//   reportIncident        (proc)  ICAO Annex 13 incident with DMN severity
//   listIncidents         (query) incidents by aircraft / since / minSeverity

import AV1 from "../../dodaf/AV-1.json";
import OV1 from "../../dodaf/OV-1.json";
import OV5b from "../../dodaf/OV-5b.json";
import OV6a from "../../dodaf/OV-6a.json";
import CV2 from "../../dodaf/CV-2.json";
import SV1 from "../../dodaf/SV-1.json";
import scheduleFlightForm from "../../forms/scheduleFlight.form.json";
import reportIncidentForm from "../../forms/reportIncident.form.json";
import { bootstrapDodaf } from "./dodaf-bootstrap";

const DODAF_VIEWS: Record<string, any> = {
  "open-airplane.AV-1": AV1, "open-airplane.OV-1": OV1, "open-airplane.OV-5b": OV5b,
  "open-airplane.OV-6a": OV6a, "open-airplane.CV-2": CV2, "open-airplane.SV-1": SV1,
};
const FORMS: Record<string, any> = {
  "openAirplane.scheduleFlight.v1": scheduleFlightForm,
  "openAirplane.reportIncident.v1": reportIncidentForm,
};

export interface Env {
  AIRPLANE_DB: D1Database;
  PDS?: Fetcher;
  AUTH_SERVICE?: Fetcher;
  APP_HANDLE: string;
  PRIMARY_DID: string;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS airports (
    airport_did TEXT PRIMARY KEY,
    icao_code TEXT NOT NULL UNIQUE,
    iata_code TEXT,
    name TEXT NOT NULL,
    country TEXT NOT NULL,
    lat REAL,
    lon REAL,
    runways_json TEXT NOT NULL,
    defined_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS aircraft (
    aircraft_did TEXT PRIMARY KEY,
    icao24 TEXT NOT NULL UNIQUE,
    tail_number TEXT NOT NULL UNIQUE,
    type_code TEXT NOT NULL,
    operator_did TEXT NOT NULL,
    registered_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS flights (
    flight_did TEXT PRIMARY KEY,
    flight_number TEXT NOT NULL,
    operator_did TEXT NOT NULL,
    aircraft_did TEXT NOT NULL,
    origin_airport_did TEXT NOT NULL,
    dest_airport_did TEXT NOT NULL,
    service_date TEXT NOT NULL,
    scheduled_departure TEXT NOT NULL,
    scheduled_arrival TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled',
    scheduled_at TEXT NOT NULL,
    UNIQUE(flight_number, service_date),
    FOREIGN KEY (operator_did) REFERENCES aircraft(operator_did),
    CHECK (origin_airport_did != dest_airport_did)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_flights_origin_date ON flights(origin_airport_did, service_date)`,
  `CREATE INDEX IF NOT EXISTS idx_flights_dest_date ON flights(dest_airport_did, service_date)`,
  `CREATE TABLE IF NOT EXISTS flight_status (
    status_id TEXT PRIMARY KEY,
    flight_did TEXT NOT NULL,
    event TEXT NOT NULL CHECK (event IN ('off-block','airborne','landed','in-block','cancelled','diverted')),
    event_at TEXT NOT NULL,
    note TEXT,
    FOREIGN KEY (flight_did) REFERENCES flights(flight_did)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_status_flight ON flight_status(flight_did, event_at)`,
  `CREATE TABLE IF NOT EXISTS incidents (
    incident_did TEXT PRIMARY KEY,
    aircraft_did TEXT NOT NULL,
    flight_did TEXT,
    occurred_at TEXT NOT NULL,
    phase TEXT NOT NULL,
    fatalities INTEGER NOT NULL,
    serious_injuries INTEGER NOT NULL,
    hull_loss INTEGER NOT NULL,
    atc_incident INTEGER NOT NULL,
    severity TEXT NOT NULL,
    require_authority_report INTEGER NOT NULL,
    description TEXT,
    reported_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_incidents_aircraft_time ON incidents(aircraft_did, occurred_at DESC)`,
];

let schemaReady = false;
async function ensureSchema(db: D1Database) {
  if (schemaReady) return;
  for (const s of SCHEMA) await db.exec(s.replace(/\s+/g, " "));
  schemaReady = true;
}

function nanoid(len = 12): string {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  const b = crypto.getRandomValues(new Uint8Array(len));
  let o = ""; for (let i = 0; i < len; i++) o += a[b[i] % a.length]; return o;
}
const now = () => new Date().toISOString();

type XrpcError = "InvalidRequest" | "AirportNotFound" | "AircraftNotFound" | "FlightNotFound"
              | "Conflict" | "Unauthorized" | "InternalError";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const err = (e: XrpcError, m: string, s = 400) => json({ error: e, message: m }, s);

function classifyAviationIncident(input: {
  fatalities: number; hullLoss: boolean; seriousInjuries: number; atcIncident: boolean;
}): { severity: "incident" | "serious-incident" | "accident"; requireAuthorityReport: boolean } {
  if (input.fatalities >= 1)        return { severity: "accident",         requireAuthorityReport: true };
  if (input.hullLoss)                return { severity: "accident",         requireAuthorityReport: true };
  if (input.seriousInjuries >= 1)   return { severity: "serious-incident", requireAuthorityReport: true };
  if (input.atcIncident)             return { severity: "serious-incident", requireAuthorityReport: true };
  return { severity: "incident", requireAuthorityReport: false };
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  "scheduled": ["off-block", "cancelled"],
  "off-block": ["airborne", "cancelled"],
  "airborne":  ["landed", "diverted"],
  "landed":    ["in-block"],
  "in-block":  [],
  "cancelled": [],
  "diverted":  ["landed"],
};

async function defineAirport(env: Env, input: any): Promise<Response> {
  const { icaoCode, iataCode, name, country, lat, lon, runways } = input ?? {};
  if (typeof icaoCode !== "string" || !/^[A-Z]{4}$/.test(icaoCode))
    return err("InvalidRequest", "icaoCode must be 4 uppercase letters");
  if (iataCode != null && (typeof iataCode !== "string" || !/^[A-Z]{3}$/.test(iataCode)))
    return err("InvalidRequest", "iataCode must be 3 uppercase letters");
  if (typeof name !== "string" || !name.length) return err("InvalidRequest", "name required");
  if (typeof country !== "string" || !/^[A-Z]{2}$/.test(country))
    return err("InvalidRequest", "country must be ISO-3166 alpha-2");
  if (!Array.isArray(runways) || runways.length < 1)
    return err("InvalidRequest", "runways[] requires ≥ 1 entry");
  const id = nanoid(10);
  const airportDid = `did:web:${env.APP_HANDLE}:airport:${id}`;
  const definedAt = now();
  try {
    await env.AIRPLANE_DB.prepare(
      `INSERT INTO airports (airport_did, icao_code, iata_code, name, country, lat, lon, runways_json, defined_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(airportDid, icaoCode, iataCode ?? null, name, country,
           Number.isFinite(lat) ? lat : null, Number.isFinite(lon) ? lon : null,
           JSON.stringify(runways), definedAt).run();
  } catch (e: any) {
    if (String(e?.message ?? e).includes("UNIQUE"))
      return err("InvalidRequest", "icaoCode already registered", 409);
    throw e;
  }
  return json({ airportDid, icaoCode, iataCode: iataCode ?? null, name, country,
                lat: lat ?? null, lon: lon ?? null, runways, definedAt });
}

async function listAirports(env: Env, params: URLSearchParams): Promise<Response> {
  const country = params.get("country");
  const limit = Math.min(500, Math.max(1, Number(params.get("limit") ?? 100)));
  const offset = Math.max(0, Number(params.get("offset") ?? 0));
  const where = country ? `WHERE country = ?` : "";
  const binds = country ? [country] : [];
  const total = await env.AIRPLANE_DB.prepare(`SELECT COUNT(*) AS c FROM airports ${where}`)
    .bind(...binds).first<{ c: number }>();
  const rows = await env.AIRPLANE_DB.prepare(
    `SELECT * FROM airports ${where} ORDER BY icao_code ASC LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all<any>();
  return json({
    airports: (rows.results ?? []).map((r) => ({
      airportDid: r.airport_did, icaoCode: r.icao_code, iataCode: r.iata_code ?? undefined,
      name: r.name, country: r.country, lat: r.lat ?? undefined, lon: r.lon ?? undefined,
      runways: JSON.parse(r.runways_json), definedAt: r.defined_at,
    })),
    total: Number(total?.c ?? 0), offset, limit,
  });
}

async function registerAircraft(env: Env, input: any): Promise<Response> {
  const { icao24, tailNumber, typeCode, operatorDid } = input ?? {};
  if (typeof icao24 !== "string" || !/^[0-9A-F]{6}$/.test(icao24))
    return err("InvalidRequest", "icao24 must be 6 uppercase hex chars");
  if (typeof tailNumber !== "string" || !tailNumber.length)
    return err("InvalidRequest", "tailNumber required");
  if (typeof typeCode !== "string" || !typeCode.length)
    return err("InvalidRequest", "typeCode required");
  if (typeof operatorDid !== "string" || !operatorDid.startsWith("did:"))
    return err("InvalidRequest", "operatorDid must be a DID");
  const id = nanoid(10);
  const aircraftDid = `did:web:${env.APP_HANDLE}:aircraft:${id}`;
  const registeredAt = now();
  try {
    await env.AIRPLANE_DB.prepare(
      `INSERT INTO aircraft (aircraft_did, icao24, tail_number, type_code, operator_did, registered_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(aircraftDid, icao24, tailNumber, typeCode, operatorDid, registeredAt).run();
  } catch (e: any) {
    if (String(e?.message ?? e).includes("UNIQUE"))
      return err("InvalidRequest", "icao24 or tailNumber already registered", 409);
    throw e;
  }
  return json({ aircraftDid, icao24, tailNumber, typeCode, operatorDid, registeredAt });
}

async function scheduleFlight(env: Env, input: any): Promise<Response> {
  const { operatorDid, aircraftDid, flightNumber, originAirportDid, destAirportDid,
          serviceDate, scheduledDeparture, scheduledArrival } = input ?? {};
  if (typeof operatorDid !== "string" || !operatorDid.startsWith("did:"))
    return err("InvalidRequest", "operatorDid must be a DID");
  if (typeof aircraftDid !== "string") return err("InvalidRequest", "aircraftDid required");
  if (typeof flightNumber !== "string" || !/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(flightNumber))
    return err("InvalidRequest", "flightNumber invalid");
  if (originAirportDid === destAirportDid)
    return err("InvalidRequest", "origin and destination must differ");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate))
    return err("InvalidRequest", "serviceDate must be YYYY-MM-DD");
  if (Date.parse(scheduledDeparture) >= Date.parse(scheduledArrival))
    return err("InvalidRequest", "scheduledDeparture must precede scheduledArrival");
  const [a, o, d] = await Promise.all([
    env.AIRPLANE_DB.prepare(`SELECT aircraft_did FROM aircraft WHERE aircraft_did = ?`).bind(aircraftDid).first<any>(),
    env.AIRPLANE_DB.prepare(`SELECT airport_did FROM airports WHERE airport_did = ?`).bind(originAirportDid).first<any>(),
    env.AIRPLANE_DB.prepare(`SELECT airport_did FROM airports WHERE airport_did = ?`).bind(destAirportDid).first<any>(),
  ]);
  if (!a) return err("AircraftNotFound", "aircraft not found", 404);
  if (!o || !d) return err("AirportNotFound", "airport not found", 404);
  const id = nanoid(12);
  const flightDid = `did:web:${env.APP_HANDLE}:flight:${id}`;
  const scheduledAt = now();
  try {
    await env.AIRPLANE_DB.prepare(
      `INSERT INTO flights (flight_did, flight_number, operator_did, aircraft_did, origin_airport_did, dest_airport_did,
                            service_date, scheduled_departure, scheduled_arrival, status, scheduled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`
    ).bind(flightDid, flightNumber, operatorDid, aircraftDid, originAirportDid, destAirportDid,
           serviceDate, scheduledDeparture, scheduledArrival, scheduledAt).run();
  } catch (e: any) {
    if (String(e?.message ?? e).includes("UNIQUE"))
      return err("InvalidRequest", `flight ${flightNumber}/${serviceDate} already scheduled`, 409);
    throw e;
  }
  return json({ flightDid, flightNumber, serviceDate, status: "scheduled", scheduledAt });
}

async function recordFlightStatus(env: Env, input: any): Promise<Response> {
  const { flightDid, event, eventAt, note } = input ?? {};
  if (typeof flightDid !== "string") return err("InvalidRequest", "flightDid required");
  if (!["off-block", "airborne", "landed", "in-block", "cancelled", "diverted"].includes(event))
    return err("InvalidRequest", "event invalid");
  if (typeof eventAt !== "string") return err("InvalidRequest", "eventAt required");
  const f = await env.AIRPLANE_DB.prepare(`SELECT * FROM flights WHERE flight_did = ?`).bind(flightDid).first<any>();
  if (!f) return err("FlightNotFound", "no such flight", 404);
  const allowed = VALID_TRANSITIONS[f.status] ?? [];
  if (!allowed.includes(event))
    return err("Conflict", `event ${event} not allowed from status ${f.status}`, 409);
  const id = `s_${nanoid(14)}`;
  const newStatus = event;
  await env.AIRPLANE_DB.batch([
    env.AIRPLANE_DB.prepare(
      `INSERT INTO flight_status (status_id, flight_did, event, event_at, note) VALUES (?, ?, ?, ?, ?)`
    ).bind(id, flightDid, event, eventAt, note ?? null),
    env.AIRPLANE_DB.prepare(`UPDATE flights SET status = ? WHERE flight_did = ?`).bind(newStatus, flightDid),
  ]);
  return json({ statusId: id, flightDid, event, status: newStatus, eventAt });
}

async function listFlights(env: Env, params: URLSearchParams): Promise<Response> {
  const airportDid = params.get("airportDid");
  const role = params.get("role"); // origin | dest
  const date = params.get("serviceDate");
  const status = params.get("status");
  const limit = Math.min(500, Math.max(1, Number(params.get("limit") ?? 100)));
  const offset = Math.max(0, Number(params.get("offset") ?? 0));
  const clauses: string[] = []; const binds: any[] = [];
  if (airportDid) {
    if (role === "origin")     { clauses.push(`origin_airport_did = ?`); binds.push(airportDid); }
    else if (role === "dest")  { clauses.push(`dest_airport_did = ?`);   binds.push(airportDid); }
    else { clauses.push(`(origin_airport_did = ? OR dest_airport_did = ?)`); binds.push(airportDid, airportDid); }
  }
  if (date)   { clauses.push(`service_date = ?`); binds.push(date); }
  if (status) { clauses.push(`status = ?`);       binds.push(status); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = await env.AIRPLANE_DB.prepare(`SELECT COUNT(*) AS c FROM flights ${where}`)
    .bind(...binds).first<{ c: number }>();
  const rows = await env.AIRPLANE_DB.prepare(
    `SELECT * FROM flights ${where} ORDER BY service_date DESC, flight_number ASC LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all<any>();
  return json({
    flights: (rows.results ?? []).map((r) => ({
      flightDid: r.flight_did, flightNumber: r.flight_number, operatorDid: r.operator_did,
      aircraftDid: r.aircraft_did, originAirportDid: r.origin_airport_did,
      destAirportDid: r.dest_airport_did, serviceDate: r.service_date,
      scheduledDeparture: r.scheduled_departure, scheduledArrival: r.scheduled_arrival,
      status: r.status, scheduledAt: r.scheduled_at,
    })),
    total: Number(total?.c ?? 0), offset, limit,
  });
}

async function reportIncident(env: Env, input: any): Promise<Response> {
  const { aircraftDid, flightDid, occurredAt, phase, fatalities, seriousInjuries, hullLoss, atcIncident, description } = input ?? {};
  if (typeof aircraftDid !== "string") return err("InvalidRequest", "aircraftDid required");
  if (typeof occurredAt !== "string") return err("InvalidRequest", "occurredAt required");
  if (typeof phase !== "string") return err("InvalidRequest", "phase required");
  if (!Number.isFinite(fatalities)      || fatalities      < 0) return err("InvalidRequest", "fatalities ≥ 0");
  if (!Number.isFinite(seriousInjuries) || seriousInjuries < 0) return err("InvalidRequest", "seriousInjuries ≥ 0");
  const a = await env.AIRPLANE_DB.prepare(`SELECT aircraft_did FROM aircraft WHERE aircraft_did = ?`).bind(aircraftDid).first<any>();
  if (!a) return err("AircraftNotFound", "aircraft not found", 404);
  const { severity, requireAuthorityReport } = classifyAviationIncident({
    fatalities: Number(fatalities), hullLoss: !!hullLoss,
    seriousInjuries: Number(seriousInjuries), atcIncident: !!atcIncident,
  });
  const id = nanoid(12);
  const incidentDid = `did:web:${env.APP_HANDLE}:incident:${id}`;
  const reportedAt = now();
  await env.AIRPLANE_DB.prepare(
    `INSERT INTO incidents (incident_did, aircraft_did, flight_did, occurred_at, phase, fatalities, serious_injuries,
                            hull_loss, atc_incident, severity, require_authority_report, description, reported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(incidentDid, aircraftDid, flightDid ?? null, occurredAt, phase,
         fatalities, seriousInjuries, hullLoss ? 1 : 0, atcIncident ? 1 : 0,
         severity, requireAuthorityReport ? 1 : 0, description ?? null, reportedAt).run();
  if (requireAuthorityReport && env.PDS) {
    try {
      await env.PDS.fetch(`https://atproto.etzhayyim.com/xrpc/com.atproto.repo.createRecord`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repo: env.PRIMARY_DID, collection: "app.bsky.feed.post",
          record: { $type: "app.bsky.feed.post",
            text: `[${severity.toUpperCase()}] aviation occurrence: ${aircraftDid} (phase=${phase}, fatalities=${fatalities})`,
            createdAt: reportedAt },
        }),
      });
    } catch {}
  }
  return json({ incidentDid, severity, requireAuthorityReport, reportedAt });
}

async function listIncidents(env: Env, params: URLSearchParams): Promise<Response> {
  const aircraftDid = params.get("aircraftDid");
  const since = params.get("since");
  const minSeverity = params.get("minSeverity");
  const limit = Math.min(500, Math.max(1, Number(params.get("limit") ?? 100)));
  const offset = Math.max(0, Number(params.get("offset") ?? 0));
  const sevRank = (s: string) => ({ "incident": 0, "serious-incident": 1, "accident": 2 } as any)[s] ?? -1;
  const clauses: string[] = []; const binds: any[] = [];
  if (aircraftDid) { clauses.push(`aircraft_did = ?`); binds.push(aircraftDid); }
  if (since)       { clauses.push(`occurred_at >= ?`); binds.push(since); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = await env.AIRPLANE_DB.prepare(`SELECT COUNT(*) AS c FROM incidents ${where}`)
    .bind(...binds).first<{ c: number }>();
  const rows = await env.AIRPLANE_DB.prepare(
    `SELECT * FROM incidents ${where} ORDER BY occurred_at DESC LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all<any>();
  let incidents = (rows.results ?? []).map((r) => ({
    incidentDid: r.incident_did, aircraftDid: r.aircraft_did,
    flightDid: r.flight_did ?? undefined, occurredAt: r.occurred_at,
    phase: r.phase, fatalities: r.fatalities, seriousInjuries: r.serious_injuries,
    hullLoss: !!r.hull_loss, atcIncident: !!r.atc_incident, severity: r.severity,
    requireAuthorityReport: !!r.require_authority_report,
    description: r.description ?? undefined, reportedAt: r.reported_at,
  }));
  if (minSeverity) incidents = incidents.filter((i) => sevRank(i.severity) >= sevRank(minSeverity));
  return json({ incidents, total: Number(total?.c ?? 0), offset, limit });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      await ensureSchema(env.AIRPLANE_DB);
      const url = new URL(req.url);
      if (url.pathname === "/health" || url.pathname === "/_worker/health")
        return json({ ok: true, did: env.PRIMARY_DID, ts: now() });
      if (url.pathname === "/_app/meta") {
        if (env.PDS) { try { await bootstrapDodaf(env as any); } catch {} }
        return json({
          did: env.PRIMARY_DID, handle: env.APP_HANDLE,
          xrpc: [
            "com.etzhayyim.apps.openAirplane.defineAirport",
            "com.etzhayyim.apps.openAirplane.listAirports",
            "com.etzhayyim.apps.openAirplane.registerAircraft",
            "com.etzhayyim.apps.openAirplane.scheduleFlight",
            "com.etzhayyim.apps.openAirplane.recordFlightStatus",
            "com.etzhayyim.apps.openAirplane.listFlights",
            "com.etzhayyim.apps.openAirplane.reportIncident",
            "com.etzhayyim.apps.openAirplane.listIncidents",
          ],
          dodaf: Object.keys(DODAF_VIEWS), forms: Object.keys(FORMS),
          bpmn: ["scheduleFlight", "reportAviationIncident"],
          dmn:  ["openAirplane.incidentSeverity"],
        });
      }
      if (url.pathname === "/dodaf")
        return json({ views: Object.entries(DODAF_VIEWS).map(([id, v]: any) => ({
          viewId: id, viewType: v.viewType, title: v.title, version: v.version })) });
      if (url.pathname.startsWith("/dodaf/")) {
        const id = decodeURIComponent(url.pathname.slice("/dodaf/".length));
        const v = DODAF_VIEWS[id];
        return v ? json(v) : err("InvalidRequest", `no such view: ${id}`, 404);
      }
      if (url.pathname === "/forms")
        return json({ forms: Object.values(FORMS).map((f: any) => ({ formKey: f.formKey, name: f.name, version: f.version })) });
      if (url.pathname.startsWith("/forms/")) {
        const k = decodeURIComponent(url.pathname.slice("/forms/".length));
        const f = FORMS[k];
        return f ? json(f) : err("InvalidRequest", `no such form: ${k}`, 404);
      }
      if (!url.pathname.startsWith("/xrpc/"))
        return err("InvalidRequest", "only /xrpc/* is served", 404);
      const nsid = url.pathname.slice("/xrpc/".length);
      if (req.method === "GET") {
        switch (nsid) {
          case "com.etzhayyim.apps.openAirplane.listAirports":  return await listAirports(env, url.searchParams);
          case "com.etzhayyim.apps.openAirplane.listFlights":   return await listFlights(env, url.searchParams);
          case "com.etzhayyim.apps.openAirplane.listIncidents": return await listIncidents(env, url.searchParams);
          default: return err("InvalidRequest", `unknown query NSID: ${nsid}`, 404);
        }
      }
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        switch (nsid) {
          case "com.etzhayyim.apps.openAirplane.defineAirport":      return await defineAirport(env, body);
          case "com.etzhayyim.apps.openAirplane.registerAircraft":   return await registerAircraft(env, body);
          case "com.etzhayyim.apps.openAirplane.scheduleFlight":     return await scheduleFlight(env, body);
          case "com.etzhayyim.apps.openAirplane.recordFlightStatus": return await recordFlightStatus(env, body);
          case "com.etzhayyim.apps.openAirplane.reportIncident":     return await reportIncident(env, body);
          default: return err("InvalidRequest", `unknown procedure NSID: ${nsid}`, 404);
        }
      }
      return err("InvalidRequest", "method not allowed", 405);
    } catch (e: any) {
      return err("InternalError", e?.message ?? String(e), 500);
    }
  },
};
