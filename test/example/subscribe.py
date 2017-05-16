import requests, sseclient, os, sys, json
params = {
    'authz_token': os.environ['CENTRO_TOKEN'],
    'topic': sys.argv[1]
}
response = requests.get('http://localhost:8802/centro/v1/subscribe',
                        params=params, stream=True)
response.raise_for_status()
client = sseclient.SSEClient(response)
for event in client.events():
    if (event.event == 'start'):
        print('topic:', json.loads(event.data)['topic'])
    elif (event.event == 'data'):
        sys.stdout.write(json.loads(event.data)['data'])
        sys.stdout.flush()
