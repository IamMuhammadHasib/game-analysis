#!/usr/bin/env sh
set -eu
mkdir -p public/data
curl --location --fail --retry 3 \
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson \
  --output public/data/countries.geojson
printf \"\nWorld country boundaries saved to public/data/countries.geojson\n\"
