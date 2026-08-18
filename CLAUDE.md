# open-airplane.etzhayyim.com — Aviation Operations & Airport Network (OSS)

**Status**: appview migrated to ClojureScript 2026-08-19 (docs/adr/0001).
Reference implementation for DID-addressed aviation operations —
airport / aircraft / flight / incident. Apache-2.0.

## Scope (declared NSID surface)

これは **プロジェクトが宣言する NSID の集合**であって、この repo に実装が
在るという主張ではない。deploy される Worker は nsid を検査せず MCP router へ
中継するので、下の 8 つが実際に答えるかは router の先にあるものが決める。

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

## Architecture（deploy される物）

- **Runtime**: Cloudflare Worker、**ClojureScript**。`src/open_airplane/worker.cljs`
  を shadow-cljs（`:target :esm`）が `dist/worker.js` にコンパイルし、
  `worker/wrangler.jsonc` の `main` がそれを指す。判断は `route.cljc`、
  ページは `view.cljc`（どちらも純 `.cljc`）。
- **Storage**: **無い。** `wrangler.jsonc` に `d1_databases` は 1 つも無く、
  service binding も無い。公開面は 3 route（`/`・`/health`・`/xrpc/:nsid`）だけ。
- **Identity**: airport / aircraft / flight / incident = path-based DIDs（宣言）
- **XRPC**: `/xrpc/<nsid>` を `AGENTGATEWAY_MCP_ROUTER_URL` へ jsonrpc
  `tools/call` として中継し、`result.structuredContent` を剥がして返す。
  **nsid の検査はしない**（移行前に deploy されていた handler と同じ）。

### 移行で消えた D1 実装について

`worker/src/app.ts`（8 NSID の完全実装・D1 の 5 テーブル DDL・OOOI 状態機械・
DMN 重大度、23,512 バイト）は **どの bundle にも入っておらず deploy されて
いなかった**ので、移行で撤去した。**git 履歴に残っている**:

```bash
git show 0c0085b:worker/src/app.ts
```

戻すなら D1 binding・`worker/package.json`・`@cloudflare/workers-types` が
併せて要る（`main` を差し替えるだけでは動かない）。判断は docs/adr/0001。

- **OOOI**: each flight has 4 timestamp checkpoints — Off-block / Take-off
  (Out) / Touch-down (On) / In-block. Status machine: `scheduled →
  off-block → airborne → landed → in-block → completed | diverted | cancelled`
- **Severity** by DMN (`openAirplane.incidentSeverity`):
  injuries + hull-loss + atc-incident → ICAO Annex 13 alignment
  (incident / serious-incident / accident)。`dmn/incident-severity.dmn` は
  **宣言であって、これを読む engine はこの repo に無い**。

## Not in MVP

- ADS-B realtime track ingest, ATC clearances
- Aircraft maintenance / MEL
- Crew rostering, FTL
- IATA NDC / ARC settlement

## Local Dev / Deploy

移行前のこの節は踏めない手順を書いていた（存在しない monorepo パスと、
PATH に無い `e7m`）。踏める手順の正本は `docs/operator-quickstart.md`。

```bash
node ~/github/com-junkawasaki/scripts/resource-guard.mjs run build -- \
  npx shadow-cljs release worker      # dist/worker.js を作る
npx nbb scripts/smoke-worker.cljs dist/worker.js
cd worker && npx wrangler dev --local --port 8811
```

`wrangler deploy` は可能だが、**route の `open-airplane.etzhayyim.com` も
中継先の `mcp.etzhayyim.com` も公開 DNS に無い**（NXDOMAIN、README §「呼び先」）。
