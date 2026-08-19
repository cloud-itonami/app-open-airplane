# app-open-airplane

**この repo は `open-airplane.etzhayyim.com` の edge appview である。** 空港・機体・
フライト・安全インシデントの運用そのものは、**deploy される物の中には無い** ——
deploy されるのは XRPC 要求を MCP router へ中継する Worker 1 本と、その配備設定である。

**2026-08-19 に appview を TypeScript/Svelte から ClojureScript へ移行した**
（`docs/adr/0001`）。数字はすべて `scripts/verify-docs-claims.cljs` が tree から
再計算して検査する（25 claim）。

| | |
|---|---|
| Worker 名 | `etzhayyim-open-airplane` |
| 宣言 route | `open-airplane.etzhayyim.com/*`（**NXDOMAIN** —— 下記「呼び先」） |
| 宣言 DID | `did:web:open-airplane.etzhayyim.com`（未解決、同上） |
| 実行形態 | **ClojureScript → shadow-cljs `:target :esm` → Cloudflare Worker** |
| 上流 | `https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message`（**NXDOMAIN**） |
| 規模 | 36 ファイル |

手順は `docs/operator-quickstart.md`。以下は 2026-08-19 (UTC) に**実際に測って**
分かった現在地であり、推測は含まない。測り方は各項に書いてある。

---

## deploy されるものは、いま読んでいるソースである

```
src/open_airplane/route.cljc    判断（どの handler が答えるか）  ← 純 .cljc、テスト対象
src/open_airplane/view.cljc     ページ（jp-go-dds の hiccup）    ← 純 .cljc、テスト対象
src/open_airplane/worker.cljs   Request/Response に触る唯一の層
        ↓ shadow-cljs :target :esm
dist/worker.js                  ← worker/wrangler.jsonc の "main" が指すもの
```

移行前は `main` が `svelte/.svelte-kit/cloudflare/_worker.js` を指していた ——
**tree に存在しないビルド出力**である（`git ls-files | grep svelte-kit` は 0 件）。
そして読み手が開く `worker/src/app.ts`（23,512 バイト、8 NSID の完全実装に読める）は
**どの bundle にも入っていなかった**。いまは `main` が指す bundle が上のソースから
コンパイルされたものなので、その形は構造的に起こり得ない。
`scripts/verify-docs-claims.cljs` が **shadow の出力先と wrangler の `main` と
export の ns 名の 3 つが噛み合っていること**を検査し、噛み合わなくなれば落ちる。

判断を `.cljc` に置いてあるのは、ブラウザもビルドも無しにテストするためであり、
ingress capability が qualify した時に **最初に `.kotoba` へ移る部分**だからで
ある（入口を当面 cljs に置くのは ADR-2606290000 の判断）。

## 公開ルート

| METHOD | PATH | 何をするか |
|---|---|---|
| GET | `/` | この appview の説明ページ |
| GET | `/health` | 生存確認（**移行で追加。移植ではない** —— 下記） |
| POST | `/xrpc/:nsid` | XRPC を MCP router へ中継する |
| OPTIONS | `/xrpc/*` | CORS preflight |

**この表の出所は `open-airplane.route/routes` で、ページもそこから描く。** 移行前の
ページ（`worker/svelte/src/routes/+page.svelte`）は

```js
"routeCount": 0, "routes": [], "vars": []
```

を literal で持っており、隣の `worker/wrangler.jsonc` が **route 1・var 4** を宣言して
いることに気づけなかった。いまは route 表を渡す側が持ち、ページは描くだけなので、
両者がずれる余地が無い。

### 中継は nsid を検査しない（移行前と同じ）

移行前の deploy 側は `com.example.totallyUnrelated.doAnything` を自分の NSID と
同じに扱っていた。`worker/src/app.ts` なら 404 だったが、**それは deploy されて
いない**。検査を足すのは移行ではなく方針変更なので、していない。多段パス
（`/xrpc/a/b`）も同じ理由で、SvelteKit の rest parameter `[...path]` と同じく
**転送する**（空文字だけが 400）。

### `/health` は追加であって移植ではない

移行前 `/health` は **404** だった（実測。移行前 README の欠陥 A）。移行で足した。
deploy された面が答えているかを外から確かめる経路が 1 本も無いのは deploy 自体を
検査不能にするからで、sibling appview は全て持っている。**『deploy された振る舞い
の移植』の唯一の例外なので、隠さずここに書く。**

`x-etzhayyim-bff` ヘッダの値も `sveltekit-edge-bff` → `cljs-worker` に変えた
（上流に自分が何であるかを名乗るヘッダなので、SvelteKit を名乗り続けるのは嘘になる）。

## いま在るもの — 36 ファイル

