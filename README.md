# app-open-airplane

**この repo は `open-airplane.etzhayyim.com` の edge appview である。** 空港・機体・
フライト・安全インシデントの運用そのものは、**配備されている物の中には無い** ——
配備されるのは XRPC 要求を MCP router へ中継する SvelteKit worker 1 本と、その配備設定である。

`CLAUDE.md` は 8 つの NSID・D1 の 5 テーブル・OOOI 状態機械・ICAO Annex 13 の重大度 DMN を
記述している。**それを実装したコードはこの repo に実在する**（`worker/src/app.ts`、29.9 KB）。
問題は在るか無いかではなく、**それが配備される成果物に 1 バイトも入らない**ことである。
CLAUDE.md を読んでここに来た読み手が最初に必要とするのはこの事実なので、名乗りの直後に置く。

| | |
|---|---|
| Worker 名 | `etzhayyim-open-airplane` |
| 宣言 route | `open-airplane.etzhayyim.com/*`（**NXDOMAIN —— 下記欠陥 D**） |
| 宣言 DID | `did:web:open-airplane.etzhayyim.com`（**未解決 —— 同 D**） |
| 実行形態 | SvelteKit + `@sveltejs/adapter-cloudflare` → Cloudflare Worker |
| 上流 | `https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message`（**NXDOMAIN —— 欠陥 C**） |
| 実装の数 | **3 つ**（下記 §1）。配備されるのは 1 つ |
| 規模 | 34 ファイル / 89,053 バイト |

手順は `docs/operator-quickstart.md`。以下は 2026-08-17 (UTC) に**実際に測って**分かった
現在地であり、推測は含まない。測り方は各項に書いてある。

---

## 1. この repo には「open-airplane」が 3 つ在る

同じ名前の実装が 3 つあり、**substrate も NSID の集合も互いに違う**。どれを読むかで
得られる理解が変わるので、最初に地図を置く。

| # | 場所 | 実体 | substrate | 配備されるか |
|---|---|---|---|---|
| 1 | `worker/src/app.ts`（29.9 KB / 3 ファイル） | 8 NSID の完全実装、D1 の 5 テーブル DDL、OOOI 状態機械、DMN 重大度 | **D1** | **されない**（§2） |
| 2 | `worker/svelte/src/routes/xrpc/[...path]/+server.ts`（2.8 KB） | MCP router への無検査中継 | 無し | **これだけ** |
| 3 | `kotoba/src/`（18.0 KB / 4 ファイル） | 12 関数、vitest 7 件が緑 | **AT PDS** | されない（§5） |

`CLAUDE.md` の Architecture 節は 1 番だけを記述しており、2 番と 3 番には触れていない。

## 2. 読み手が最初に踏む地雷 —— 開くファイルと、動くファイルが違う

`worker/src/` の下の `app.ts` は、名前も冒頭コメント（`aviation operations + airport
network`、8 NSID の一覧）も、この repo の入口であるように読める。**動いていない。**

配備されるのは `worker/wrangler.jsonc` の `main` が指す先である:

```jsonc
"main": "svelte/.svelte-kit/cloudflare/_worker.js"   // ← SvelteKit のビルド成果物
```

**clean-room で build して、成果物を検索して確認した**（`.svelte-kit/` を消してから
`npm ci` 相当 → `npm run build`。手順は quickstart §2）:

| build 出力 `.svelte-kit/` 全体を検索した語 | 由来 | ヒット数 |
|---|---|---|
| `AIRPLANE_DB` | app.ts の D1 binding 名 | **0** |
| `defineAirport` | app.ts の NSID handler | **0** |
| `open-airplane.AV-1` | app.ts が import する DoDAF view | **0** |
| `mcp.etzhayyim.com` | 中継先（+server.ts） | 1 |

`worker/src/app.ts` はどのビルド出力にも入らない。**dead code である。**
`worker/src/defence-handlers.ts`（4.7 KB）と `worker/src/dodaf-bootstrap.ts`（1.7 KB）も同様。

### 2 つのファイルは同じことをしていない

