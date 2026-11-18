"""Plain-data views of the game assets the GLB builders consume (and, below, the reader that fills them)."""
import posixpath
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

import numpy as np

from ..errors import ExtractError
from . import textures
from .belt import BeltSource
from .meshdata import parse_lod_desc, parse_mesh_data

DATA = "DSPGAME_Data"


class TexRef:
    """A texture that is decoded on first use (already capped to 512 px by the loader)."""

    def __init__(self, key, loader: Callable):
        self.key, self._loader, self._image = key, loader, None

    @classmethod
    def of(cls, image, key=None):
        ref = cls(key if key is not None else id(image), None)
        ref._image = image
        return ref

    @property
    def image(self):
        if self._image is None:
            self._image = self._loader()
        return self._image


@dataclass
class Material:
    name: str
    shader: str
    colors: Dict[str, tuple]
    floats: Dict[str, float]
    textures: Dict[str, TexRef]


@dataclass
class MeshAsset:
    name: str
    mesh: dict          # parse_mesh_data result (Unity space)
    materials: List[Material] = field(default_factory=list)


@dataclass
class BuildingSource:
    prefab: str
    lods: List[MeshAsset]
    distances: List[Optional[float]]


# ------------------------------------------------------------------ reading from the game

BELT_RES = "entities/models/belt/"
INSERTER_RES = "entities/meshdatas/inserter-"
MESH_LIMIT = 512


