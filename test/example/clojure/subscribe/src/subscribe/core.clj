(ns subscribe.core
  (:gen-class)
  (:require [cheshire.core :as json])
  (:import [javax.ws.rs.client ClientBuilder]
           [org.glassfish.jersey.media.sse SseFeature EventSource EventListener]))

(deftype OnStart [] EventListener
  (onEvent [_ e]
    (let [data (json/decode (.readData e) true)]
      (println "id:" (:id data) "topic:" (:topic data)))))

(deftype OnData [] EventListener
  (onEvent [_ e]
    (let [data (json/decode (.readData e) true)]
      (print (:data data))
      (flush))))

(defn -main
  "Subscribe to messages from example Centro server"
  [topic]
  (let [builder (ClientBuilder/newBuilder)
        registered-builder (.register builder SseFeature)
        client (.build registered-builder)
        target (.queryParam (.queryParam 
          (.target client "http://localhost:8802/centro/v1/subscribe")
          "authz_token" (into-array Object [(System/getenv "CENTRO_TOKEN")]))
          "topic" (into-array Object [topic]))
        event-source (.build (EventSource/target target))]
    (.register event-source (OnStart.) "start" (into-array String []))
    (.register event-source (OnData.) "data" (into-array String[]))
    (.open event-source)
    (println "READY.")
    (loop []
      (Thread/sleep 1000)
      (recur))))
