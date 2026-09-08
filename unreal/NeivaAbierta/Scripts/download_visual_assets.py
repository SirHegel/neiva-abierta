"""Recover the pinned CC0 originals; download only, never start Unreal."""
import argparse
import hashlib
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request

SCRIPTS = Path(__file__).resolve().parent
MANIFEST = SCRIPTS.parent / "SourceArt/visual/manifest.json"
DEFAULT_DESTINATION = SCRIPTS.parents[2] / "artifacts/visual-upgrade/assets"
USER_AGENT = "NeivaAbierta/0.2 visual-art-import (github.com/SirHegel/neiva-abierta)"


def verified(path, entry):
    if not path.is_file() or path.stat().st_size != entry["bytes"]:
        return False
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest() == entry["sha256"]


def download(path, entry, limit):
    if verified(path, entry):
        return
    if path.exists():
        raise ValueError(f"Existing file has another hash; preserve/review it before retry: {path}")
    partial = path.with_suffix(path.suffix + ".part")
    path.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(3):
        if verified(partial, entry):
            partial.replace(path)
            return
        offset = partial.stat().st_size if partial.exists() else 0
        if offset >= entry["bytes"]:
            raise ValueError(f"Invalid complete partial file; review {partial}")
        headers = {"User-Agent": USER_AGENT, "Accept-Encoding": "identity"}
        if offset:
            headers["Range"] = f"bytes={offset}-"
        try:
            with urllib.request.urlopen(urllib.request.Request(entry["url"], headers=headers), timeout=60) as response:
                if urllib.parse.urlparse(response.url).hostname != "dl.polyhaven.org":
                    raise ValueError("Unexpected download redirect")
                if offset and (response.status != 206 or not response.headers.get("Content-Range", "").startswith(f"bytes {offset}-")):
                    raise ValueError("Server did not honor the requested resume range")
                started, received = time.monotonic(), 0
                with partial.open("ab" if offset else "wb") as output:
                    while chunk := response.read(1024 * 1024):
                        if offset + received + len(chunk) > entry["bytes"]:
                            raise ValueError("Response exceeds pinned file size")
                        output.write(chunk)
                        received += len(chunk)
                        delay = received / limit - (time.monotonic() - started)
                        if delay > 0:
                            time.sleep(delay)
            if not verified(partial, entry):
                raise ValueError("Download size/SHA256 differs from the pinned source")
            partial.replace(path)
            return
        except (OSError, ValueError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def run(destination, verify_only=False, limit_mib=12):
    if not 1 <= limit_mib <= 24:
        raise ValueError("Transfer limit must be between 1 and 24 MiB/s")
    document = json.loads(MANIFEST.read_text())
    total = 0
    for asset in document["assets"]:
        folder = (destination / asset["assetId"]).resolve()
        if folder.parent != destination.resolve() or asset["license"] != "CC0-1.0":
            raise ValueError("Unexpected asset identity/license")
        for entry in asset["files"]:
            path = (folder / entry["path"]).resolve()
            url = urllib.parse.urlparse(entry["url"])
            if not path.is_relative_to(folder) or url.scheme != "https" or url.hostname != "dl.polyhaven.org":
                raise ValueError("Nonlocal path or nonofficial source URL")
            if verify_only:
                if not verified(path, entry):
                    raise ValueError(f"Missing or corrupt file: {path}")
            else:
                download(path, entry, limit_mib * 1024 * 1024)
            total += entry["bytes"]
        if not verify_only:
            (folder / "manifest.json").write_text(json.dumps(asset, indent=2) + "\n")
        print(f"Verified {asset['assetId']}: {len(asset['files'])} pinned files", flush=True)
    print(f"Verified total: {total} bytes; no Unreal import performed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, default=DEFAULT_DESTINATION)
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--limit-mib", type=int, default=12)
    arguments = parser.parse_args()
    run(arguments.destination, arguments.verify_only, arguments.limit_mib)
