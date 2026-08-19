(ns open-airplane.route-test
  (:require [clojure.test :refer [deftest is testing]]
            [clojure.string :as str]
            [open-airplane.route :as route]
            [open-airplane.view :as view]))

(deftest dispatch-page-and-health
  (is (= :page (:action (route/dispatch "GET" "/"))))
  (is (= :health (:action (route/dispatch "GET" "/health"))))
  (is (= :method-not-allowed (:action (route/dispatch "POST" "/health"))))
  (is (= :not-found (:action (route/dispatch "GET" "/nope"))))
  (testing "移行前に app.ts が実装していたが deploy されていなかったパスは無い"
    (doseq [p ["/dodaf" "/forms" "/_app/meta" "/_worker/health"]]
      (is (= :not-found (:action (route/dispatch "GET" p)))
          (str p " を持ち越していない")))))

(deftest dispatch-xrpc
  (testing "単一セグメントの nsid を通す"
    (is (= {:action :xrpc :nsid "com.etzhayyim.apps.openAirplane.listAirports"}
           (route/dispatch "POST" "/xrpc/com.etzhayyim.apps.openAirplane.listAirports"))))
  (testing "空だけが 400。多段は移行前の [...path] と同じく転送する（絞るのは方針変更）"
    (is (= :bad-request (:action (route/dispatch "POST" "/xrpc/"))))
    (is (= {:action :xrpc :nsid "a/b"} (route/dispatch "POST" "/xrpc/a/b"))))
  (testing "namespace 外の nsid も中継する —— 移行前の deploy 側と同じ"
    (is (= {:action :xrpc :nsid "com.example.totallyUnrelated.doAnything"}
           (route/dispatch "POST" "/xrpc/com.example.totallyUnrelated.doAnything"))))
  (testing "preflight と method"
    (is (= :cors-preflight (:action (route/dispatch "OPTIONS" "/xrpc/x"))))
    (is (= :method-not-allowed (:action (route/dispatch "GET" "/xrpc/x"))))))

(deftest mcp-url-resolution
  (is (= "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message"
         (route/mcp-router-url {})))
  (is (= "https://a.example/x"
         (route/mcp-router-url {:AGENTGATEWAY_MCP_ROUTER_URL "https://a.example/x/"})))
  (testing "空白だけの設定は未設定として扱う（移行前の +server.ts と同じ）"
    (is (= "https://b.example"
           (route/mcp-router-url {:AGENTGATEWAY_MCP_ROUTER_URL "   "
                                  :MCP_ROUTER_URL "https://b.example"})))))

(deftest unwrap
  (is (= {:ok? true :value {:a 1}} (route/unwrap-mcp {:result {:structuredContent {:a 1}}})))
  (is (= {:ok? true :value {:a 1}} (route/unwrap-mcp {:result {:a 1}})))
  (is (false? (:ok? (route/unwrap-mcp {:error {:message "boom"}})))))

(deftest page-shows-the-real-routes
  (testing "ページは route 表から描く。0 を焼かない（docs/adr/0001 の欠陥）"
    (let [html (view/render {:css "/*x*/" :routes route/routes
                             :vars [:APP_HANDLE :PRIMARY_DID]
                             :mcp-url "https://mcp.example/x"})]
      (doseq [r route/routes]
        (is (str/includes? html (:route/path r))
            (str (:route/path r) " がページに出ていない")))
      (is (str/includes? html "APP_HANDLE"))
      (is (str/includes? html "https://mcp.example/x"))
      (is (not (str/includes? html "No public route is declared")))))
  (testing "route 表が空なら表も空 —— ページは表から描いていて、固定値ではない"
    (let [html (view/render {:css "" :routes [] :vars [] :mcp-url "https://m/x"})]
      (is (not (str/includes? html "/xrpc/:nsid"))))))

(deftest relay-headers-forwards-what-it-received
  (testing "移行前は host を削るだけで、authorization も上流へ届いていた"
    (let [h (route/relay-headers [["Host" "x.example"]
                                  ["Authorization" "Bearer t"]
                                  ["Content-Length" "9"]
                                  ["Content-Encoding" "gzip"]
                                  ["X-Trace" "abc"]]
                                 "com.a.b")]
      (is (= "Bearer t" (get h "authorization"))
          "authorization が落ちている —— preflight はこれを許可すると言っている")
      (is (= "abc" (get h "x-trace"))
          "呼び手が付けた header が落ちている")
      (is (nil? (get h "host")) "host は宛先が変わるので渡さない")
      (is (nil? (get h "content-length")) "body を詰め直すので元の長さは嘘になる")
      (is (nil? (get h "content-encoding")) "body を詰め直すので元の encoding も嘘になる")
      (is (= "application/json" (get h "content-type")))
      (is (= "com.a.b" (get h "x-etzhayyim-xrpc-method")))
      (is (= "cljs-worker" (get h "x-etzhayyim-bff"))))))