class GameModels:
    """Fills the plain-data classes above from a UnityReader (tools.extract.unity).

    Reading is staged so that a remote run needs few round trips: `prepare()` batches the byte ranges
    of every object about to be parsed, `load_textures()` batches the Texture2D headers and the
    .resS stream ranges of every texture the export will actually use."""

    def __init__(self, reader, source, log=None):
        self.reader, self.source = reader, source
        self.log = log or (lambda msg: None)
        self._images = {}
        self._shaders = {}
        self._env = reader._load()

    # -- low level

    def _deref(self, ptr_dict_or_obj, assets_file):
        return self.reader._pptr(assets_file, ptr_dict_or_obj["m_FileID"], ptr_dict_or_obj["m_PathID"]).deref()

    def _comps(self, go):
        for c in go.m_Component:
            yield (c.component if hasattr(c, "component") else c).deref()

    def _walk(self, go):
        yield go
        for r in self._comps(go):
            if r.type.name == "Transform":
                for ch in r.read().m_Children:
                    yield from self._walk(ch.deref().read().m_GameObject.deref().read())
                return

    def _resource(self, name, typ):
        for p in self.reader._containers().get(name.lower(), []):
            r = p.deref()
            if r.type.name == typ:
                return r
        raise ExtractError(f"game resource {name} ({typ}) not found")

    def _prefetch(self, readers):
        from .. import unity
        self.reader._prefetch([(r.assets_file.name, r.byte_start, r.byte_start + r.byte_size)
                               for r in readers if r.assets_file.name in unity.SPARSE_FILES])

    # -- buildings

    def _lod_readers(self, prefab_path):
        """-> ([MeshDataAsset reader], [distance]) of the first LODModelDesc in the prefab, or None"""
        for ptr in self.reader._containers().get(prefab_path.lower(), []):
            root = ptr.deref()
            if root.type.name != "GameObject":
                continue
            for go in self._walk(root.read()):
                for r in self._comps(go):
                    if r.type.name == "MonoBehaviour" and self.reader._script_name(r) == "LODModelDesc":
                        ptrs, dist = parse_lod_desc(r.get_raw_data())
                        return [self.reader._pptr(r.assets_file, f, p).deref() for f, p in ptrs], dist
            return None
        raise ExtractError(f"prefab {prefab_path} not found in the game's resource container")

    def prepare(self, prefab_paths):
        """Batch-prefetch everything building(), belt() and sorter() are going to parse."""
        wanted = []
        for path in prefab_paths:
            found = self._lod_readers(path)
            if found:
                wanted += found[0]
        for name in ("belt-seg-0", "belt-head-0", "belt-head-1"):
            wanted.append(self._resource(BELT_RES + name, "Mesh"))
        wanted.append(self._resource(BELT_RES + "belt-head-0", "Material"))
        for tier in (1, 2, 3):
            wanted.append(self._resource(f"{BELT_RES}belt-inst-s{tier}-0", "Material"))
        for tier in (1, 2, 3, 4):
            for lod in (0, 2):
                wanted.append(self._resource(self._inserter_name(tier, lod), "MonoBehaviour"))
        self.log(f"prefetching {len(wanted)} mesh/material objects")
        self._prefetch(wanted)

    def building(self, prefab_path):
        found = self._lod_readers(prefab_path)
        if not found:
            return None
        readers, dist = found
        lods = [self._mesh_asset(r) for r in readers]
        return BuildingSource(prefab_path, lods, [dist[i] if i < len(dist) else None for i in range(len(lods))])

    def _mesh_asset(self, reader):
        d = reader.read_typetree()
        raw = d["bytes"]
        mats = [self._material(self._deref(m, reader.assets_file)) for m in d["materials"]]
        return MeshAsset(d["m_Name"], parse_mesh_data(bytes(raw)), mats)

    # -- materials and textures

    def _shader_name(self, mat):
        ptr = mat.m_Shader
        key = (ptr.m_FileID, ptr.m_PathID)
        if key not in self._shaders:
            try:
                self._shaders[key] = ptr.read().m_ParsedForm.m_Name
            except Exception:
                self._shaders[key] = "?"
        return self._shaders[key]

    def _material(self, reader):
        m = reader.read()
        props = m.m_SavedProperties
        textures = {}
        for slot, te in props.m_TexEnvs:
            if te.m_Texture.m_PathID:
                r = te.m_Texture.deref()
                if r.type.name == "Texture2D":
                    textures[slot] = self._tex_ref(r)
        return Material(m.m_Name, self._shader_name(m), {k: (c.r, c.g, c.b, c.a) for k, c in props.m_Colors},
                        {k: v for k, v in props.m_Floats}, textures)

    def _tex_ref(self, reader):
        key = (reader.assets_file.name, reader.path_id)
        ref = TexRef(key, None)
        ref._reader = reader
        ref._loader = lambda ref=ref: self.load_textures([ref]) or ref._image
        return ref

    def load_textures(self, refs):
        """Decode every not-yet-loaded ref with one header prefetch and one stream read."""
        todo = {}
        for ref in refs:
            if ref._image is not None:
                continue
            if ref.key in self._images:
                ref._image = self._images[ref.key]
            else:
                todo[ref.key] = ref
        if not todo:
            return
        readers = {k: r._reader for k, r in todo.items()}
        self._prefetch(readers.values())
        parsed = {k: r.read() for k, r in readers.items()}
        streamed = {k: t for k, t in parsed.items() if t.m_StreamData and t.m_StreamData.size}
        ranges = [(f"{DATA}/{posixpath.basename(t.m_StreamData.path.replace(chr(92), '/'))}", t.m_StreamData.offset, t.m_StreamData.size)
                  for t in streamed.values()]
        blobs = dict(zip(streamed, self.source.read_ranges(ranges))) if ranges else {}
        self.log(f"decoding {len(parsed)} textures ({len(blobs)} streamed)")
        for key, t in parsed.items():
            img = textures.fit(self.reader._decode(t, blobs.get(key)).convert("RGBA"), MESH_LIMIT)
            self._images[key] = todo[key]._image = img

    # -- belts and sorters

    def belt(self):
        def mesh(name):
            from UnityPy.helpers.MeshHelper import MeshHandler
            h = MeshHandler(self._resource(BELT_RES + name, "Mesh").read())
            h.process()
            P = np.array(h.m_Vertices, np.float32).reshape(-1, 3)
            N = np.array(h.m_Normals, np.float32).reshape(-1, 3)
            UV = np.array(h.m_UV0, np.float32).reshape(-1, 2)
            T = np.array(h.get_triangles()[0], np.int64).reshape(-1)
            return P, N, UV, T

        P, N, UV, T = mesh("belt-seg-0")
        tiers = {t: self._material(self._resource(f"{BELT_RES}belt-inst-s{t}-0", "Material")) for t in (1, 2, 3)}
        return BeltSource({"P": P, "N": N, "UV": UV, "T": T},
                          {"head-short": mesh("belt-head-0"), "head-long": mesh("belt-head-1")},
                          self._material(self._resource(BELT_RES + "belt-head-0", "Material")), tiers)

    @staticmethod
    def _inserter_name(tier, lod):
        return f"{INSERTER_RES}{tier}" + (f"-lod{lod}" if lod else "")

    def sorter(self, tier, lod):
        return self._mesh_asset(self._resource(self._inserter_name(tier, lod), "MonoBehaviour"))
