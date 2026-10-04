"""
Build the bundled offline soil grid for the local farm area.

Fetches SoilGrids (ISRIC) rasters for a small box around a centre point — one
WCS request per property, ~250 m cells, top 0–5 cm — and writes a compact JSON
grid the app reads with no network:

    assets/soil/local-grid.json

Only the local area is stored (default ±2.2 km ≈ 18×17 cells, a few KB), so the
app ships real soil data for the demo farm without carrying a global dataset.

Usage (needs internet once; CPU only):
    pip install numpy tifffile imagecodecs
    python scripts/soil/build_local_grid.py                       # Kiambu demo farm
    python scripts/soil/build_local_grid.py --lat -0.42 --lng 36.95 --name "Nyeri" --radius-km 3

Units stored (SoilGrids mapped units, integers):
    phh2o    pH × 10           → pH = value / 10
    nitrogen cg/kg             → g/kg = value / 100
    soc      dg/kg             → g/kg = value / 10
    clay     g/kg              → %    = value / 10
Missing cells (water, urban mask) are null.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "soil" / "local-grid.json"

# Kiambu, Central Kenya — the agriOS demo farm (keep in sync with DEMO_FARM in lib/config.ts).
DEFAULT_CENTER = (-1.1714, 36.8356)
PROPERTIES = ["phh2o", "nitrogen", "soc", "clay"]
WCS = "https://maps.isric.org/mapserv"
EPSG4326 = "http://www.opengis.net/def/crs/EPSG/0/4326"


def fetch_raster(prop: str, west: float, south: float, east: float, north: float):
    import numpy as np
    import tifffile

    query = [
        ("map", f"/map/{prop}.map"),
        ("SERVICE", "WCS"),
        ("VERSION", "2.0.1"),
        ("REQUEST", "GetCoverage"),
        ("COVERAGEID", f"{prop}_0-5cm_mean"),
        ("FORMAT", "GEOTIFF_INT16"),
        ("SUBSET", f"long({west},{east})"),
        ("SUBSET", f"lat({south},{north})"),
        ("SUBSETTINGCRS", EPSG4326),
        ("OUTPUTCRS", EPSG4326),
    ]
    url = f"{WCS}?{urllib.parse.urlencode(query)}"
    with urllib.request.urlopen(url, timeout=90) as res:
        data = res.read()
    with tifffile.TiffFile(io.BytesIO(data)) as tif:
        page = tif.pages[0]
        arr = page.asarray().astype("int32")
        scale = page.tags["ModelPixelScaleTag"].value  # (dx, dy, dz)
        tie = page.tags["ModelTiepointTag"].value      # (i, j, k, x, y, z)
        nodata_tag = page.tags.get("GDAL_NODATA")
        nodata = int(float(nodata_tag.value)) if nodata_tag else -32768
    # SoilGrids masks built-up areas and water as 0 (no soil property is ever 0 here).
    grid = np.where((arr == nodata) | (arr <= 0), -1, arr)
    return grid, {"west": tie[3], "north": tie[4], "dx": scale[0], "dy": scale[1]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--lat", type=float, default=DEFAULT_CENTER[0])
    parser.add_argument("--lng", type=float, default=DEFAULT_CENTER[1])
    parser.add_argument("--radius-km", type=float, default=2.2)
    parser.add_argument("--name", default="Kiambu demo farm")
    args = parser.parse_args()

    dlat = args.radius_km / 111.32
    dlng = args.radius_km / (111.32 * math.cos(math.radians(args.lat)))
    west, east = args.lng - dlng, args.lng + dlng
    south, north = args.lat - dlat, args.lat + dlat

    layers, geo, shape = {}, None, None
    for prop in PROPERTIES:
        grid, g = fetch_raster(prop, west, south, east, north)
        if shape is None:
            shape, geo = grid.shape, g
        elif grid.shape != shape:
            raise SystemExit(f"{prop}: grid shape {grid.shape} differs from {shape}")
        layers[prop] = [[None if v < 0 else int(v) for v in row] for row in grid.tolist()]
        valid = [v for row in layers[prop] for v in row if v is not None]
        print(f"  {prop:9s} {shape[1]}×{shape[0]} cells, range {min(valid)}–{max(valid)}")
        time.sleep(1)  # be gentle with ISRIC's free service

    rows, cols = shape
    out = {
        "_note": "Offline SoilGrids extract for the local farm area. Built by scripts/soil/build_local_grid.py.",
        "name": args.name,
        "source": "SoilGrids 2.0 (ISRIC), 0-5 cm mean, ~250 m cells, CC-BY 4.0",
        "generatedAt": time.strftime("%Y-%m-%d"),
        "center": {"lat": args.lat, "lng": args.lng},
        # Grid origin is the north-west corner of cell [0][0]; rows go south, cols go east.
        "west": geo["west"],
        "north": geo["north"],
        "cellLng": geo["dx"],
        "cellLat": geo["dy"],
        "rows": rows,
        "cols": cols,
        "units": {"phh2o": "pH*10", "nitrogen": "cg/kg", "soc": "dg/kg", "clay": "g/kg"},
        "layers": layers,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024 or 1} KB, {rows}×{cols} cells)")


if __name__ == "__main__":
    main()
