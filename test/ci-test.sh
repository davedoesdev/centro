#!/bin/bash
#( while true; do echo keep alive!; sleep 60; done ) &

set -e
set -x

node_ver=$(node -p 'process.versions.node.split(".")[0]')

if [ $node_ver = $CHECK_VER ]; then
  ./node_modules/.bin/grunt check_dist
fi

# CircleCI runs on aufs which has max file name length 242
export SPLIT_TOPIC_AT=150

npm explore qlobber-pg -- npm run migrate up

#if ! npm run coverage >& "$CIRCLE_ARTIFACTS/test.log"; then
#  tail -n 1000 "$CIRCLE_ARTIFACTS/test.log"
#  exit 1
#fi
#tail -n 100 "$CIRCLE_ARTIFACTS/test.log"
if [ $node_ver = $CHECK_VER ]; then
  npm run coverage
else
  npm test
fi

if [ $node_ver = $CHECK_VER ]; then
  ./node_modules/.bin/grunt coveralls
fi