これが問題なのは、片方が使われていないからだけではない。**両者の振る舞いが違う**ので、
`src/app.ts` を読んで得た理解は本番に対して誤りになる。`wrangler dev --local` を起動して
実測した差:

| 要求 | `src/app.ts`（読まれる／動かない） | 配備される handler（**実測**） |
|---|---|---|
| `GET /health` | JSON 200 を返す実装が在る | **404** |
| `GET /healthz` `/readyz` | （`/health` と `/_worker/health` のみ実装） | **404** |
| `GET /_app/meta` | 実装が在る（DoDAF bootstrap を起動する） | **404** |
| `GET /dodaf` `/dodaf/<id>` | 6 つの DoDAF view を配る | **404** |
| `GET /forms` `/forms/<key>` | 2 つの form 定義を配る | **404** |
| `GET /xrpc/<nsid>` | query 3 種を受理（`listAirports` 等） | **405** `GET method not allowed` |
| `/xrpc/*` 以外 | `only /xrpc/* is served` (404) | SvelteKit の 404 ページ |
| namespace 外の NSID | `unknown query/procedure NSID` (404) | **中継する**（下記） |

namespace 検査が無いことの実測 —— 無関係な NSID が、自分の NSID と**同じ応答**になる:

```
POST /xrpc/com.etzhayyim.apps.openAirplane.listAirports        → 500 {"message":"Internal Error"}
POST /xrpc/com.etzhayyim.apps.openAirplane.thisMethodDoesNotExist → 500 {"message":"Internal Error"}   ← 同一
POST /xrpc/com.example.totallyUnrelated.doAnything             → 500 {"message":"Internal Error"}   ← 同一
```

`src/app.ts` なら後 2 者は 404 だった。配備側は任意の tool 名を MCP router へ素通しする。
**この差が設計判断なのか移行の副産物なのかは、この repo からは判定できない。**

配備される route は 2 本しか無い（`wrangler deploy --dry-run` で確認）: `/` と `/xrpc/[...path]`。
bindings は `ASSETS` と 4 つの環境変数だけ（§3）。Total Upload 374.40 KiB / gzip 86.68 KiB。

## 3. 測って見つけた欠陥（未修正 —— この反復では docs だけを触った）

**A. `/health` が無い。** 上表のとおり 404。`src/app.ts` は `/health` `/_worker/health`
`/_app/meta` を実装しているが、配備されないので存在しない。監視をこれらの URL に
向けている経路があれば、それは常に落ちていると報告する。

**B. 3 つの `/xrpc/*` すべてが 500 を返す。** ローカル実測 3/3。原因は C。
`+server.ts` は上流 fetch を try/catch していないので、上流に到達できない場合の応答が
SvelteKit の `{"message":"Internal Error"}` になり、**どの層が失敗したかが応答から読めない。**

**C. 唯一の上流 `mcp.etzhayyim.com` が公開 DNS に存在しない。** ローカルの resolver に
依存しないよう `1.1.1.1` に直接引いて確認した:

```
dig mcp.etzhayyim.com @1.1.1.1          → status: NXDOMAIN
dig etzhayyim.com     @1.1.1.1          → 172.67.179.128   （apex は在る。NS は Cloudflare）
```

`AGENTGATEWAY_MCP_ROUTER_URL` を上書きしない限り、この worker は**構造的に何も中継できない**。
配備しても B の 500 がそのまま本番の応答になる。

**D. 宣言 route と PRIMARY_DID のホストも NXDOMAIN。** 同じく `@1.1.1.1` で確認:

```
dig open-airplane.etzhayyim.com @1.1.1.1 → status: NXDOMAIN
```

したがって `wrangler.jsonc` の `routes[0].pattern`（`open-airplane.etzhayyim.com/*`）は
到達不能で、`did:web:open-airplane.etzhayyim.com` は解決できない（`did:web` は
`https://<host>/.well-known/did.json` を要求するが、そのホストが引けない）。
**この repo が名乗る identity は、今日の公開 DNS の上には無い。**

