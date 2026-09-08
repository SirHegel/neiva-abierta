#!/usr/bin/env python3
"""Propose, never apply, Google Research Temporal V1 heights for Neiva.

Public GCS only. Six intersecting tiles are discovered from the official regional
manifest, downloaded with two workers and a 2 GB aggregate limit, then sampled
in small footprint windows. No Google Maps imagery, credentials or owner data.
Dependencies: scripts/requirements-building-heights.txt. Run with nice -n 10.
"""
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('OMP_NUM_THREADS', '2')
os.environ.setdefault('GDAL_NUM_THREADS', '2')

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import resource
import urllib.request

import numpy as np
import pyproj
import rasterio
from rasterio.features import geometry_mask
from rasterio.windows import from_bounds, Window
from shapely.geometry import Polygon, box, mapping
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = 'https://storage.googleapis.com/open-buildings-temporal-data/v1/manifests/8f_EPSG_32618_2023_06_30.json'
CATALOG_URL = 'https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_Research_open-buildings-temporal_v1'
MAX_BYTES = 2_000_000_000
MAX_WINDOW_PIXELS = 1_000_000
POLICY = {'presenceThreshold': 0.5, 'minimumValidFraction': 0.5,
          'minimumValidAreaM2': 16, 'minimumProposedHeightM': 2,
          'maximumProposedHeightM': 100, 'aggregate': 'median',
          'note': 'Engineering screening, not calibrated probability or verified accuracy. Correlated 0.5 m pixels do not create independent measurements.'}
APPROVAL_MAX_HEIGHT = 30


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def get_metadata(url):
    with urllib.request.urlopen(url, timeout=45) as response:
        data = response.read(8_000_001)
    if len(data) > 8_000_000:
        raise ValueError('Regional metadata exceeds 8 MB limit')
    return data


def discover(manifest, bbox):
    """Return only tiles intersecting this bounded Neiva region; no bucket scan."""
    south, west, north, east = bbox
    if not (2.8 <= south < north <= 3.1 and -75.4 <= west < east <= -75.1):
        raise ValueError('This importer is bounded to Neiva; not a global downloader')
    found = []
    for tileset in manifest['tilesets']:
        region = transform(pyproj.Transformer.from_crs(4326, tileset['crs'], always_xy=True).transform,
                           box(west, south, east, north))
        for source in tileset['sources']:
            a, size = source['affineTransform'], source['dimensions']
            extent = box(a['translateX'], a['translateY'] + size['height'] * a['scaleY'],
                         a['translateX'] + size['width'] * a['scaleX'], a['translateY'])
            if extent.intersection(region).area > 0:
                url = (manifest['uriPrefix'] + source['uris'][0]).replace('gs://', 'https://storage.googleapis.com/')
                if not url.startswith('https://storage.googleapis.com/open-buildings-temporal-data/v1/geotiffs/'):
                    raise ValueError('Unexpected tile source')
                found.append({'url': url, 'crs': tileset['crs']})
    return sorted(found, key=lambda item: item['url'])


def download_tiles(tiles, cache):
    cache.mkdir(parents=True, exist_ok=True)
    for tile in tiles:
        with urllib.request.urlopen(urllib.request.Request(tile['url'], method='HEAD'), timeout=30) as response:
            tile['bytes'] = int(response.headers['Content-Length'])
            tile['etag'] = response.headers.get('ETag')
    if sum(tile['bytes'] for tile in tiles) > MAX_BYTES:
        raise ValueError('Selected full tiles exceed the 2 GB download limit')

    def fetch(tile):
        target = cache / tile['url'].rsplit('/', 1)[1]
        if not target.exists() or target.stat().st_size != tile['bytes']:
            partial = target.with_suffix('.partial')
            count = 0
            try:
                with urllib.request.urlopen(tile['url'], timeout=90) as response, partial.open('wb') as output:
                    for chunk in iter(lambda: response.read(1024 * 1024), b''):
                        count += len(chunk)
                        if count > tile['bytes']:
                            raise ValueError('Download larger than declared size')
                        output.write(chunk)
                if count != tile['bytes']:
                    raise ValueError('Truncated tile')
                partial.replace(target)
            finally:
                partial.unlink(missing_ok=True)
        tile['sha256'] = sha(target)
        tile['cachePath'] = str(target.relative_to(ROOT)) if target.is_relative_to(ROOT) else target.name
        return target

    with ThreadPoolExecutor(max_workers=2) as pool:
        return list(pool.map(fetch, tiles))


