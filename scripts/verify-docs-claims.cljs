#!/usr/bin/env nbb
;; verify-docs-claims — re-derive every number README.md and
;; docs/operator-quickstart.md state, from the tree itself, and fail when the
;; tree and the prose disagree.
;;
;; Before the cljs migration this file's load-bearing claim was a GAP: the
;; Worker that would be deployed was a SvelteKit build output (not even present
;; in the tree) while worker/src/app.ts -- the file that read like the
;; application -- was in no bundle. That gap is closed, so the claims now assert
;; the CLOSURE, and they are written so the gap cannot quietly come back: the
;; TypeScript is asserted ABSENT BY NAME, not merely absent from a byte total.
;;
;; Two things here differ from the sibling migrations, because this repo is
;; shaped differently:
;;
;;   1. `kotoba/` is a SEPARATE TypeScript domain library (AT PDS substrate).
;;      It is in no bundle and is referenced by nothing this migration replaced,
;;      so it was KEPT. A blanket ":production-ts-files 0" claim would therefore
;;      be false here. Instead the .ts claim is scoped to everything OUTSIDE
;;      kotoba/, and kotoba/ itself is PINNED by file count and byte total so it
;;      cannot grow silently under cover of "it was already there".
;;
;;   2. shadow-cljs.edn is checked by PARSING it, not by grepping it. The
;;      placement of :warnings-as-errors is exactly the kind of thing a grep
;;      cannot answer -- the comment in that file explaining the wrong placement
;;      contains the string ":build-options", so a grep-based check would report
;;      the defect it exists to prevent. (The reference implementation
;;      cloud-itonami/app-ongakuka greps shadow-cljs.edn and does not check the
;;      placement at all.)
;;
;; Usage:  nbb scripts/verify-docs-claims.cljs [<dir>]     (<dir> FIRST, default ".")
;; Exit:   0 every claim holds · 1 a claim is false · 2 could not answer

