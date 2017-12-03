(defproject subscribe "0.1.0-SNAPSHOT"
  :description "FIXME: write description"
  :url "http://example.com/FIXME"
  :license {:name "Eclipse Public License"
            :url "http://www.eclipse.org/legal/epl-v10.html"}
  :dependencies [[org.clojure/clojure "1.8.0"]
                 [org.glassfish.jersey.media/jersey-media-sse "2.26"]
                 [cheshire "5.8.0"]
                 [org.glassfish.jersey.inject/jersey-hk2 "2.26"]]
  :main ^:skip-aot subscribe.core
  :target-path "target/%s"
  :profiles {:uberjar {:aot :all}})
