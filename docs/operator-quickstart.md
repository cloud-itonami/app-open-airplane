# operator quickstart — app-open-airplane

`open-airplane.etzhayyim.com` の edge appview を、手元で **build して起動して叩く**まで。
下の手順は 2026-08-17 (UTC) に clean-room（`node_modules` と `.svelte-kit` が無い状態）で
実走した結果であり、掲載している数字は**そのとき実際に出た値**である。

読む前に `README.md` の §1–§2 を見ること —— **`worker/src/app.ts` は動いていない。**
ここで build・起動するのは `worker/svelte/` 側である。

実測環境: macOS 26.3.1 (darwin 25.3.0) / node **v26.3.0** / npm **11.16.0** /
wrangler **4.69.0**。

---

## 0. このマシン特有の前置き（先に読む。読まないと §4 で必ず落ちる）

このワークステーションの `~/.npmrc` には `allow-scripts[]` が設定されている。
`worker/svelte/` では**警告で済む**が、`kotoba/` は git 依存を持つため
**install がエラーで止まる**:

```
npm error code EALLOWSCRIPTS
npm error --allow-scripts is not allowed in project-scoped installs.
```

これは repo 側の欠陥ではない（repo に `.npmrc` を足す必要は無い）。回避は
ユーザ設定を外して 1 回だけ install すること:

```bash
npm_config_userconfig=/dev/null npm install
```

**以下、`kotoba/` の手順ではこの prefix を付けている。** `~/.npmrc` に
`allow-scripts[]` が無いマシンでは、prefix 無しでそのまま通る。

## 1. 場所

配備単位は repo 直下ではなく `worker/` で、npm プロジェクトは**さらにその下の
`worker/svelte/`** に在る。

```bash
cd worker
```

`wrangler.jsonc` はここに在る。**`worker/` には `package.json` が無い**ので、
ここで `npm install` を打っても何も起きない（README 欠陥 F）。

⚠ `CLAUDE.md` の Local Dev 節は `cd 60-apps/etzhayyim-project-open-airplane/worker` と
書いているが、**そのパスはこの repo に存在しない**（移行前の monorepo のもの）。
同節の `e7m actor deploy .` も、`e7m` が PATH に無いので踏めない（実測: `not found`）。

## 2. 依存を入れて build する（配備される側）

```bash
cd svelte
npm install
```

実測: `added 93 packages, and audited 94 packages in 3s`（exit 0）。
`esbuild` と `workerd` の postinstall について allow-scripts 警告が 2 件出るが、
**抑止されたままで §3 の build も §4 の起動も通る**（そこまで確認した）。

⚠ **lockfile が repo に無い**（README 欠陥 K）。毎回レンジを解決し直すので、93 という数字は
将来ずれる。この `npm install` は `package-lock.json` を**生成する**が、`.gitignore` が
無いので untracked ファイルとして `git status` に出る（欠陥 M）。commit しないこと ——
lockfile を入れるかどうかは、この quickstart ではなく repo の判断である。

```bash
npm run check
```

実測: `COMPLETED 163 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`（exit 0）。
このスクリプトは `svelte-kit sync` を先に走らせるので、`.svelte-kit/tsconfig.json` が
無い状態（clone 直後）でも単体で通る。

## 3. build

このワークスペースでは重い build を直接起動しない（superproject CLAUDE.md の
resource governor）。**同時に 1 本**に制限する guard を必ず通す:

```bash
node /path/to/com-junkawasaki/scripts/resource-guard.mjs run build -- npm run build
```

実測: exit 0。所要は 2 回の実走で 4.11s と 4.63s だった —— **時間を合格判定に使わない**
（このマシンは並行セッションで load が高い）。見るのは exit code と下の出力である:

```
.svelte-kit/output/server/entries/endpoints/xrpc/_...path_/_server.ts.js   2.45 kB
.svelte-kit/output/server/index.js                                       126.05 kB
Using @sveltejs/adapter-cloudflare  ✔ done
```

