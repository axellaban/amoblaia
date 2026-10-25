# Recorta las capturas de página completa a lo que usa el video y las pasa a WebP.
# Uso: python3 capture/optimize.py public/<proyecto> [alto_máximo_css]
import json, os, sys
from PIL import Image

d = sys.argv[1]
max_h = int(sys.argv[2]) if len(sys.argv) > 2 else 2400
path = os.path.join(d, "shots.json")
data = json.load(open(path))
for sid, s in data["shots"].items():
    src = os.path.join(d, s["src"])
    if not os.path.exists(src):
        continue
    im = Image.open(src).convert("RGB")
    scale = im.width / s["w"]
    if s["h"] > max_h:
        im = im.crop((0, 0, im.width, int(max_h * scale)))
        s["h"] = max_h
    out = os.path.splitext(s["src"])[0] + ".webp"
    im.save(os.path.join(d, out), "WEBP", quality=90, method=6)
    if out != s["src"]:
        os.remove(src)
    s["src"] = out
    print(f"{sid}: {im.width}x{im.height} → {os.path.getsize(os.path.join(d, out)) // 1024} KB")
json.dump(data, open(path, "w"), indent=2, ensure_ascii=False)