| 面 | ファイル |
|---|---|
| 判断・描画・edge | `src/open_airplane/{route.cljc, view.cljc, worker.cljs}` |
| テスト | `test/open_airplane/route_test.cljc`（6 tests / 35 assertions） |
| ビルド | `deps.edn` / `shadow-cljs.edn` / `.gitignore` |
| Worker 設定 | `worker/wrangler.jsonc` |
| actor 記述子 | `worker/kotodama.jsonld` |
| 検査 | `scripts/{smoke-worker.cljs, verify-docs-claims.cljs}` |
| モデル（継承） | `bpmn/`(2) `dmn/`(1) `dodaf/`(6) `forms/`(2) |
| **別実装（継承・移行対象外）** | **`kotoba/`(8)** —— 下記 |
| 設計 | `CLAUDE.md` |
| 由来・識別 | `README.edn` / `migration.edn` |
| 文書 | `README.md` / `docs/operator-quickstart.md` / `docs/adr/0001-*.edn` |

**appview の TypeScript は 0 本、正本言語（`.cljs`/`.cljc`）が 4 本。** 移行前は
**5 対 0** だった（`worker/src/` の 3 本 + `worker/svelte/` の 2 本。`kotoba/` の 6 本は
別勘定）。この 2 つは検証器の claim なので、TS が戻れば落ちる —— 撤去した
10 パスに戻る場合（`removed-by-migration-absent`）も、別名で入る場合
（`appview-ts-files`）も、別々の claim が捕まえる。

## `kotoba/` は移行の対象ではない —— 消していない

`kotoba/`（**8 ファイル / 23,326 バイト**、うち `.ts` が 6 本）は `@etzhayyim/sdk` を
使う **AT PDS substrate の TypeScript ドメインライブラリ**で、空港・機体・フライトを
AT レコードとして持つ。実測: `grep -rn kotoba worker/` は **0 件** —— `worker/` からも
`wrangler.jsonc` からも参照されていない。

**どの bundle にも入っていないが、それは『appview の残骸』であることを意味しない。**
これは別の substrate 上の別の実装であり、`worker/svelte/` を置き換える作業とは
無関係である。『TypeScript を全部消す』という指示でこれを消すのは移行ではなく破壊
なので、**そのまま残した**。

代わりに検証器が**ファイル数と総バイト数を pin** する —— 「元から在った」が黙って
増えるための口実にならないようにするため。移行するなら、それは AT PDS SDK の cljs
face を要する別の決定である。

なお `kotoba/` の NSID 集合は `CLAUDE.md` とも移行前の `app.ts` とも一致しない
（`reportIncident` / `listIncidents` が無く、`getAirport` 等が在る）。これは移行前から
そうで、移行は直していない。

## 持ち越さなかったもの（黙って消していない）

判定は **2 条件の連言**である: deploy されていない **かつ** binding が
`wrangler.jsonc` に宣言されていない。

| 撤去したもの | バイト | deploy | binding |
|---|---|---|---|
| `worker/src/app.ts`（8 NSID・D1 5 テーブル DDL・OOOI 状態機械・DMN 重大度） | 23,512 | **無し** | `d1_databases` **0 件** |
| `worker/src/defence-handlers.ts` | 4,658 | 無し | —（自身のコメントが「Wire into app.ts with:」。一度も wire されていない） |
| `worker/src/dodaf-bootstrap.ts` | 1,707 | 無し | `PDS` service binding **無し** |
| `worker/svelte/` 7 ファイル（SvelteKit appview） | 7,432 | **これが deploy 側だった** | 置き換え済み |

合計 **37,309 バイト / 10 ファイル**。経路としては `/health` `/dodaf` `/forms`
`/_app/meta` `/_worker/health` が消えた（`/health` だけは cljs 側で作り直した）。

**git 履歴に残っている**:

```bash
git show 0c0085b:worker/src/app.ts        # 移行直前の commit
```

戻すなら D1 binding・`worker/package.json`・`@cloudflare/workers-types` が併せて要る
（`main` を差し替えるだけでは動かない）。**動かない経路を移植して「移行済み」と
言わないため**に撤去した。

### DoDAF の dangling 参照は「直して」いない

`dodaf/SV-1.json` と `dodaf/OV-6a.json` は `worker/src/app.ts` を Worker の
entrypoint として名指ししている。撤去でこの参照は宙に浮いた。**文字列を
`worker.cljs` に書き換えることはしなかった** —— SV-1 が記述しているのは D1 に
繋がった 8 XRPC interface のシステムで、cljs Worker はそれを実装していない。
書き換えれば model は**正しく見えるまま嘘になる**。2 ファイルは byte 単位で不変の
まま残し、代わりに **dangling している集合そのものを検証器の claim にした**
（`:dangling-entrypoint-refs`）。増えれば落ちる。

## ページが出す値・出さない値

env の**キー名**は出すが、値は出さない —— **中継先を除いて**。
`AGENTGATEWAY_MCP_ROUTER_URL` の値だけは、どこへ中継するかを運用者が見る必要が
あるので意図的に表示する。

