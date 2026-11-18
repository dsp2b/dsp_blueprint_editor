"""Minimal deterministic GLB writer. Mesh inputs are Unity-space; the conversion to glTF (X mirror,
reversed winding, flipped v) happens here, in one place, so no caller can forget it."""
import json
import struct

import numpy as np

from . import coords, textures

GENERATOR = "dsp2b tools/extract models"
ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER = 34962, 34963
FLOAT, UNSIGNED_SHORT, UNSIGNED_INT = 5126, 5123, 5125


class GlbBuilder:
    def __init__(self):
        self.bin = bytearray()
        self.g = {"asset": {"version": "2.0", "generator": GENERATOR}, "scene": 0, "scenes": [{"nodes": []}],
                  "nodes": [], "meshes": [], "materials": [], "accessors": [], "bufferViews": [], "buffers": [],
                  "images": [], "textures": [],
                  "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]}
        self._textures = {}

    # -- buffers

    def _view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        bv = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data)}
        if target:
            bv["target"] = target
        self.bin += data
        self.g["bufferViews"].append(bv)
        return len(self.g["bufferViews"]) - 1

    def _accessor(self, arr, ctype, typ, target, minmax=False):
        a = {"bufferView": self._view(arr.tobytes(), target), "componentType": ctype, "count": int(arr.shape[0]), "type": typ}
        if minmax:
            a["min"] = arr.min(axis=0).tolist()
            a["max"] = arr.max(axis=0).tolist()
        self.g["accessors"].append(a)
        return len(self.g["accessors"]) - 1

    # -- content

    def texture(self, key, data, mime):
        if key not in self._textures:
            self.g["images"].append({"bufferView": self._view(data), "mimeType": mime})
            self.g["textures"].append({"sampler": 0, "source": len(self.g["images"]) - 1})
            self._textures[key] = len(self.g["textures"]) - 1
        return self._textures[key]

    def jpeg(self, key, image):
        return self.texture(("jpg", key), textures.jpeg_bytes(image), "image/jpeg")

    def png(self, key, image):
        return self.texture(("png", key), textures.png_bytes(image), "image/png")

    def material(self, m):
        self.g["materials"].append(m)
        return len(self.g["materials"]) - 1

    def vertices(self, pos, nrm=None, uv=None, uv1=None, custom=None):
        """Unity-space vertex streams -> accessor indices keyed by glTF attribute name.
        custom: {"_NAME": float array (N,)} written as scalar custom attributes."""
        attrs = {"POSITION": self._accessor(coords.mirror_x(pos), FLOAT, "VEC3", ARRAY_BUFFER, minmax=True)}
        if nrm is not None:
            attrs["NORMAL"] = self._accessor(coords.mirror_normals(nrm), FLOAT, "VEC3", ARRAY_BUFFER)
        if uv is not None:
            attrs["TEXCOORD_0"] = self._accessor(coords.flip_v(uv), FLOAT, "VEC2", ARRAY_BUFFER)
        if uv1 is not None:
            attrs["TEXCOORD_1"] = self._accessor(coords.flip_v(uv1), FLOAT, "VEC2", ARRAY_BUFFER)
        for name, values in (custom or {}).items():
            attrs[name] = self._accessor(np.asarray(values, "<f4").reshape(-1), FLOAT, "SCALAR", ARRAY_BUFFER)
        return attrs

    def primitive(self, attrs, tris, material):
        """tris: Unity-space triangle indices; returns the glTF primitive."""
        t = coords.reverse_winding(np.asarray(tris, np.int64)).reshape(-1)
        wide = int(t.max()) > 65535 if len(t) else False
        idx = self._accessor(t.astype("<u4" if wide else "<u2"), UNSIGNED_INT if wide else UNSIGNED_SHORT,
                             "SCALAR", ELEMENT_ARRAY_BUFFER)
        return {"attributes": dict(attrs), "indices": idx, "material": material, "mode": 4}

    def mesh(self, name, primitives):
        self.g["meshes"].append({"name": name, "primitives": primitives})
        return len(self.g["meshes"]) - 1

    def node(self, name, mesh=None, translation=None, extras=None):
        n = {"name": name}
        if mesh is not None:
            n["mesh"] = mesh
        if translation is not None and any(translation):
            n["translation"] = coords.mirror_translation(translation)
        if extras:
            n["extras"] = extras
        self.g["nodes"].append(n)
        self.g["scenes"][0]["nodes"].append(len(self.g["nodes"]) - 1)
        return len(self.g["nodes"]) - 1

    def use_extension(self, name):
        used = self.g.setdefault("extensionsUsed", [])
        if name not in used:
            used.append(name)

    def to_bytes(self):
        g = dict(self.g)
        g["buffers"] = [{"byteLength": (len(self.bin) + 3) & ~3}]
        for k in ("images", "textures"):
            if not g[k]:
                del g[k]
        if "textures" not in g:
            del g["samplers"]
        js = json.dumps(g, separators=(",", ":"), allow_nan=False).encode()
        js += b" " * ((4 - len(js) % 4) % 4)
        binc = bytes(self.bin) + b"\0" * ((4 - len(self.bin) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(binc)
        return (struct.pack("<III", 0x46546C67, 2, total) + struct.pack("<II", len(js), 0x4E4F534A) + js
                + struct.pack("<II", len(binc), 0x004E4942) + binc)
