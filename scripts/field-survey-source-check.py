#!/usr/bin/env python3
"""Bounded IGAC check at the requested sector; saves schema/counts, not properties/geometry.

Three requests, max 25 seconds and 256 KiB each. A timeout is not zero coverage.
No Google imagery/API, credentials, individual cadastral IDs or owner data.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import json
import urllib.parse
import urllib.request

BASE = 'https://mapas.igac.gov.co/server/rest/services/Dato_Fundamental_Catastro/MapServer/2'
REGISTRY = 'https://mapas2.igac.gov.co/server/rest/services/carto/productoscartograficosvigentes/MapServer/0/query?'
QUERY = {'f': 'json', 'geometry': '-75.2789,2.9370,-75.2768,2.9391', 'geometryType': 'esriGeometryEnvelope', 'inSR': '4326', 'spatialRel': 'esriSpatialRelIntersects', 'returnCountOnly': 'true'}
CHECKS = [
    ('construction-schema', BASE + '?f=json'),
    ('requested-sector-count', BASE + '/query?' + urllib.parse.urlencode(QUERY)),
    ('neiva-ortho-index', REGISTRY + urllib.parse.urlencode({'f': 'json', 'objectIds': '7098', 'returnGeometry': 'false', 'outFields': 'FID,DIVIPOLA,Producto,Fech_Insu,Año_Insum,Tipo_PC,Escala_Ref,R_Espacial,Area,url_Public'})),
]


def inspect(item):
    name, url = item
    result = {'id': name, 'url': url, 'checkedAt': datetime.now(timezone.utc).isoformat()}
    try:
        with urllib.request.urlopen(url, timeout=25) as response:
            result['httpStatus'] = response.status
            body = response.read(262145)
        if len(body) > 262144:
            raise ValueError('Metadata response exceeds the bounded size')
        data = json.loads(body)
        if 'error' in data:
            result['serviceError'] = data['error']
        elif name == 'construction-schema':
            result.update({'fields': [f['name'] for f in data.get('fields', [])], 'hasZ': data.get('hasZ'), 'geometryType': data.get('geometryType'), 'sourceSpatialReference': data.get('sourceSpatialReference'), 'copyrightText': data.get('copyrightText')})
        elif name == 'requested-sector-count':
            result['count'] = data.get('count')
            result['coverageConfirmed'] = isinstance(data.get('count'), int) and data['count'] > 0
        else:
            result['products'] = [f['attributes'] for f in data.get('features', [])]
    except Exception as error:
        result['error'] = str(error)
    return result


if __name__ == '__main__':
    with ThreadPoolExecutor(max_workers=3) as executor:
        checks = list(executor.map(inspect, CHECKS))
    result = {'schemaVersion': 1, 'requestedSector': {'longitude': -75.2778407, 'latitude': 2.9380357, 'origin': 'User-provided URL, not a surveyed ground control point'}, 'checks': checks, 'dataPolicy': 'Schema and aggregate counts only; no individual cadastral properties or geometries copied.'}
    target = Path(__file__).resolve().parents[1] / 'data/field-survey-source-checks.json'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(checks, ensure_ascii=False))