### build 出力に `src/app.ts` が入らないことを自分で確かめる

README §2 の主張はここで再現できる。**`.svelte-kit/` 全体**を検索する（`cloudflare/` だけ
見ると、adapter の `_worker.js` が `../output/server/index.js` を import するだけの
4.3 KB なので、何も見つからず誤読する）:

```bash
grep -rl AIRPLANE_DB      .svelte-kit/ | wc -l     # → 0   app.ts の D1 binding
grep -rl defineAirport    .svelte-kit/ | wc -l     # → 0   app.ts の NSID handler
grep -rl open-airplane.AV-1 .svelte-kit/ | wc -l   # → 0   app.ts が import する DoDAF view
grep -rl mcp.etzhayyim.com  .svelte-kit/ | wc -l   # → 1   実際に配備される中継先
```

## 4. 起動して叩く

```bash
cd ..            # worker/ に戻る（wrangler.jsonc の隣）
wrangler dev --local --port 8899 --ip 127.0.0.1
```

実測で出るが**無視してよい**もの:

- `Error: EMFILE: too many open files, watch` が多数 —— このマシンは並行セッションで
  fd を使い切っており、file watcher が張れないだけ。**サーバは起動する。**
- `The latest compatibility date supported by the installed Cloudflare Workers Runtime is
  "2026-03-05", but you've requested "2026-04-20". Falling back to "2026-03-05"` ——
  wrangler 4.69.0 と `wrangler.jsonc` の `compatibility_date` の差。

`[wrangler:info] Ready on http://127.0.0.1:8899` が出たら次へ。

### 実測した応答（この表と違ったら、それは変化である）

```bash
B=http://127.0.0.1:8899
curl -s -o /dev/null -w '%{http_code}\n' $B/                                              # 200
curl -s -o /dev/null -w '%{http_code}\n' $B/health                                        # 404
curl -s -o /dev/null -w '%{http_code}\n' $B/_app/meta                                     # 404  (body: "Not found")
curl -s -o /dev/null -w '%{http_code}\n' $B/dodaf                                         # 404
curl -s -o /dev/null -w '%{http_code}\n' $B/forms                                         # 404
curl -s -o /dev/null -w '%{http_code}\n' $B/xrpc/com.etzhayyim.apps.openAirplane.listAirports   # 405 "GET method not allowed"
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS $B/xrpc/whatever                      # 204
```

`/health` `/dodaf` `/forms` `/_app/meta` は **`src/app.ts` が実装しているが配備されない**
ので 404 になる（README 欠陥 A）。`GET /xrpc/*` が 405 なのは、配備される handler が
`POST` と `OPTIONS` しか export していないため。

### XRPC は 3 種類とも 500 になる（現在地）

```bash
post() { curl -s -w ' -> %{http_code}\n' -X POST $B/xrpc/$1 -H 'content-type: application/json' -d '{}'; }
post com.etzhayyim.apps.openAirplane.listAirports          # {"message":"Internal Error"} -> 500
post com.etzhayyim.apps.openAirplane.thisMethodDoesNotExist # {"message":"Internal Error"} -> 500
post com.example.totallyUnrelated.doAnything               # {"message":"Internal Error"} -> 500
```

**3 つが同一の応答になる**ことを確認すること。配備される handler は NSID を検査せず、
何でも MCP router へ渡す（README 欠陥 B / §2）。

原因は上流である。`wrangler dev` のログに出る実際の例外はこれ:

```
Error: internal error; reference = ...
    at async POST (.svelte-kit/output/server/entries/endpoints/xrpc/_...path_/_server.ts.js:27)
```

27 行目は上流 `fetch` である。上流のホストが引けないことを、**ローカル resolver に
依存しない形で**確かめる:

