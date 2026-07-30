#!/usr/bin/env python3
"""
Deterministic local design heuristics — no AI, no network.

Computes a 0–10 `local_score` from the screenshot plus the DOM node count
captured at crawl time. Stored in its own column next to `ai_score`; the
two are never merged.

Components (weights sum to 10):
  blank      0–4  penalises empty/near-blank pages: share of pixels in the
                  single dominant (quantised) colour. 1.0 dominant → 0 pts.
  color      0–2  colourfulness (Hasler–Süsstrunk metric on rg/yb opponent
                  axes), saturating at 60 — rewards designed palettes over
                  grey error pages.
  structure  0–2  edge density (mean of FIND_EDGES) saturating at 25 —
                  proxies visual structure: cards, borders, typography.
  dom        0–2  DOM node count on a log ramp: <30 nodes → 0 (shell only),
                  ~800 → 2, capped — a real app renders hundreds of nodes.
                  Missing dom_nodes → component prorated out (score rescaled).

All operations are fixed-seed-free and image-order independent, so the same
input always yields the same score. Usable as a module (score_screenshot)
or CLI:  python scripts/local_score.py data/screenshots/42.png [dom_nodes]
"""
import math
import sys
import warnings
from pathlib import Path

from PIL import Image, ImageFilter

# getdata() is deprecated in Pillow 11+ but its replacement doesn't exist in
# older versions; silence until the floor is Pillow 14
warnings.filterwarnings("ignore", category=DeprecationWarning, module=__name__)

ANALYSIS_SIZE = (160, 100)  # fixed downsample — determinism + speed


def _components(img: Image.Image, dom_nodes: int | None) -> dict:
    small = img.convert("RGB").resize(ANALYSIS_SIZE, Image.BILINEAR)
    pixels = list(small.getdata())
    n = len(pixels)

    # blank-page: share of pixels equal to the dominant colour, quantised to
    # 32 levels per channel so near-identical shades count as one colour
    counts: dict = {}
    for r, g, b in pixels:
        key = (r >> 3, g >> 3, b >> 3)
        counts[key] = counts.get(key, 0) + 1
    dominant_share = max(counts.values()) / n

    # colourfulness (Hasler & Süsstrunk 2003)
    rg = [r - g for r, g, _ in pixels]
    yb = [(r + g) / 2 - b for r, g, b in pixels]

    def _std_mean(vals):
        mean = sum(vals) / len(vals)
        var = sum((v - mean) ** 2 for v in vals) / len(vals)
        return math.sqrt(var), mean

    rg_std, rg_mean = _std_mean(rg)
    yb_std, yb_mean = _std_mean(yb)
    colorfulness = math.sqrt(rg_std**2 + yb_std**2) + 0.3 * math.sqrt(
        rg_mean**2 + yb_mean**2
    )

    # structure: edge density
    edges = small.convert("L").filter(ImageFilter.FIND_EDGES)
    edge_mean = sum(edges.getdata()) / n

    return {
        "dominant_share": round(dominant_share, 4),
        "colorfulness": round(colorfulness, 2),
        "edge_mean": round(edge_mean, 2),
        "dom_nodes": dom_nodes,
    }


def score_screenshot(path: str | Path, dom_nodes: int | None = None) -> dict:
    """Returns {"local_score": float 0-10, ...components}. Raises on unreadable image."""
    with Image.open(path) as img:
        c = _components(img, dom_nodes)

    # blank: 0 at fully uniform, full 4 pts when dominant colour <= 55%
    blank_pts = 4.0 * min(1.0, max(0.0, (1.0 - c["dominant_share"]) / 0.45))
    color_pts = 2.0 * min(1.0, c["colorfulness"] / 60.0)
    structure_pts = 2.0 * min(1.0, c["edge_mean"] / 25.0)

    if dom_nodes is None:
        # prorate the missing dom component so old rows aren't penalised
        raw = blank_pts + color_pts + structure_pts
        score = raw * (10.0 / 8.0)
    else:
        dom_pts = 2.0 * min(1.0, max(0.0, math.log10(max(dom_nodes, 1) / 30) / math.log10(800 / 30)))
        score = blank_pts + color_pts + structure_pts + dom_pts
        c["dom_pts"] = round(dom_pts, 2)

    c["blank_pts"] = round(blank_pts, 2)
    c["color_pts"] = round(color_pts, 2)
    c["structure_pts"] = round(structure_pts, 2)
    c["local_score"] = round(min(10.0, max(0.0, score)), 1)
    return c


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: python scripts/local_score.py <screenshot.png> [dom_nodes]")
    dom = int(sys.argv[2]) if len(sys.argv) > 2 else None
    result = score_screenshot(sys.argv[1], dom)
    for k, v in result.items():
        print(f"  {k:<16} {v}")
