#!python3

# Refs:
# https://overpass-api.de/query_form.html
# https://wiki.openstreetmap.org/wiki/Overpass_API

import argparse
import requests
import sys

city_bbox = {
  'sydney': '''-33.940, 151.170, -33.840, 151.270''',
  'hongkong': '''22.270, 114.120, 22.32, 114.210''',
}

query_template = '''
[out:json][timeout:60];
(
  way["building"]({bbox});
  relation["building"]({bbox});
);
out body;
>;
out skel qt;
'''

argparser = argparse.ArgumentParser()
argparser.add_argument('--city', help='City name', choices=city_bbox.keys())
argparser.add_argument('--output', help='Output file (default: stdout)', type=argparse.FileType('wb'), default=sys.stdout)

def main():
  args = argparser.parse_args()
  query = query_template.format(bbox=city_bbox[args.city])

  r = requests.get('https://overpass-api.de/api/interpreter', {'data': query})

  if not r.ok:
    print('Overpass API error. Full response below:\n', file=sys.stderr)
    print(r.content.decode('utf-8', errors='ignore'), file=sys.stderr)
    return 1

  print('Downloaded Overpass response, {} kB'.format(len(r.content) // 1000), file=sys.stderr)
  args.output.write(r.content)
  args.output.close()
  return 0

if __name__ == '__main__':
  sys.exit(main())