**E. `wrangler.jsonc` に D1 binding が無い。** `d1_databases` の出現数は **0**。
`--dry-run` が列挙した binding は `ASSETS` + `APP_HANDLE` / `PRIMARY_DID` /
`APP_FRAMEWORK` / `AGENTGATEWAY_MCP_ROUTER_URL` の 4 変数だけ。一方 `app.ts` の `Env` は
`AIRPLANE_DB: D1Database` を必須で要求し、`PDS?: Fetcher` / `AUTH_SERVICE?: Fetcher` も
参照する。**`main` を `app.ts` に差し替えるだけでは動かない** —— CLAUDE.md の
「Storage: D1. Tables: airports, aircraft, flights, flight_status, incidents」を満たす配線は
どこにも無い。

**F. `worker/` に `package.json` が無いので、`src/app.ts` を型検査する経路が無い。**
npm プロジェクトは `worker/svelte/` にしか無い。隣の TypeScript を借りて強制的に通すと
**11 件のエラー**が出る:

```
4 件  D1Database / Fetcher が見つからない  ← @cloudflare/workers-types が入らない（＝ F 自身）
4 件  TS7006  暗黙の any（map の引数 r / i）
1 件  TS2783  'did' is specified more than once, so this usage will be overwritten  ← G
2 件  同上の Fetcher（dodaf-bootstrap.ts）
```

対して、実際に配備される `worker/svelte/` は `npm run check` が
`COMPLETED 163 FILES 0 ERRORS 0 WARNINGS` で通る。**検査されているのは動く側だけで、
壊れているのは検査されない側**という向きになっている。

**G. `dodaf-bootstrap.ts` が `PRIMARY_DID` を黙って捨てる。**

```ts
await xrpc(env.PDS, "com.etzhayyim.dodafv2.deployView", { did, ...v });
//                                                        ↑ env.PRIMARY_DID
```

`v` は `dodaf/*.json` そのもので、**6 ファイルすべてが自前の `did` キーを持つ**
（実測: 6/6 が `"did:web:open-airplane.etzhayyim.com"`）。spread が後なので JSON 側が勝ち、
`env.PRIMARY_DID` は無視される。**今日は両者が同じ文字列なので実害は出ない** —— しかし
staging 等で別の DID を渡した瞬間に、宛先だけが本番の DID のまま送られる。
なお `bootstrapDodaf` は `/_app/meta`（§2 のとおり 404）から、しかも `env.PDS` が
bind されているとき（§3 E のとおり無い）だけ呼ばれるので、**現状は到達不能**である。

**H. `kotoba/` は 3 つ目の実装で、誰からも参照されていない。** §5。

**I. DMN が 2 箇所にある。** `dmn/incident-severity.dmn` の 5 ルールと、`app.ts` の
`classifyAviationIncident()` のハードコードは、**今日は一致している**（両方を読んで
5 ルールとも突き合わせた: fatalities≥1→accident / hullLoss→accident /
seriousInjuries≥1→serious-incident / atcIncident→serious-incident / 既定→incident）。
`.dmn` を読む engine はこの repo に無い（参照は `dodaf/OV-5b.json` と `OV-6a.json` の
**宣言だけ**）ので、TS 側は手写しの複製である。**一致を保つものが無い。**

**J. `CLAUDE.md` の Local Dev 手順が両方とも踏めない。**

```bash
cd 60-apps/etzhayyim-project-open-airplane/worker   # ← このパスはこの repo に無い（移行前の monorepo のもの）
wrangler d1 create etzhayyim-open-airplane
e7m actor deploy .                                   # ← e7m は PATH に無い
```

1 行目は `migration.edn` の `:source :path` と同じ文字列で、**移行時に更新されなかった**。
3 行目の `e7m` は実測で `not found`。踏める手順は `docs/operator-quickstart.md` に置いた。

**K. lockfile が 2 プロジェクトとも無い。** `git ls-files | grep lock` は 0 件。
`kotoba/` も `worker/svelte/` も毎回レンジを解決し直すので、quickstart に載せた
パッケージ件数は将来ずれる。

**L. `LICENSE` ファイルが無い。** 各ソースの冒頭は `Apache-2.0` を宣言し
`see LICENSE at repo root` と書くが、その LICENSE は移行時に付いてこなかった。

