#!/bin/bash
( while true; do echo keep alive!; sleep 60; done ) &
if ! npm run ci-coverage-$(node -p 'process.versions.node.split(".")[0]') >& test.log; then
  tail -n 1000 test.log
  exit 1
fi
tail -n 100 test.log