def summarize_pixels(heights, presence, interior, policy=POLICY, pixel_area=0.25):
    """Keep nodata/low presence separate from true pixels; no zero fill."""
    total = int(np.count_nonzero(interior))
    observed = interior & np.isfinite(heights) & np.isfinite(presence) & (presence >= 0) & (presence <= 1)
    valid = observed & (presence >= policy['presenceThreshold']) & (heights > 0) & (heights <= 100)
    count = int(np.count_nonzero(valid))
    result = {'interiorPixels': total, 'validPixels': count,
              'validFraction': round(count / total, 6) if total else 0,
              'validAreaM2': round(count * pixel_area, 3),
              'presenceMedian': round(float(np.median(presence[observed])), 5) if observed.any() else None}
    if count:
        values = heights[valid].astype(np.float64)
        result.update({key: round(float(value), 3) for key, value in zip(
            ['heightMedianM', 'heightP10M', 'heightP90M', 'heightMinM', 'heightMaxM'],
            [np.median(values), np.percentile(values, 10), np.percentile(values, 90), values.min(), values.max()])})
    if not total:
        result['rejection'] = 'no_pixel_centers_inside_footprint'
    elif not count:
        result['rejection'] = 'no_positive_height_with_presence_mask'
    elif result['validFraction'] < policy['minimumValidFraction']:
        result['rejection'] = 'insufficient_presence_coverage'
    elif result['validAreaM2'] < policy['minimumValidAreaM2']:
        result['rejection'] = 'less_than_one_effective_4m_cell_area'
    elif not policy['minimumProposedHeightM'] <= result['heightMedianM'] <= policy['maximumProposedHeightM']:
        result['rejection'] = 'outside_proposal_height_range'
    return result


def sample_polygon(dataset, polygon):
    if not polygon.is_valid or polygon.is_empty:
        return {'rejection': 'invalid_source_footprint'}
    if not box(*dataset.bounds).intersects(polygon):
        return None
    extent = from_bounds(*polygon.bounds, dataset.transform)
    left, top = math.floor(extent.col_off), math.floor(extent.row_off)
    right, bottom = math.ceil(extent.col_off + extent.width), math.ceil(extent.row_off + extent.height)
    window = Window(left, top, right - left, bottom - top)
    if window.width * window.height > MAX_WINDOW_PIXELS:
        return {'rejection': 'footprint_window_exceeds_memory_bound'}
    if not window.width or not window.height:
        return {'rejection': 'empty_footprint_window'}
    # Boundless preserves the full footprint denominator at a tile edge. No
    # interpolation/upsampling: source 0.5 m values remain correlated estimates.
    pixels = dataset.read([2, 3], window=window, boundless=True, fill_value=-99)
    mask = geometry_mask([mapping(polygon)], out_shape=pixels.shape[1:],
                         transform=dataset.window_transform(window), invert=True, all_touched=False)
    return summarize_pixels(pixels[0], pixels[1], mask, pixel_area=abs(dataset.transform.a * dataset.transform.e))


def height_proposal(building, sample, basis, protected_ids):
    """Public-source numbers never acquire confirmed status by this pipeline."""
    output = {'id': building['id'], 'baselineHeightM': building['height'],
              'baselineStatus': 'source_declared' if basis == 'source-height-tag-unverified' else 'estimated',
              'baselineBasis': basis, 'status': 'estimated', 'method': 'ml_raster_footprint_median',
              'sourceId': 'google-research-open-buildings-temporal-v1-2023', 'sample': sample}
    reason = sample.get('rejection')
    if building['id'] in protected_ids:
        reason = 'protected_landmark_roof_or_survey_exclusion'
    elif basis in ['source-height-tag-unverified', 'source-levels-times-3.2-estimate']:
        reason = 'preserve_existing_source_height_or_levels_for_review'
    if reason:
        output['applied'] = False
        output['proposalEligible'] = False
        output['reason'] = reason
    else:
        output.update({'height': sample['heightMedianM'], 'heightEstimated': True,
                       'proposalEligible': True, 'applied': False})
    return output


