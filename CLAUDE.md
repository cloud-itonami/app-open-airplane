# open-airplane.etzhayyim.com — Aviation Operations & Airport Network (OSS)

**Status**: MVP scaffold (2026-04-20). Reference implementation for
DID-addressed aviation operations — airport / aircraft / flight / incident.
Apache-2.0.

## Scope (MVP)

| NSID | Type | Description |
|---|---|---|
| `com.etzhayyim.apps.openAirplane.defineAirport` | procedure | airport (ICAO + IATA + runways) |
| `com.etzhayyim.apps.openAirplane.listAirports` | query | airport directory |
| `com.etzhayyim.apps.openAirplane.registerAircraft` | procedure | aircraft registration (tail no. + ICAO 24-bit) |
| `com.etzhayyim.apps.openAirplane.scheduleFlight` | procedure | publish a single flight (origin → destination) |
| `com.etzhayyim.apps.openAirplane.recordFlightStatus` | procedure | OOOI events (off, out, on, in) + cancel |
| `com.etzhayyim.apps.openAirplane.listFlights` | query | flights by airport / date / status |
| `com.etzhayyim.apps.openAirplane.reportIncident` | procedure | safety incident with severity DMN |
| `com.etzhayyim.apps.openAirplane.listIncidents` | query | incidents by aircraft / since |

## Architecture

- **Runtime**: Single CF Worker (`src/app.ts`)
- **Storage**: D1. Tables: `airports`, `aircraft`, `flights`, `flight_status`, `incidents`
- **Identity**: airport / aircraft / flight / incident = path-based DIDs
- **OOOI**: each flight has 4 timestamp checkpoints — Off-block / Take-off
  (Out) / Touch-down (On) / In-block. Status machine: `scheduled →
  off-block → airborne → landed → in-block → completed | diverted | cancelled`
- **Severity** by DMN (`openAirplane.incidentSeverity`):
  injuries + hull-loss + atc-incident → ICAO Annex 13 alignment
  (incident / serious-incident / accident)
- **Audit**: serious-incident or accident → `app.bsky.feed.post` (regulator visible)

## Not in MVP

- ADS-B realtime track ingest, ATC clearances
- Aircraft maintenance / MEL
- Crew rostering, FTL
- IATA NDC / ARC settlement

## Local Dev / Deploy

```bash
cd 60-apps/etzhayyim-project-open-airplane/worker
wrangler d1 create etzhayyim-open-airplane
e7m actor deploy .
```
