#!/bin/bash
( while true; do echo keep alive!; sleep 60; done ) &

set -e
set -x

node_ver=$(node -p 'process.versions.node.split(".")[0]')
check_ver=6

if [ $node_ver = $check_ver ]; then
  ./node_modules/.bin/grunt check_dist
fi

if ! npm run coverage >& "$CIRCLE_ARTIFACTS/test.log"; then
  tail -n 1000 "$CIRCLE_ARTIFACTS/test.log"
  exit 1
fi
tail -n 100 "$CIRCLE_ARTIFACTS/test.log"

if [ $node_ver = $check_ver ]; then
  ./node_modules/.bin/grunt coveralls
fi