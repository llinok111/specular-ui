"""Build the release ZIP: source, docs, demo, dist. No node_modules, no git."""
import os
import pathlib
import zipfile

root = pathlib.Path(".")
skip = {"node_modules", ".git", "shots", "deliver", ".angular", ".github"}
files = []
for p in root.rglob("*"):
    if p.is_dir():
        continue
    if set(p.parts) & skip:
        continue
    if p.name == "package-lock.json":
        continue
    files.append(p)

out_dir = pathlib.Path("../deliver")
out_dir.mkdir(parents=True, exist_ok=True)
out = out_dir / "specular-ui-v0.1.0.zip"

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in sorted(files):
        arc = "specular-ui/" + str(f).replace(os.sep, "/")
        z.write(f, arc)

print("files:", len(files))
print("size:", round(os.path.getsize(out) / 1024, 1), "KB")
