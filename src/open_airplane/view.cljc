(ns open-airplane.view
  "この appview の説明ページ。純 hiccup。

  基盤は `jp-go-dds`(デジタル庁デザインシステム) —— superproject の
  skill `kotoba-uiux` が定める新規 UI の base。色・寸法は `--hig-*` トークン
  契約で書き、raw hex も px フォントサイズも置かない。

  **表示する事実は引数で受け取る。ページの中に焼かない。**
  これは装飾の都合ではなく、docs/adr/0001 が記録した欠陥そのものへの答えで
  ある —— 移行前のページ（`worker/svelte/src/routes/+page.svelte`）は

      \"routeCount\": 0, \"routes\": [], \"vars\": []

  を literal で持っていて、隣の `worker/wrangler.jsonc` が route 1・var 4 を
  宣言していることに気づけなかった。ここでは route 表と設定を渡す側が持ち、
  ページは描くだけなので、両者がずれる余地が無い。

  同じ理由で **NSID の一覧を焼かない**。deploy される handler は nsid を検査
  せず何でも中継するので、8 つの NSID を並べたページは worker がしていない
  主張をすることになる（移行前の `worker/src/app.ts` は検査したが、それは
  どの bundle にも入っていなかった）。"
  (:require [jp-go-dds.core :as dds]
            [jp-go-dds.page :as page]
            [jp-go-dds.tokens :as tokens]
            [clojure.string :as str]))

(def app-css
  "app 固有の最小 CSS。`--hig-*` 契約だけを使う(bridge が DADS の上に再定義する)。
  DADS を base にした app の下には `shitsuke.hig` が居ないので、bridge が運んで
  いないトークンは何にも解決しない —— 使うのは運ばれている中だけ。"
  (str/join
   "\n"
   [".oa-lede { color: var(--hig-color-secondary-label); max-width: 42rem; }"
    ".oa-note { color: var(--hig-color-secondary-label); font-size: var(--hig-text-footnote-font-size); }"
    ".oa-mono { font-family: var(--hig-font-mono); }"]))

(defn- route-rows [routes]
  (mapv (fn [r]
          [(str/upper-case (name (:route/method r)))
           [:span {:class "oa-mono"} (:route/path r)]
           (:route/doc r)])
        routes))

(defn body
  "opts:
   :routes    open-airplane.route/routes（この Worker が実際に答えるもの）
   :vars      wrangler が渡した env のキー（**キー名だけ**。値は出さない）
   :mcp-url   XRPC の中継先（route/mcp-router-url の戻り値。**値そのもの**）
   :built-at  bundle のビルド時刻（不明なら nil）"
  [{:keys [routes vars mcp-url built-at]}]
  (dds/container
   (dds/section
    {}
    (dds/heading 1 "Open Airplane — 航空運航 appview")
    [:p {:class "oa-lede"}
     "空港・機体・フライト・安全インシデントを扱う open-airplane の公開面。"
     "**運航そのものはここには無い** —— deploy されるのは XRPC 要求を MCP "
     "router へ中継する Worker 1 本と、その配備設定である。"])

   (dds/section
    {:title "この面が答えるもの"}
    (dds/table {:caption "公開ルート"
                :headers ["METHOD" "PATH" "何をするか"]
                :rows (route-rows routes)})
    [:p {:class "oa-note"}
     "この表は Worker の route 表そのものから描いている。ページに焼いた値では"
     "ないので、実際に答えるものと表示がずれない。"]
    [:p {:class "oa-note"}
     "中継は nsid を検査しない —— 移行前に deploy されていた handler と同じで、"
     "どの tool 名もそのまま上流へ渡す。"])

   (dds/section
    {:title "実行時の設定"}
    (if (seq vars)
      [:div (into [:p] (interpose " "
                                  (map (fn [k] (dds/chip-label (name k))) vars)))
       [:p {:class "oa-note"}
        "キー名のみ。**ただし下の中継先だけは値そのもの**（"
        [:span {:class "oa-mono"} "AGENTGATEWAY_MCP_ROUTER_URL"]
        "）—— どこへ中継するかは運用者が見る必要があるので意図的に出している。"
        "それ以外の値は出さない。"]]
      [:p {:class "oa-note"} "env が渡されていない（ローカル描画）。"])
    [:p {:class "oa-note"} "XRPC の中継先: "
     [:span {:class "oa-mono"} mcp-url]])

   (dds/section
    {:title "現在地"}
    [:p {:class "oa-lede"}
     "この appview は TypeScript/Svelte から ClojureScript へ移行済み。"
     "deploy される bundle は、いま読んでいるソースからコンパイルされたもので"
     "ある（docs/adr/0001）。"]
    (when built-at
      [:p {:class "oa-note"} "bundle build: " built-at]))))

(defn render
  "完全な HTML 文書。`css` は呼び出し側が渡す(ライブラリは I/O を持たない)。"
  [{:keys [css] :as opts}]
  (page/->page
   {:title "Open Airplane — 航空運航 appview"
    :description "空港・機体・フライト・安全インシデントを扱う open-airplane の公開面。"
    :lang "ja"
    :css css
    :app-css (str tokens/bridge-css "\n" app-css)}
   (body opts)))
