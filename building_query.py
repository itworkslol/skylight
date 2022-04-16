#!python3

# Refs:
# https://overpass-api.de/query_form.html
# https://wiki.openstreetmap.org/wiki/Overpass_API

import requests
import sys

sydney_bbox = '''-33.940, 151.170, -33.840, 151.270'''
#sydney_bbox = '''-33.880, 151.200, -33.875, 151.205'''

query = f'''
[out:json][timeout:60];
(
  way["building"]({sydney_bbox});
  relation["building"]({sydney_bbox});
);
out body;
>;
out skel qt;
'''

r = requests.get('https://overpass-api.de/api/interpreter', {'data': query})

if not r.ok:
  print('Overpass API error. Full response below:\n', file=sys.stderr)
  print(r.content.decode('utf-8'), file=sys.stderr)
  sys.exit(1)

sys.stdout.buffer.write(r.content)