```bash
dig mcp.etzhayyim.com @1.1.1.1 +noall +comment   # → status: NXDOMAIN
dig etzhayyim.com     @1.1.1.1 +short            # → 172.67.179.128  （apex は在る）
```

つまり **500 は手元の環境不備ではない**（README 欠陥 C）。`AGENTGATEWAY_MCP_ROUTER_URL` を
到達可能な router に向けない限り、この worker は本番でも同じ 500 を返す。

## 5. `kotoba/` を検査する（3 つ目の実装）

`worker/` とは独立した npm プロジェクトで、AT PDS 上の実装 + テストが入っている。
**§0 の prefix が要る。**

```bash
cd kotoba
npm_config_userconfig=/dev/null npm install
```

実測: exit 0、**2 分 6 秒**（`@etzhayyim/sdk` と `@etzhayyim/sdk-mock` を git から取得し、
その依存を含めて解決するため。`worker/svelte/` の 10s とは桁が違う）。
`prepare: tsc` を持つ 8 パッケージについて allow-scripts 警告が出るが、**抑止されたままで
下の型検査とテストは通る**（そこまで確認した）。

```bash
npm_config_userconfig=/dev/null npx tsc --noEmit    # exit 0 / 出力 0 行
npm_config_userconfig=/dev/null npx vitest run
```

実測:

```
 Test Files  1 passed (1)
      Tests  7 passed (7)
   Duration  341ms
```

**この 7 件は現在どの CI からも呼ばれていない**（README §4）。

## 6. 配備設定を検証する（deploy はしない）

```bash
cd worker
wrangler deploy --dry-run --outdir /tmp/wr-dry
```

実測: exit 0 / `Total Upload: 374.40 KiB / gzip: 86.68 KiB`。列挙される binding は
これだけである:

```
env.ASSETS                        Assets
env.APP_HANDLE                    "open-airplane.etzhayyim.com"
env.PRIMARY_DID                   "did:web:open-airplane.etzhayyim.com"
env.APP_FRAMEWORK                 "sveltekit-edge-bff"
env.AGENTGATEWAY_MCP_ROUTER_URL   "https://mcp.etzhayyim.com/xrpc/com.et..."
```

**D1 が無い**ことをここで確認できる（README 欠陥 E）。`CLAUDE.md` は
「Storage: D1. Tables: airports, aircraft, flights, flight_status, incidents」と書くが、
`d1_databases` は `wrangler.jsonc` に 1 つも無い。

### 本番 deploy について

**この quickstart は deploy を含まない。** 宣言 route `open-airplane.etzhayyim.com/*` は
公開 DNS に無く（`dig ... @1.1.1.1` → NXDOMAIN、README 欠陥 D）、上流も無い（欠陥 C）ので、
今 deploy しても届かない先に 500 を返す worker を置くだけになる。

実際に deploy する段になったら、superproject の規則に従うこと —— **`origin/main` を
包含した checkout からのみ deploy する**（PreToolUse hook
`wrangler-deploy-main-sync-guard.cljs` が強制する。deploy には push と違って
fast-forward 検査が無く、古い checkout から出すと他セッションの変更を黙って巻き戻す）。

## 7. 後片付け

```bash
pkill -f "wrangler dev --local --port 8899"
```

⚠ **この repo には `.gitignore` が無い**（README 欠陥 M）。上の手順を踏むと、
生成物が全部 untracked として `git status` に出る —— 実測:

```
?? kotoba/node_modules/          ?? worker/.wrangler/
?? kotoba/package-lock.json      ?? worker/svelte/.svelte-kit/
?? worker/svelte/node_modules/   ?? worker/svelte/package-lock.json
```

**`git add -A` を打たないこと。** 消すなら明示的に:

```bash
rm -rf kotoba/node_modules kotoba/package-lock.json \
       worker/svelte/node_modules worker/svelte/package-lock.json \
       worker/svelte/.svelte-kit worker/.wrangler /tmp/wr-dry
```