def publish_approved(report, receipt, target):
    """Compact the approved default replacements; retain all raw samples locally."""
    if report['baseSha256'] != receipt['base']['sha256'] or report['sourceId'] != receipt['source']['id']:
        raise ValueError('Sample report and source receipt differ')
    approved, manual = [], []
    allowed_bases = {'game-default-5.8m-no-source-height', 'game-building-subtype-default-estimate'}
    for record in report['buildingOverrides']:
        if not record['proposalEligible']:
            continue
        if record['status'] != 'estimated' or record['baselineBasis'] not in allowed_bases:
            raise ValueError('Only unmeasured game defaults can enter the approval set')
        if record['height'] > APPROVAL_MAX_HEIGHT:
            manual.append({'id': record['id'], 'sampleHeightM': record['height'], 'reason': 'over_30m_requires_independent_review'})
            continue
        sample = record['sample']
        approved.append({'id': record['id'], 'height': record['height'], 'priorHeightM': record['baselineHeightM'],
                         'priorBasis': record['baselineBasis'],
                         'sample': {k: sample[k] for k in ['tile', 'validFraction', 'validAreaM2', 'presenceMedian', 'heightP10M', 'heightP90M']}})
    data = {'schemaVersion': 1, 'status': 'approved-for-staging-not-yet-applied', 'baseSha256': report['baseSha256'],
            'origin': [-75.2809, 2.9252], 'heightStatus': 'estimated', 'physicallyConfirmed': False,
            'source': receipt['source'], 'databaseLicense': 'ODbL-1.0',
            'attribution': '© OpenStreetMap contributors; Overture Maps Foundation; Microsoft; Google Open Buildings; Google Research Open Buildings 2.5D Temporal V1, modified Copernicus Sentinel-2 data.',
            'approval': {'scope': 'Replace game-default heights only; preserve source height/levels, four landmarks, 22 open roofs and two park exclusions.',
                         'maximumHeightM': APPROVAL_MAX_HEIGHT, 'overLimitAction': 'manual-review-no-clamp',
                         'sampleEligible': len(approved) + len(manual), 'approvedCount': len(approved), 'appliedCount': 0,
                         'policy': report['policy'], 'checkedAt': report['checkedAt']},
            'buildingOverrides': approved, 'manualReview': manual}
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n')
    receipt['approvedOutput'] = {'path': str(target.resolve().relative_to(ROOT)) if target.resolve().is_relative_to(ROOT) else target.name,
                                 'sha256': sha(target), 'approvedCount': len(approved),
                                 'manualReviewCount': len(manual), 'appliedCount': 0}
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=ROOT / 'artifacts/reconstruction-03/heights-cache')
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/reconstruction-03/heights-full-samples.json')
    parser.add_argument('--manifest-output', type=Path, default=ROOT / 'data/heights-google-temporal-manifest.json')
    parser.add_argument('--approved-output', type=Path, default=ROOT / 'data/heights-google-temporal-approved.json')
    args = parser.parse_args()
    inputs = {ROOT / path for path in ['public/data/neiva.json', 'data/newaudit-geometry.json',
                                       'public/data/neiva-survey.json', 'public/data/neiva-corrections.json']}
    outputs = [args.output.resolve(), args.manifest_output.resolve(), args.approved_output.resolve()]
    if any(path in inputs for path in outputs) or len(set(outputs)) != len(outputs):
        raise ValueError('Output must be separate from source data and manifest')
    try:
        os.nice(max(0, 10 - os.nice(0)))
    except OSError:
        pass
    base_path = ROOT / 'public/data/neiva.json'
    base_hash = sha(base_path)
    city = json.loads(base_path.read_text())
    audit = json.loads((ROOT / 'data/newaudit-geometry.json').read_text())
    if audit['baseSha256'] != base_hash:
        raise ValueError('Height provenance audit does not match this map; regenerate audit first')
    basis = {b['id']: b['basis'] for b in audit['heightProvenance']}
    survey = json.loads((ROOT / 'public/data/neiva-survey.json').read_text())
    corrections = json.loads((ROOT / 'public/data/neiva-corrections.json').read_text())
    protected = {b['id'] for b in survey['buildingOverrides'] + survey['excludedBuildings']}
    protected.add('way/313286677')  # Existing interpreted cathedral model.
    protected.update(b['id'] for b in corrections['buildingCorrections'])
    manifest_bytes = get_metadata(SOURCE_URL)
    source = json.loads(manifest_bytes)
    if [b['id'] for b in source['bands']] != ['building_fractional_count', 'building_height', 'building_presence']:
        raise ValueError('Source band order changed')
    tiles = discover(source, city['meta']['bbox'])
    paths = download_tiles(tiles, args.cache.resolve())
    to_utm = pyproj.Transformer.from_crs(4326, 32618, always_xy=True)
    lon0, lat0 = city['meta']['origin']
    degree = math.pi / 180
    def ring(points):
        return [to_utm.transform(lon0 + x / (6378137 * degree * math.cos(lat0 * degree)),
                                 lat0 - z / (6378137 * degree)) for x, z in points]
    polygons = [Polygon(ring(b['points']), [ring(h) for h in b.get('holes', [])]) for b in city['buildings']]
    spatial_order = sorted(range(len(polygons)), key=lambda i: (int(polygons[i].centroid.y // 256),
                                                               int(polygons[i].centroid.x // 256)))
    best = [None] * len(polygons)
    with rasterio.Env(GDAL_CACHEMAX=128 * 1024 * 1024, GDAL_NUM_THREADS='2'):
        for index, path in enumerate(paths):
            with rasterio.open(path) as dataset:
                if dataset.count != 3 or dataset.crs.to_epsg() != 32618 or dataset.res != (0.5, 0.5):
                    raise ValueError('Unexpected source raster grid')
                tiles[index]['raster'] = {'crs': str(dataset.crs), 'shape': [dataset.height, dataset.width],
                                          'bands': dataset.count, 'pixelSizeM': list(dataset.res), 'nodata': dataset.nodata}
                for i in spatial_order:
                    polygon = polygons[i]
                    sample = sample_polygon(dataset, polygon)
                    if sample is None:
                        continue
                    # Adjacent S2 rasters overlap and may contain nodata outside
                    # their cell. Keep one tile with most valid footprint pixels;
                    # never count overlapping observations as independent data.
                    if best[i] is None or sample.get('validPixels', 0) > best[i].get('validPixels', 0):
                        best[i] = dict(sample, tile=index)
            print(json.dumps({'tileDone': index + 1, 'tiles': len(paths), 'footprints': len(polygons)}), flush=True)
    records = [height_proposal(b, sample or {'rejection': 'no_source_tile_coverage'}, basis[b['id']], protected)
               for b, sample in zip(city['buildings'], best)]
    from collections import Counter
    heights = [b['height'] for b in records if b['proposalEligible']]
    stats = {'buildings': len(records), 'eligible': len(heights), 'applied': 0,
             'confirmedPhysicalHeights': 0, 'rejections': dict(Counter(b['reason'] for b in records if not b['proposalEligible'])),
             'baselineStatuses': dict(Counter(b['baselineStatus'] for b in records)),
             'eligibleHeightM': {key: round(float(value), 3) for key, value in zip(
                 ['min', 'p10', 'median', 'p90', 'max'], np.percentile(heights, [0, 10, 50, 90, 100]))} if heights else None,
             'peakRssBytes': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024}
    now = datetime.now(timezone.utc).isoformat()
    output = {'schemaVersion': 1, 'checkedAt': now, 'baseSha256': base_hash,
              'sourceId': 'google-research-open-buildings-temporal-v1-2023', 'status': 'proposal-not-applied',
              'heightStatus': 'estimated', 'units': 'metres_above_local_ground', 'policy': POLICY,
              'summary': stats, 'buildingOverrides': records}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n')
    receipt = {'schemaVersion': 1, 'checkedAt': now, 'source': {
        'id': output['sourceId'], 'name': 'Google Research Open Buildings 2.5D Temporal V1',
        'catalogUrl': CATALOG_URL, 'manifestUrl': SOURCE_URL,
        'manifestSha256': hashlib.sha256(manifest_bytes).hexdigest(),
        'license': 'CC-BY-4.0', 'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/',
        'attribution': 'Google Research Open Buildings 2.5D Temporal V1; contains modified Copernicus Sentinel-2 data.',
        'properties': source['properties'], 'inferenceAt': source['startTime'],
        'sourcePixelSizeM': 0.5, 'effectiveResolutionM': 4,
        'photogrammetricMesh': False, 'facadeImages': False, 'physicallyMeasuredHeights': False,
        'limitation': 'ML estimates for 2023; not Google Maps, 2026 survey, facade geometry or certified metric accuracy.'},
        'base': {'path': 'public/data/neiva.json', 'sha256': base_hash, 'bboxSouthWestNorthEast': city['meta']['bbox']},
        'inputs': [{'path': str(p.relative_to(ROOT)), 'sha256': sha(p)} for p in [
            ROOT / 'data/newaudit-geometry.json', ROOT / 'public/data/neiva-survey.json', ROOT / 'public/data/neiva-corrections.json']],
        'tiles': tiles, 'downloadBytes': sum(tile['bytes'] for tile in tiles),
        'limits': {'maxDownloadBytes': MAX_BYTES, 'downloadWorkers': 2, 'gdalWorkers': 2,
                   'gdalCacheBytes': 128 * 1024 * 1024, 'maxFootprintWindowPixels': MAX_WINDOW_PIXELS, 'nice': os.nice(0)},
        'output': {'path': str(args.output.resolve().relative_to(ROOT)) if args.output.resolve().is_relative_to(ROOT) else args.output.name,
                   'sha256': sha(args.output)},
        'summary': stats}
    publish_approved(output, receipt, args.approved_output)
    args.manifest_output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    print(json.dumps(stats, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
