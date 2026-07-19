import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  defineAirport,
  getAirport,
  listAirports,
  registerAircraft,
  getAircraft,
  listAircraft,
  scheduleFlight,
  recordFlightStatus,
  getFlight,
  listFlights,
  isValidIcao,
} from "../src/index.js";

describe("open-airplane kotoba", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: "did:web:open-airplane.etzhayyim.com" });
  });

  describe("airport", () => {
    it("defines + gets + lists (ICAO key, IATA validated)", async () => {
      expect((await defineAirport(e, { icao: "RJTT", iata: "HND", name: "Tokyo Haneda", country: "JP", runways: 4 })).status).toBe("defined");
      expect((await getAirport(e, { icao: "rjtt" })).airport?.iata).toBe("HND");
      expect((await listAirports(e, { country: "JP" })).total).toBe(1);
    });
    it("rejects bad ICAO/IATA + is idempotent", async () => {
      expect((await defineAirport(e, { icao: "RJT", name: "x" })).status).toBe("rejected");
      expect((await defineAirport(e, { icao: "RJTT", iata: "HANEDA", name: "x" })).status).toBe("rejected");
      await defineAirport(e, { icao: "RJTT", name: "Haneda" });
      expect((await defineAirport(e, { icao: "RJTT", name: "Haneda" })).status).toBe("alreadyExists");
    });
    it("isValidIcao", () => {
      expect(isValidIcao("KSFO")).toBe(true);
      expect(isValidIcao("ksfo")).toBe(false);
      expect(isValidIcao("KSF")).toBe(false);
    });
  });

  describe("aircraft", () => {
    it("registers + validates icao24 + lists by operator", async () => {
      expect((await registerAircraft(e, { tailNumber: "JA8089", icao24: "86D2C5", aircraftType: "B744", operator: "JAL" })).status).toBe("registered");
      expect((await getAircraft(e, { tailNumber: "ja8089" })).aircraft?.icao24).toBe("86d2c5");
      expect((await registerAircraft(e, { tailNumber: "X", icao24: "ZZZ" })).status).toBe("rejected");
      expect((await listAircraft(e, { operator: "JAL" })).total).toBe(1);
    });
  });

  describe("flight (OOOI)", () => {
    beforeEach(async () => {
      await defineAirport(e, { icao: "RJTT", name: "Haneda" });
      await defineAirport(e, { icao: "RJAA", name: "Narita" });
    });
    it("schedules between defined airports; rejects same/undefined", async () => {
      expect((await scheduleFlight(e, { flightId: "F-1", originIcao: "RJTT", destIcao: "RJAA", aircraftTail: "JA8089" })).status).toBe("scheduled");
      expect((await getFlight(e, { flightId: "F-1" })).flight?.status).toBe("scheduled");
      expect((await scheduleFlight(e, { flightId: "F-2", originIcao: "RJTT", destIcao: "RJTT" })).status).toBe("rejected");
      expect((await scheduleFlight(e, { flightId: "F-3", originIcao: "RJTT", destIcao: "ZZZZ" })).status).toBe("rejected");
    });
    it("records OOOI events + advances status", async () => {
      await scheduleFlight(e, { flightId: "F-1", originIcao: "RJTT", destIcao: "RJAA" });
      expect((await recordFlightStatus(e, { flightId: "F-1", event: "out", at: "2026-07-01T10:00:00Z" })).newStatus).toBe("out");
      await recordFlightStatus(e, { flightId: "F-1", event: "off", at: "2026-07-01T10:15:00Z" });
      const inEv = await recordFlightStatus(e, { flightId: "F-1", event: "in", at: "2026-07-01T11:00:00Z" });
      expect(inEv.newStatus).toBe("in");
      const f = await getFlight(e, { flightId: "F-1" });
      expect(f.flight?.oooi.out).toBe("2026-07-01T10:00:00Z");
      expect(f.flight?.oooi.in).toBe("2026-07-01T11:00:00Z");
      // terminal (in) can't be re-recorded
      expect((await recordFlightStatus(e, { flightId: "F-1", event: "on" })).status).toBe("rejected");
    });
    it("lists flights by origin/status", async () => {
      await scheduleFlight(e, { flightId: "F-1", originIcao: "RJTT", destIcao: "RJAA" });
      expect((await listFlights(e, { originIcao: "RJTT", status: "scheduled" })).total).toBe(1);
    });
  });
});