smoke はこれを**2 つの独立した印**で見る: 出てはいけない値（sentinel を
`APP_HANDLE` に置く）と、出ていなければならない値（中継先 URL）。片方だけだと
「全部隠す」実装も「全部出す」実装も通ってしまう。sentinel は**ページが値を出さない
var** に置く —— ページが実際に出している唯一の値に印を置くと、2 つの検査が同じ
対象を見てしまい片方が無意味になる。

## UI

基盤は `kotoba-lang/jp-go-digital-design-system`（デジタル庁デザインシステム）。
色・寸法は `--hig-*` トークン契約だけで書き、raw hex も px フォントサイズも置かない。
app 固有 CSS は 3 行。CSS は外部リクエストゼロの方針どおり
`shadow.resource/inline` で bundle に焼く。

決定論的 audit（`kotoba-lang/design-quality`）で **100.00 / 100（gate 95）**。
**既定は 12 軸のうち 10 軸しか当てない**（CLI が自分でそう言う）ので
`--extra-axes` も回した —— 12 軸でも 100.00。

### デザインシステムの検査は 2 本ある

`dads-table` が在ることを 1 本で見る形は**落ちない検査**である —— それは view が
出力する markup であって、CSS が 1 バイトも入っていないページにも現れる。
**この repo で実測した**（下記「CSS を外した bundle」の mutation）:

| 探す文字列 | CSS 込み | CSS 無し |
|---|---|---|
| `class="dads-table"` | 1 | **1**（変わらない） |
| `--color-primitive-blue` | 45 | **0** |

だから 2 本に割った。**component を使ったか**と、**stylesheet が実際に入ったか**は
別の主張である。design-quality のスコアはこの区別をしない。

## 呼び先が 1 つも解決しない（移行では直らない）

`@1.1.1.1` に直接引いて確認（2026-08-19）:

| ホスト | 役割 | DNS |
|---|---|---|
| `open-airplane.etzhayyim.com` | 公開ホスト（wrangler の route）・`did:web` | **NXDOMAIN** |
| `mcp.etzhayyim.com` | `/xrpc/:nsid` の中継先 | **NXDOMAIN** |
| `etzhayyim.com` | apex | NOERROR（104.21.51.111 / 172.67.179.128） |

deploy 先も中継先も、いま存在しない。`/xrpc/` は到達できなければ **502 に URL を
添えて返す** —— 成功と同じ形で隠さない。移行前は上流 fetch が try/catch されておらず
SvelteKit の `{"message":"Internal Error"}` **500** に潰れており、どの層が失敗したか
応答から読めなかった。

## 由来（custody）

`migration.edn` は出所を `etzhayyim/root` の tree `433b6395` と宣言する。移行後の状態:

- 継承した **14 ファイル（25,388 バイト）**は**いまも 1 バイトも変わっていない**
  （sha256 を検証器に固定）—— `README.edn` `migration.edn` `worker/kotodama.jsonld`
  `bpmn/`(2) `dmn/`(1) `dodaf/`(6) `forms/`(2)
- `worker/wrangler.jsonc` と `CLAUDE.md` は**意図的に変更**した。custody の byte 一致
  集合から外し、**内容で検査する**（意図的な変更と勝手な変更を区別するため）
- TypeScript/Svelte の 10 ファイルは**移行で撤去**した。検証器はその 10 パスを
  名指しで「不在であること」を検査する —— byte 合計は「TS が消えた」と言えない
- `kotoba/` の 8 ファイルは**未変更のまま残した**（上記）

## 残っている欠陥（移行では直っていない）

移行前の README が測って記録した欠陥のうち、**移行が直したのは C（中継失敗が層を
隠す）・E（`main` が動かない実装を指せない）・J（Local Dev 手順が踏めない）・
M（`.gitignore` が無い）**。**F（`worker/` に型検査経路が無い）は「直した」のでは
なく、検査されていなかった対象そのものを撤去したことで消えた。** 残りは残っている:

1. **D. `open-airplane.etzhayyim.com` / `mcp.etzhayyim.com` が NXDOMAIN。** repo の外の
   判断。deploy しても誰も到達できず、到達できても中継は 502 になる。
2. **I. DMN が 2 箇所にある**問題は、TS 側の複製を撤去したことで**1 箇所に減った**が、
   `dmn/incident-severity.dmn` を読む engine はこの repo に無い（参照は
   `dodaf/OV-5b.json` と `OV-6a.json` の宣言だけ）。
3. **K. lockfile が無い**（`kotoba/` も）。毎回レンジを解決し直す。
4. **L. `LICENSE` ファイルが無い**。各ソース冒頭は Apache-2.0 を宣言し
   `see LICENSE at repo root` と書くが、その LICENSE は移行時に付いてこなかった。
5. **H の半分。** `kotoba/` は動くが、deploy される物と繋がっていない（上記）。

## 検証

```bash
npx nbb scripts/verify-docs-claims.cljs .          # <dir> は先頭に置く
```

exit 0 = 全一致 / 1 = 食い違い / **2 = 判定できなかった**（0 と区別する）。
テスト・ビルド・smoke・workerd 実測は `docs/operator-quickstart.md`。
