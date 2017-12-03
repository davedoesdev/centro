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
      (.write System/out (.getBytes (:data data) "ISO-8859-1"))
      (flush))))

(defn -main
  "Subscribe to messages from example Centro server"
  [& topics]
  (let [token (System/getenv "CENTRO_TOKEN")
        builder (.register (ClientBuilder/newBuilder) SseFeature)
        client (.build builder)
        target (-> (.target client "http://localhost:8802/centro/v2/subscribe")
                   (.queryParam "authz_token" (into-array Object [token]))
                   (.queryParam "topic" (into-array Object topics)))
        event-source (.build (EventSource/target target))]
    (.register event-source (OnStart.) "start" (into-array String []))
    (.register event-source (OnData.) "data" (into-array String []))
    (.open event-source)
    (println "READY.")
    (loop []
      (Thread/sleep 1000)
      (recur))))
