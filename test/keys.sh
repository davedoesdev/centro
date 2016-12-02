#!/bin/bash
cd "$(dirname "$0")"
openssl req -new -x509 -nodes -newkey rsa:4096 -keyout ca.key -out ca.pem -days 365 -subj '/CN=centro CA/'
openssl req -new -nodes -newkey rsa:4096 -sha256 -keyout server.key -subj '/CN=localhost/' | openssl x509 -req -extfile <(echo subjectAltName=DNS:localhost) -days 365 -CA ca.pem -CAkey ca.key -CAcreateserial -out server.pem
