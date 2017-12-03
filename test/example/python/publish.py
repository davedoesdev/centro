import requests, os, sys
params = {
    'authz_token': os.environ['CENTRO_TOKEN'],
    'topic': sys.argv[1]
}
requests.post('http://localhost:8802/centro/v2/publish',
              params=params,
              data=sys.stdin.buffer).raise_for_status()
