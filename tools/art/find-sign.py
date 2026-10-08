"""Find the blank cream sign: the largest flat, light, warm region. Prints its box in image and stage units."""
import sys
import numpy as np
from PIL import Image, ImageFilter
for f in sys.argv[1:]:
    img = Image.open(f).convert("RGB")
    a = np.asarray(img).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    light = (r > 215) & (g > 200) & (b > 165) & (r - b > 8) & (r - b < 70)
    # flat: low local detail
    edges = np.asarray(img.convert("L").filter(ImageFilter.FIND_EDGES)) < 18
    mask = light & edges
    from scipy import ndimage
    labels, n = ndimage.label(ndimage.binary_closing(mask, iterations=3))
    sizes = ndimage.sum(mask, labels, range(1, n + 1))
    edge = set(labels[0]) | set(labels[-1]) | set(labels[:, 0]) | set(labels[:, -1])
    for k in edge:
        if k: sizes[k - 1] = 0
    k = int(np.argmax(sizes)) + 1
    ys, xs = np.where(labels == k)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    s, ox = 470 / 768, (800 - 1344 * 470 / 768) / 2
    cx, cy, w = (x0 + x1) / 2 * s + ox, (y0 + y1) / 2 * s, (x1 - x0) * s
    print(f"{f}: image box {x0},{y0}-{x1},{y1}  stage centre {cx:.0f},{cy:.0f} width {w:.0f} height {(y1-y0)*s:.0f}")
