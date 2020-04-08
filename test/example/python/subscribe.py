import requests, sseclient, os, sys, json
params = {
    'authz_token': os.environ['CENTRO_TOKEN'],
    'topic': sys.argv[1:]
}
response = requests.get('http://localhost:8802/centro/v2/subscribe', # 1
                        params=params, stream=True)
response.raise_for_status()
client = sseclient.SSEClient(response) # 2
for event in client.events():
    if (event.event == 'start'):
        data = json.loads(event.data)
        print('id:', data['id'], 'topic:', data['topic']) # 3
    elif (event.event == 'data'):
        sys.stdout.buffer.write(json.loads(event.data)['data'].encode('latin1')) # 4 5
        sys.stdout.flush()