**M. `.gitignore` が無い。** quickstart を一度踏むと、生成物 6 件が untracked として
`git status` に出る（実測: `kotoba/node_modules/` `kotoba/package-lock.json`
`worker/svelte/node_modules/` `worker/svelte/package-lock.json`
`worker/svelte/.svelte-kit/` `worker/.wrangler/`）。K と合わさって、
**`git add -A` 一発で `node_modules` を commit できる状態**になっている。

## 4. 実際に緑になるもの

嘘の対称性を作らないために、**通るものも測って書く**。

| 対象 | コマンド | 実測 |
|---|---|---|
| `kotoba/` 型検査 | `npx tsc --noEmit` | exit 0 / 出力 0 行 |
| `kotoba/` テスト | `npx vitest run` | **7 passed (1 file)** / 341ms |
| `worker/svelte/` 型検査 | `npm run check` | `COMPLETED 163 FILES 0 ERRORS 0 WARNINGS` |
| `worker/svelte/` build | `npm run build` | exit 0 / 4.11s |
| 配備設定 | `wrangler deploy --dry-run` | exit 0 / 374.40 KiB |

つまり **CI に載せられる緑は既に在る**。載っていないだけである（`.github/workflows/` は 0 件、
`kotoba/package.json` の `test` / `typecheck` を呼ぶものがこの repo に無い）。
なおこのワークスペースの CI は murakumo fleet であって GitHub Actions ではない
（superproject の CLAUDE.md / ADR-2607300900）ので、足す先は `scripts/fleet-ci/gates.edn` である。

## 5. `kotoba/` —— 動くが、どこにも繋がっていない実装

`kotoba/src/` は `@etzhayyim/sdk` を使い、**AT PDS のレコードとして**空港・機体・
フライトを持つ実装である（`app.ts` の D1 とは別の substrate）。7 件の vitest が緑で、
ICAO/IATA/ICAO24 の検証・冪等性・OOOI の終端状態まで押さえている。

**しかし NSID の集合が CLAUDE.md とも `app.ts` とも一致しない**（実測、export を列挙）:

| CLAUDE.md が宣言する 8 NSID | `app.ts` | `kotoba/` |
|---|---|---|
| defineAirport / listAirports | ✔ | ✔ |
| registerAircraft | ✔ | ✔ |
| scheduleFlight / recordFlightStatus | ✔ | ✔ |
| listFlights | ✔ | ✔ |
| **reportIncident** | ✔ | **無い** |
| **listIncidents** | ✔ | **無い** |
| （CLAUDE.md に無い）getAirport / getAircraft / getFlight / listAircraft | 無い | ✔ |

インシデント経路 —— `dmn/incident-severity.dmn`・`forms/reportIncident.form.json`・
`bpmn/report-incident.bpmn`・ICAO Annex 13 の重大度判定 —— は、**dead な `app.ts` にしか無い。**

そして `kotoba/` は publish されておらず（`"private": true`）、`worker/` からも
`wrangler.jsonc` からも参照されていない。**動く実装が、配備される物と繋がっていない。**

## 6. この repo を次に触る人へ

上の A–L は**測っただけで直していない**。直す前に決めるべきことが 1 つあり、それは
コードの問題ではないからである:

> **3 つの実装のうち、どれが正本か。**

- `app.ts`（D1）を正本にするなら: `main` の差し替え + D1 binding + `worker/package.json` +
  `@cloudflare/workers-types` が要る（E, F）。`kotoba/` は削除するか、`app.ts` から使う。
- `kotoba/`（AT PDS）を正本にするなら: インシデント経路の移植（§5）と、
  worker からの呼び出し経路が要る。`app.ts` は削除する。
- 中継（現状）を正本にするなら: `app.ts` と `kotoba/` は削除し、CLAUDE.md の
  Architecture 節を「MCP router の薄い前段」に書き換える。C と D（DNS）は別途要る。

**どれを選んでも、まず C と D が解けない限りこの appview は 500 しか返さない。**
DNS は この repo の中には無いので、そこは repo の外の判断である。
