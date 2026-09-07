#!/usr/bin/env python3
"""Bounded read-only check of official Neiva/IGAC sources, no account or API key.

Only metadata and property names are saved. Municipal cadastral IDs, owners and
geometries are not copied into the report. Max 512KiB per municipal layer.
Run: python3 scripts/map-research-sources.py
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CHECKS = [
    ('municipal-constructions', 'http://179.1.129.45:3080/layers/U_LC_CONSTRUCCION.js', True),
    ('municipal-construction-units', 'http://179.1.129.45:3080/layers/U_LC_UNIDADCONSTRUCCION.js', True),
    ('igac-urban-constructions-schema', 'https://mapas.igac.gov.co/server/rest/services/Dato_Fundamental_Catastro/MapServer/2?f=pjson', False),
    ('igac-neiva-ortho-index', 'https://mapas2.igac.gov.co/server/rest/services/carto/productoscartograficosvigentes/MapServer/0/query?' + urllib.parse.urlencode({
        'f': 'json', 'objectIds': '7098', 'returnGeometry': 'false', 'outFields': 'FID,DIVIPOLA,Producto,Fech_Insu,Año_Insum,Tipo_PC,Escala_Ref,R_Espacial,Area,url_Public'}), False),
    ('arcgis-public-neiva-3d-search', 'https://www.arcgis.com/sharing/rest/search?' + urllib.parse.urlencode({
        'f': 'json', 'q': 'Neiva AND (type:"Scene Service" OR type:"Web Scene")', 'num': '100'}), False),
]


def inspect(item):
    identifier, url, municipal = item
    result = {'id': identifier, 'url': url, 'checkedAt': datetime.now(timezone.utc).isoformat()}
    try:
        request = urllib.request.Request(url, headers={'Range': 'bytes=0-524287'} if municipal else {})
        with urllib.request.urlopen(request, timeout=35) as response:
            result['httpStatus'] = response.status
            result['headers'] = {k: response.headers[k] for k in ['Content-Type', 'Content-Length', 'Content-Range', 'Last-Modified', 'ETag'] if response.headers.get(k)}
            text = response.read(524288).decode('utf-8')
        if municipal:
            start = re.search(r'"features"\s*:\s*\[', text).end()
            feature, _ = json.JSONDecoder().raw_decode(text[start:].lstrip())
            coordinate = feature['geometry']['coordinates']
            while isinstance(coordinate[0], list):
                coordinate = coordinate[0]
            result.update({'propertyNames': list(feature.get('properties', {})),
                           'geometryType': feature['geometry']['type'], 'coordinateDimension': len(coordinate),
                           'heightOrFloorPropertyObserved': any(re.search(r'height|altura|piso|floor|level', key, re.I) for key in feature.get('properties', {})),
                           'dataCopied': 'Property names and HTTP metadata only; no cadastral ID values or geometries.'})
        else:
            parsed = json.loads(text)
            if identifier.endswith('schema'):
                result.update({'name': parsed.get('name'), 'geometryType': parsed.get('geometryType'),
                               'fields': [{'name': f['name'], 'type': f['type']} for f in parsed.get('fields', [])],
                               'sourceSpatialReference': parsed.get('sourceSpatialReference'),
                               'copyrightText': parsed.get('copyrightText'), 'hasZ': parsed.get('hasZ')})
            elif identifier.endswith('ortho-index'):
                result['products'] = [f['attributes'] for f in parsed.get('features', [])]
            else:
                result['total'] = parsed.get('total')
                result['items'] = [{k: i.get(k) for k in ['id', 'title', 'type', 'url', 'accessInformation', 'licenseInfo']} for i in parsed.get('results', [])]
    except (urllib.error.URLError, TimeoutError, ValueError, AttributeError) as error:
        result['error'] = str(error)
    return result


if __name__ == '__main__':
    with ThreadPoolExecutor(max_workers=5) as executor:
        results = list(executor.map(inspect, CHECKS))
    target = ROOT / 'data/newaudit-source-checks.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({'schemaVersion': 1, 'checks': results}, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps([{'id': r['id'], 'httpStatus': r.get('httpStatus'), 'error': r.get('error')} for r in results]))
