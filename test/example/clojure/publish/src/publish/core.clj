(ns publish.core
  (:gen-class)
  (:require [clj-http.client :as client]))

(defn -main
  "Publish message to example Centro server"
  [topic]
  (client/post "http://localhost:8802/centro/v1/publish"
    {:query-params {"authz_token" (System/getenv "CENTRO_TOKEN")
                    "topic" topic}
     :body System/in}))
