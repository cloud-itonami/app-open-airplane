# operator-quickstart

**この repo で今日実際にできることを、踏める形で上から書く。** 所要 5 分。
Cloudflare のアカウントは要らない（deploy だけが要る。§6）。

出力はすべて 2026-08-19 に**実際に walk した結果**である。推測は無い。

移行前のこの文書は SvelteKit のビルド手順を書いていた。**その経路はもう無い**
（`docs/adr/0001`）。読む前に `README.md` の「deploy されるものは、いま読んで
いるソースである」を見ること。

## 0. 前提

| 要るもの | 確認 | この walk で使った版 |
|---|---|---|
| git | `git --version` | 2.51.0 |
| nbb | `npx --yes nbb --version` | v1.4.208 |
| clojure / java | — | ビルド時のみ（shadow-cljs が使う） |

## 1. 取得して、書いてあることが本当か検査する

```bash
git clone git@github.com:cloud-itonami/app-open-airplane.git
cd app-open-airplane
REPO=$PWD
npx --yes nbb scripts/verify-docs-claims.cljs .
```

末尾が `OK` なら README の数値・存在・不在は tree と一致している（**23 claim**）。
**exit 2（UNDETERMINED）は 0 ではない** —— tree を読み切れなかったという別の
答えで、「検査して問題なし」と混ぜない。

実際の出力（末尾）:

```
PASS	page-renders-route-table	expected=true	actual=true
PASS	gitignored	expected=[]	actual=[]
OK	every claim in README.md and docs/operator-quickstart.md holds
```

この検査には移行の不変条件が入っている:

- 撤去した 10 パスの TypeScript が戻っていないこと（`removed-by-migration-absent`）
  と、**別名で戻っていない**こと（`appview-ts-files`）
- **`kotoba/` が黙って増えていない**こと（`kotoba-files` / `kotoba-bytes`）——
  これは移行対象外で意図的に残した TypeScript なので、「元から在った」が
  口実にならないよう数を固定してある
- `worker/wrangler.jsonc` の `main` が shadow の出力先を指していること
- **`:warnings-as-errors` が `:compiler-options` に在ること、かつ
  `:build-options` に無いこと** —— shadow-cljs.edn を **EDN として parse** して
  見る。grep では判定できない（§4.1）
- ページが route 表から描かれていること
- 継承した 14 ファイルが 1 バイトも変わっていないこと（sha256）

## 2. テストを走らせる（ビルド不要・ブラウザ不要）

判断（`route.cljc`）と描画（`view.cljc`）は純 `.cljc` なので、nbb だけで回る。

```bash
K=~/github/com-junkawasaki/orgs/kotoba-lang
CP="src:test:$K/jp-go-digital-design-system/src:$K/html/src:$K/css/src"
cat > /tmp/run.cljs <<'RUN'
(require '[cljs.test :refer [run-tests]] 'open-airplane.route-test)
(run-tests 'open-airplane.route-test)
RUN
npx --yes nbb --classpath "$CP" /tmp/run.cljs
```

実際の出力:

```
Testing open-airplane.route-test

Ran 5 tests containing 27 assertions.
0 failures, 0 errors.
```

何を固定しているか: `/xrpc/` は**空の nsid だけ** 400 にする（`/xrpc/a/b` は
移行前の rest parameter `[...path]` と同じく転送する。1 セグメントに絞るのは
移行ではなく方針変更）、namespace 外の nsid も中継する（移行前の deploy 側と
同じ）、MCP router の URL 解決（空白だけの設定は未設定として扱う）、
`result` / `structuredContent` の剥がし方、移行前の `app.ts` にあって deploy
されていなかった `/dodaf` `/forms` `/_app/meta` `/_worker/health` を
**持ち越していない**こと、そして**ページが route 表から描かれること**。

## 3. ページを描画して採点する

```bash
K=~/github/com-junkawasaki/orgs/kotoba-lang
CP="src:$K/jp-go-digital-design-system/src:$K/html/src:$K/css/src"
cat > /tmp/render.cljs <<'REN'
(require '["node:fs" :as fs] '[open-airplane.view :as view] '[open-airplane.route :as route])
(.writeFileSync fs "/tmp/oa-page.html"
  (view/render {:css (.readFileSync fs (str (.-DDS js/process.env) "/resources/jp_go_dds/dds.css") "utf8")
                :routes route/routes
                :vars [:AGENTGATEWAY_MCP_ROUTER_URL :APP_FRAMEWORK :APP_HANDLE :PRIMARY_DID]
                :mcp-url "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"}))
REN
DDS="$K/jp-go-digital-design-system" npx --yes nbb --classpath "$CP" /tmp/render.cljs

cd $K/design-quality && npx --yes nbb -m design-quality.cli score /tmp/oa-page.html --min 95
```