(require '["node:fs" :as fs]
         '["node:child_process" :as cp]
         '["node:crypto" :as crypto]
         '[clojure.string :as str]
         '[cljs.reader :as reader])

(def root (or (first (remove #(str/starts-with? % "--") *command-line-args*)) "."))

(def claims
  {:tracked-files 36
   :inherited-bytes 25388          ; the 14 inherited files still carried unchanged
   :kotoba-files 8                 ; the domain library that is NOT part of this migration
   :kotoba-bytes 23326
   :svelte-artifacts 0             ; no .svelte / svelte.config / svelte-dir file survives
   :sveltekit-compat-flags 0       ; nodejs_compat was adapter-cloudflare's; removed after workerd proof
   :appview-ts-files 0             ; .ts outside kotoba/ and scripts/
   :production-canonical-files 4   ; .cljs/.cljc outside scripts/
   :declared-vars 4
   :declared-routes 1
   :wrangler-main "../dist/worker.js"
   :shadow-output-dir "dist"
   :shadow-export "open-airplane.worker/handler"})

;; Inherited files this repository still carries BYTE-IDENTICAL. The migration
;; touched none of them. worker/wrangler.jsonc and CLAUDE.md are deliberately
;; NOT in this set -- the migration changed both on purpose -- and are checked
;; by content below instead, so an intended change and a stray one stay
;; distinguishable.
(def preserved
  {"README.edn" "2adc620593f2e70b8fcf17d45af19d48d68d71132d30a633eacfa62bf8f77a3f"
   "migration.edn" "1e28a3f8c5f4765fa4e47e47d033a72640a79fad61f6ae56ef8b51f5c7637233"
   "worker/kotodama.jsonld" "2f017fba44b3fff6cd100b501575ea456a527ce92e4819a484f3c24e9eeb139b"
   "bpmn/report-incident.bpmn" "1719d2212f20a12b9ebee0be5bf4cdbe9b03165106988ee6c319a6f48940e5b8"
   "bpmn/schedule-flight.bpmn" "83513480c433e5053e35f18c84cd76565af6658c55e42b3d2af7150863a713a8"
   "dmn/incident-severity.dmn" "c727c8347484ba74ec9bc04dca5fdcb6fbf21a554add7cc853a38b11fe763c0e"
   "dodaf/AV-1.json" "49d17f080c9410d752c0510a76152f1de96b55ccdbe07b86ab40dc709e3ffafb"
   "dodaf/CV-2.json" "4a6ff55f81790d73cedf43750811d0418cead87e3cefc1701deb9fdb07947ad5"
   "dodaf/OV-1.json" "99933c691c676c1e9386f0a620ae657fdc8be3015c50ab966a458b09499f5299"
   "dodaf/OV-5b.json" "e685fdb935904a8789f93a3142257d7352bc7ce141ad9ee505f1b5606b137d5c"
   "dodaf/OV-6a.json" "77f15e18404649b8690dda0a1eeaa6f09ae6d16550fa26504df7bf5f66738195"
   "dodaf/SV-1.json" "9603181867f21b8c72ace9856ebaf7f30ad72f84433c5337445935f26d4e9553"
   "forms/reportIncident.form.json" "51c09a80d3611fe16ce2b84a7c259d6c63f514b55379015144fe92f3fcde4052"
   "forms/scheduleFlight.form.json" "9f1d7d5b0a1f14922eb96e8855d084d50b4b940110baf2aff0629b6bffa252ab"})

;; What the migration REMOVED, by name. A byte total cannot say "the appview
;; TypeScript is gone"; this can, and it fails if any of it comes back.
(def removed-by-migration
  ["worker/src/app.ts"
   "worker/src/defence-handlers.ts"
   "worker/src/dodaf-bootstrap.ts"
   "worker/svelte/package.json"
   "worker/svelte/svelte.config.js"
   "worker/svelte/tsconfig.json"
   "worker/svelte/vite.config.ts"
   "worker/svelte/src/app.html"
   "worker/svelte/src/routes/+page.svelte"
   "worker/svelte/src/routes/xrpc/[...path]/+server.ts"])

;; The inherited DoDAF views name worker/src/app.ts as the Worker's entrypoint.
;; The migration removed that file, so those references now dangle. They were
;; NOT "fixed" by pointing them at worker.cljs: SV-1 describes a D1-backed
;; system with eight XRPC interfaces that has never been deployed and that the
;; cljs Worker does not implement, so re-pointing the string would make the
;; model look correct while saying something false. They are left byte-identical
;; and named here instead, so the dangling set is a checked fact rather than an
;; oversight -- if a new one appears, or these are edited, this goes red.
(def dangling-entrypoint-refs ["dodaf/OV-6a.json" "dodaf/SV-1.json"])

(def undetermined (atom []))
(def failures (atom []))
(defn undet! [m] (swap! undetermined conj m))

(defn tracked-files []
  (try (->> (.execSync cp "git ls-files" #js {:cwd root :encoding "utf8"})
            str/split-lines (remove str/blank?) vec)
       (catch :default e (undet! (str "git ls-files failed: " (.-message e))) nil)))
(defn slurp* [rel] (try (.readFileSync fs (str root "/" rel) "utf8") (catch :default _ nil)))
(defn bytes-of [rel] (try (.-size (.statSync fs (str root "/" rel))) (catch :default _ nil)))
(defn sha256 [rel]
  (try (-> (.createHash crypto "sha256") (.update (.readFileSync fs (str root "/" rel))) (.digest "hex"))
       (catch :default _ nil)))
(defn strip-jsonc [s] (str/replace s #"(?m)^\s*//.*$" ""))

(def claims-run (atom 0))

(defn check! [label expected actual]
  (swap! claims-run inc)
  (let [ok (= expected actual)]
    (println (str (if ok "PASS" "FAIL") "\t" (name label)
                  "\texpected=" (pr-str expected) "\tactual=" (pr-str actual)))
    (when-not ok (swap! failures conj label))
    ok))

(let [files (tracked-files)]
  (when (nil? files) (println "UNDETERMINED\tcould not list tracked files") (js/process.exit 2))
  (println (str "SCANNED\t" (count files)))
  (when (zero? (count files)) (println "UNDETERMINED\tscanned 0 files") (js/process.exit 2))

  (let [sizes (into {} (map (juxt identity bytes-of)) files)]
    (when-let [bad (seq (keep (fn [[f s]] (when (nil? s) f)) sizes))]
      (undet! (str "tracked but unreadable: " (str/join ", " bad))))

    (check! :tracked-files (:tracked-files claims) (count files))
    (check! :inherited-bytes (:inherited-bytes claims)
            (reduce + 0 (keep #(get sizes %) (keys preserved))))
    (check! :preserved-files-unchanged []
            (vec (keep (fn [[f want]] (let [got (sha256 f)]
                                        (when-not (= want got) (str f " " (or got "MISSING")))))
                       preserved)))

    ;; the appview TypeScript is gone, by name
    (check! :removed-by-migration-absent []
            (vec (filter #(some? (bytes-of %)) removed-by-migration)))

    ;; Svelte is gone and must not come back. The removed-by-migration list names
    ;; the seven files; this catches a return under ANY name -- a new .svelte
    ;; file, a svelte.config, a svelte/ directory.
    (check! :svelte-artifacts (:svelte-artifacts claims)
            (count (filter #(or (str/ends-with? % ".svelte")
                                (str/includes? % "svelte.config")
                                (str/includes? % "/svelte/"))
                           files)))

    ;; kotoba/ was KEPT on purpose (it is not the appview). Pin it so it cannot
    ;; grow silently -- "it was already there" must stop being available as cover.
    (let [k (filter #(str/starts-with? % "kotoba/") files)]
      (check! :kotoba-files (:kotoba-files claims) (count k))
      (check! :kotoba-bytes (:kotoba-bytes claims) (reduce + 0 (keep #(get sizes %) k))))

    ;; language of the production source. Scoped to EXCLUDE kotoba/ (kept
    ;; deliberately) and scripts/ (nbb tooling), which is why this claim is
    ;; :appview-ts-files and not :production-ts-files.
    (let [prod (remove #(or (str/starts-with? % "scripts/")
                            (str/starts-with? % "kotoba/"))
                       files)]
      (check! :appview-ts-files (:appview-ts-files claims)
              (count (filter #(str/ends-with? % ".ts") prod)))
      (check! :production-canonical-files (:production-canonical-files claims)
              (count (filter #(re-find #"\.(cljs|cljc|clj|kotoba)$" %) prod))))

    ;; the dangling DoDAF entrypoint references are a named, checked fact
    (check! :dangling-entrypoint-refs dangling-entrypoint-refs
            (vec (sort (filter (fn [f]
                                 (and (re-find #"^(dodaf|bpmn|dmn|forms)/" f)
                                      (when-let [c (slurp* f)]
                                        (str/includes? c "worker/src/app.ts"))))
                               files))))

    ;; CLAUDE.md no longer claims a TypeScript runtime
    (let [c (slurp* "CLAUDE.md")]
      (if (nil? c)
        (undet! "CLAUDE.md unreadable")
        (check! :claude-md-describes-cljs true
                (and (not (str/includes? c "Single CF Worker (`src/app.ts`)"))
                     (str/includes? c "shadow-cljs")))))

    ;; the deployed bundle is built from the source in this tree.
    ;; shadow-cljs.edn is PARSED, not grepped -- see the header.
    (let [w (some-> (slurp* "worker/wrangler.jsonc") strip-jsonc)
          sh-text (slurp* "shadow-cljs.edn")
          sh (try (reader/read-string sh-text) (catch :default e (undet! (str "shadow-cljs.edn unreadable as EDN: " (.-message e))) nil))]
      (if (or (nil? w) (nil? sh))
        (undet! "worker/wrangler.jsonc or shadow-cljs.edn unreadable")
        (let [j (js->clj (.parse js/JSON w) :keywordize-keys false)
              b (get-in sh [:builds :worker])]
          (check! :wrangler-main (:wrangler-main claims) (get j "main"))
          (check! :declared-vars (:declared-vars claims) (count (get j "vars")))
          (check! :declared-routes (:declared-routes claims) (count (get j "routes")))
          ;; the old config served a SvelteKit client dir that no longer exists
          (check! :no-stale-assets-binding true (nil? (get j "assets")))
          (check! :sveltekit-compat-flags (:sveltekit-compat-flags claims)
                  (count (filter #{"nodejs_compat" "nodejs_als"}
                                 (or (get j "compatibility_flags") []))))
          (check! :shadow-output-dir (:shadow-output-dir claims) (get b :output-dir))
          (check! :shadow-export (:shadow-export claims)
                  (str (get-in b [:modules :worker :exports 'default])))
          (check! :wrangler-main-is-shadow-output true
                  (= (str "../" (get b :output-dir) "/worker.js") (get j "main")))
          ;; :warnings-as-errors, and its PLACEMENT. A misplaced key is silently
          ;; ignored by shadow, which is the very failure it exists to prevent.
          (check! :warnings-as-errors true (get-in b [:compiler-options :warnings-as-errors]))
          (check! :warnings-as-errors-not-misplaced nil
                  (get-in b [:build-options :warnings-as-errors])))))

    ;; The page renders the route TABLE rather than a baked count -- the defect
    ;; ADR-0001 recorded was a literal `"routeCount": 0` beside a config
    ;; declaring one route and four vars. Asserted structurally (the view takes
    ;; :routes, the worker passes the real table) and NOT by forbidding a
    ;; substring: a check that forbids "routeCount" anywhere is tripped by the
    ;; docstring that explains the old defect. A check a comment can fail is a
    ;; check about prose.
    (let [v (slurp* "src/open_airplane/view.cljc")
          w (slurp* "src/open_airplane/worker.cljs")]
      (if (or (nil? v) (nil? w))
        (undet! "view.cljc or worker.cljs unreadable")
        (check! :page-renders-route-table true
                (and (str/includes? v "[{:keys [routes vars mcp-url built-at]}]")
                     (str/includes? v "(route-rows routes)")
                     (str/includes? w ":routes route/routes")))))

    ;; build output is not committed (brief step 8)
    (let [g (slurp* ".gitignore")]
      (if (nil? g)
        (undet! ".gitignore unreadable")
        (check! :gitignored []
                (vec (remove (fn [e] (some #(= e (str/trim %)) (str/split-lines g)))
                             ["dist/" ".cpcache/" ".shadow-cljs/" "node_modules/" ".wrangler/"])))))

    ;; The test count is quoted in all three documents too, and it drifted the
    ;; same way within hours of the migration merging: agent/relay-headers added
    ;; a test on 2026-08-19 and left "5 tests" standing in three places while the
    ;; suite ran 6. deftest forms ARE derivable from the tree, so pin them.
    ;;
    ;; The ASSERTION count is deliberately NOT claimed. It is not derivable
    ;; here: `is` forms nested in `testing` and split across lines make a grep
    ;; disagree with the runner (30 vs 35 when measured 2026-08-19). Claiming it
    ;; from a grep would be a check that is confidently wrong, which is worse
    ;; than one that is absent -- the suite itself is what checks that number.
    (let [t (slurp* "test/open_airplane/route_test.cljc")
          docs ["README.md"
                "docs/operator-quickstart.md"
                "docs/adr/0001-migrate-the-appview-from-typescript-to-clojurescript.edn"]
          unreadable (vec (remove #(some? (slurp* %)) (cons "test/open_airplane/route_test.cljc" docs)))]
      (if (seq unreadable)
        (undet! (str "unreadable: " (str/join ", " unreadable)))
        (let [n (count (re-seq #"(?m)^\(deftest\s" t))]
          (check! :declared-tests []
                  (vec (for [d docs
                             m (re-seq #"(\d+)\s*tests" (slurp* d))
                             :let [q (js/parseInt (second m))]
                             :when (not= q n)]
                         (str d " says " q " tests, the file declares " n)))))))

    ;; How many claims this script checks is ITSELF a documented number --
    ;; README.md, docs/operator-quickstart.md and docs/adr/0001 each quote it --
    ;; and until now nothing re-derived it, so it drifted: the ADR said 21 while
    ;; the script ran 23 (measured 2026-08-19, verifying the merged migration).
    ;; That is this file's own defect class, one level up: a number in prose
    ;; that no check derives goes stale silently and still reads as evidence.
    ;; So the count checks itself.
    ;;
    ;; The total INCLUDES this check, hence (inc @claims-run): adding a claim
    ;; without updating all three documents is what goes red.
    (let [docs ["README.md"
                "docs/operator-quickstart.md"
                "docs/adr/0001-migrate-the-appview-from-typescript-to-clojurescript.edn"]
          total (inc @claims-run)
          unreadable (vec (remove #(some? (slurp* %)) docs))]
      (if (seq unreadable)
        (undet! (str "doc unreadable: " (str/join ", " unreadable)))
        (check! :documented-claim-count []
                (vec (for [d docs
                           m (re-seq #"\*{0,2}(\d+)\*{0,2}\s*claim" (slurp* d))
                           :let [n (js/parseInt (second m))]
                           :when (not= n total)]
                       (str d " says " n ", script runs " total))))))))

(let [u @undetermined f @failures]
  (when (seq u)
    (doseq [m u] (println (str "UNDETERMINED\t" m)))
    (println "Refusing to report a pass: the tree could not be read completely.")
    (js/process.exit 2))
  (if (seq f)
    (do (println (str "FAILED\t" (count f) " claim(s): " (str/join ", " (map name f)))) (js/process.exit 1))
    (do (println "OK\tevery claim in README.md and docs/operator-quickstart.md holds") (js/process.exit 0))))