実際の出力（末尾）:

```
  100.00  /tmp/oa-page.html
aggregate: 100.00
axes scored: 10 (viewport, safe-area, dynamic-viewport, tap-targets, focus-visible,
                 reduced-motion, overflow-guard, color-scheme, responsive, semantics)
NOT scored: input-zoom, contrast — pass --extra-axes to include the optional ones
gate: aggregate 100.00 >= min 95.00 -> PASS
```

**既定では 12 軸のうち 10 軸しか当たらない。CLI が自分でそう言う。** 残り 2 軸も:

```bash
npx --yes nbb -m design-quality.cli score /tmp/oa-page.html --min 95 --extra-axes
# axes scored: 12 (…, input-zoom, contrast)
# aggregate: 100.00 -> PASS
```

### この 100.00 が言っていないこと

**デザインシステムを完全に外しても 96.63 で PASS する**（実測。`:css ""` で
描画して採点）。つまりこのスコアは「DADS が入っている」ことの証拠にならない。
それを言えるのは §5 の smoke の 2 本目だけである。

## 4. bundle をビルドする

**高負荷ビルドは同時 1 本に制限されている**（superproject `CLAUDE.md` の
resource governor）。直接叩かず、必ず guard 経由で:

```bash
cd "$REPO"
node ~/github/com-junkawasaki/scripts/resource-guard.mjs run build -- \
  npx --yes shadow-cljs release worker
ls -la dist/worker.js
```

lock を他セッションが持っていると **exit 2** で拒否される。**迂回しない** ——
これはエラーではなく順番待ちである。

実際の出力（末尾）と成果物:

```
[:worker] Build completed. (55 files, 12 compiled, 0 warnings, 5.25s)
dist/worker.js   245,823 bytes
sha256  0352647af47ba0213e73f1a600ff759759dd8d3ff633579e26ddbf6ed7ec406d
```

**この sha は cold cache（`rm -rf .shadow-cljs` 後）でのみ再現する。**
shadow の `:esm` 出力は同一ソースでも incremental rebuild だとバイトが変わる
（安定して変わる）。成果物を突き合わせるときは必ず cache を消してから。

### 4.1 壊れた var はビルドを**落とす**（実測）

`shadow-cljs.edn` の `:compiler-options` に `:warnings-as-errors true` がある。
無ければ shadow は存在しない var を **WARNING** にして **exit 0** し、bundle を
書いてしまう ——「ビルドが通った」は検査ではない（**落ちようがない**）。

この repo で実際に落として確かめた。`src/open_airplane/worker.cljs:115` の
`route/dispatch` を存在しない `route/dispatch-nonexistent` に改名する:

| 設定 | exit | `dist/worker.js` sha256 | 挙動 |
|---|---|---|---|
| `:compiler-options` に在る（現状） | **1** | `0352647a…` **不変** | 出荷しない |
| `:build-options` に置く（誤配置） | **0** | `3be64d65…` **別物** | `1 warnings` で**出荷する** |

誤配置版の bundle を実際に叩くと、最初のリクエストで
`Cannot read properties of undefined (reading 'h')` を投げる（smoke は
`UNDETERMINED` / **exit 2** で「判定できなかった」と答え、合格にはしない）。

**キーは `:build-options` ではなく `:compiler-options` に置く。** shadow が読むのは
`[:compiler-options :warnings-as-errors]` で、置き場所を間違えると**黙って
無視される** —— この option が防ぐはずの失敗そのものになる。

**だから検証器は grep ではなく parse する。** 誤配置しても
`grep -c warnings-as-errors shadow-cljs.edn` は **3** を返す（うち 2 つは置き場所を
説明する自分のコメント）—— grep 版の検査は自分のコメントに当たって緑のままになる。

## 5. ビルドした成果物を実際に叩く

ここが deploy されるものに触る唯一の検査である。

```bash
cd "$REPO" && npx --yes nbb scripts/smoke-worker.cljs dist/worker.js
```

実際の出力（21 項目、抜粋）:

```
PASS	default export has fetch	expected=true	actual=true
PASS	GET / status	expected=200	actual=200
PASS	page hides other var values	expected=false	actual=false
PASS	page shows the relay target it uses	expected=true	actual=true
PASS	page uses the design system components	expected=true	actual=true
PASS	page carries the stylesheet itself	expected=true	actual=true
PASS	POST /xrpc/ status	expected=400	actual=400
PASS	single-segment nsid is relayed (unreachable -> 502)	expected=502	actual=502
PASS	multi-segment nsid is relayed too, not rejected	expected=502	actual=502
PASS	un-deployed app.ts route was not carried over	expected=404	actual=404
OK	the built bundle answers as the route table says
```

**bundle が無ければ exit 2**（「判定できなかった」であって合格ではない）。

3 組の検査は、それぞれ**片方だけでは落ちない**ので割ってある:

| 主張 | 印 | 割らないと |
|---|---|---|
| view がライブラリを呼んだ | `class="dads-table"` | CSS 0 バイトでも出る（実測: css 有 1 / css 無 **1**） |
| stylesheet が実際に入った | `--color-primitive-blue` | 上と混ざる（実測: 45 / **0**） |
| 値を出していない | sentinel（`APP_HANDLE` に置く） | 「全部隠す」実装が通る |
| 出すべき値は出している | 中継先 URL | 「全部出す」実装が通る |

sentinel は**ページが値を出さない var** に置く —— ページが実際に出している唯一の
値に印を置くと、2 つの検査が同じ対象を見てしまい片方が無意味になる。
中継先は `.invalid`（RFC 2606 で必ず解決しない TLD）にしてあるので、
**「中継された」ことを実 DNS に依存せず**確かめられる。

## 5.5 Workers ランタイム（workerd）で動かす

Node で import する smoke より強い検査。実際の workerd で起こす。

```bash
cd "$REPO/worker"
npx --yes wrangler@latest dev --local --port 8812 --ip 127.0.0.1
# 別シェルで
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:8812/
curl -s http://127.0.0.1:8812/health
```

実際の出力:

```
GET  /            -> 200 text/html; charset=utf-8
GET  /health      -> {"ok":true,"app":"open-airplane","runtime":"cljs","routes":["/","/health","/xrpc/:nsid"]}
POST /xrpc/       -> 400 {"error":"Missing XRPC method"}
POST /xrpc/<nsid> -> 502 {"error":"MCP router unreachable","url":"https://mcp.etz…"}
POST /xrpc/a/b    -> 502
OPTIONS /xrpc/x   -> 204
GET  /nope        -> 404
POST /health      -> 405
GET  /dodaf       -> 404
```

ページは 81,835 バイト、DADS の CSS 変数 45 箇所、`APP_HANDLE` の**キーは 1 回
出て値は 0 回**。

`compatibility_flags`（`nodejs_compat`）は SvelteKit の adapter-cloudflare 由来で、
この bundle には要らない。**撤去は憶測ではなく、flags を外した設定のまま
workerd を起こしてこの全 route を確認してから行った。**

## 6. deploy

```bash
cd "$REPO/worker"
npx wrangler deploy
```

**ただし route が指すホストは解決しない。** `@1.1.1.1` に直接引いた実測:

```
open-airplane.etzhayyim.com  → NXDOMAIN
mcp.etzhayyim.com            → NXDOMAIN
etzhayyim.com                → 104.21.51.111 / 172.67.179.128（apex は在る）
```

deploy が成功しても誰も到達できず、到達できたとしても中継は **502 を返す**
（成功と同じ形で隠さない）。superproject の deploy guard は `origin/main` を
含む checkout からの deploy しか許さない点も併せて注意。

**この移行では deploy していない。** ビルドと workerd 実測までで止めてある。

## 7. `kotoba/` を触るなら

`kotoba/` は移行対象外の TypeScript ドメインライブラリである（`README.md` の
「`kotoba/` は移行の対象ではない」）。そこだけは npm で動く:

```bash
cd "$REPO/kotoba" && npm install && npx tsc --noEmit && npx vitest run
```

**この walk では実行していない**（移行の範囲外で、`@etzhayyim/sdk` を git から
取りに行くため）。移行前の測定では `tsc --noEmit` が exit 0、`vitest run` が
7 passed だった —— それは移行前の値であって、ここで再測定はしていない。

## 8. ここに無いもの

- `worker/src/app.ts` の 8 NSID 実装 / D1 の 5 テーブル / OOOI 状態機械 /
  DMN 重大度分類 —— deploy されておらず binding も宣言されていなかったので
  **持ち越していない**（`README.md` の「持ち越さなかったもの」）。
  `git show 0c0085b:worker/src/app.ts` で読める
- `/dodaf` `/forms` `/_app/meta` `/_worker/health` —— 同上
- 運航そのもの（この repo は appview であって運航系ではない）
