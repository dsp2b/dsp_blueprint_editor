"""UnityPy-backed reader: turns the game's serialized files into the plain data raw.py consumes.

Files are opened through the GameSource. For a local install that is the real file; for a remote
one it is a sparse in-memory file filled by batched byte-range reads: the reader prefetches the
serialized-file headers, then the objects it is going to parse (picked by type from the object
table), so only a fraction of the 450 MB resources.assets ever crosses the network. Any byte that
was not prefetched is still fetched on demand, so prefetching only affects speed, not output.
"""
import bisect
import io
import posixpath
import struct
from collections import defaultdict

from .errors import ExtractError
from .prefab import RENDERER_TYPES, Component, Node

DATA = "DSPGAME_Data"
UNITY_VERSION = "2022.3.62f3c1"  # fallback when the serialized file does not state it
WHOLE_FILES = ("globalgamemanagers", "globalgamemanagers.assets")
SPARSE_FILES = ("resources.assets", "sharedassets0.assets")
# Object types parsed while reading ProtoSets, prefabs, materials and icon sprites.
PREFETCH_TYPES = frozenset({"GameObject", "Transform", "RectTransform", "Material", "Sprite"} | RENDERER_TYPES)
SMALL_MONOBEHAVIOUR = 64 * 1024
MONO_HEAD = 96  # enough of a MonoBehaviour for its script PPtr and m_Name
MERGE_GAP = 64 * 1024
MISS_BLOCK = 1 << 20


# ---------------------------------------------------------------- sparse remote file

class SparseCache:
    """Known byte ranges of one remote file; shared by every SparseFile opened on it."""

    def __init__(self, source, path, size):
        self.source, self.path, self.size = source, path, size
        self.starts, self.chunks = [], []  # sorted, non-overlapping
        self.misses = 0

    def _insert(self, start, data):
        i = bisect.bisect_left(self.starts, start)
        self.starts.insert(i, start)
        self.chunks.insert(i, data)

    def _normalise(self):
        starts, chunks = [], []
        for s, c in zip(self.starts, self.chunks):
            if starts and s <= starts[-1] + len(chunks[-1]):
                end = starts[-1] + len(chunks[-1])
                if s + len(c) > end:
                    chunks[-1] = chunks[-1] + c[end - s:]
            else:
                starts.append(s)
                chunks.append(c)
        self.starts, self.chunks = starts, chunks

    def missing(self, start, end):
        """Sub-ranges of [start, end) not cached yet."""
        out, pos = [], start
        i = max(0, bisect.bisect_right(self.starts, start) - 1)
        while pos < end and i < len(self.starts):
            s, e = self.starts[i], self.starts[i] + len(self.chunks[i])
            if e <= pos:
                i += 1
                continue
            if s > pos:
                out.append((pos, min(s, end)))
            pos = max(pos, e)
            i += 1
        if pos < end:
            out.append((pos, end))
        return out

    def plan(self, ranges):
        gaps = sorted(g for s, e in ranges for g in self.missing(max(0, s), min(e, self.size)) if g[0] < g[1])
        merged = []
        for s, e in gaps:
            if merged and s - merged[-1][1] <= MERGE_GAP:
                merged[-1][1] = max(merged[-1][1], e)
            else:
                merged.append([s, e])
        return [(self.path, s, e - s) for s, e in merged]

    def fill(self, planned, blobs):
        for (_, s, _), data in zip(planned, blobs):
            self._insert(s, data)
        self._normalise()

    def read(self, start, n):
        end = min(start + n, self.size)
        if start >= end:
            return b""
        gaps = self.missing(start, end)
        if gaps:
            self.misses += 1
            blocks = [((s // MISS_BLOCK) * MISS_BLOCK, min(self.size, -(-e // MISS_BLOCK) * MISS_BLOCK)) for s, e in gaps]
            planned = self.plan(blocks)
            self.fill(planned, self.source.read_ranges(planned))
        i = bisect.bisect_right(self.starts, start) - 1
        out, pos = bytearray(), start
        while pos < end:
            s, c = self.starts[i], self.chunks[i]
            take = c[pos - s:min(end - s, len(c))]
            out += take
            pos += len(take)
            i += 1
        return bytes(out)


class SparseFile(io.RawIOBase):
    def __init__(self, cache):
        self.cache, self.pos = cache, 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.cache.size + offset
        return self.pos

    def tell(self):
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.cache.size - self.pos
        data = self.cache.read(self.pos, n)
        self.pos += len(data)
        return data

    def readinto(self, b):
        data = self.read(len(b))
        b[:len(data)] = data
        return len(data)


def serialized_data_offset(head):
    """data offset from the first bytes of a SerializedFile header (big-endian)."""
    version = struct.unpack_from(">I", head, 8)[0]
    if version >= 22:
        return struct.unpack_from(">q", head, 32)[0]
    return struct.unpack_from(">I", head, 12)[0]


# ---------------------------------------------------------------- reader

class UnityReader:
    def __init__(self, source, log=None):
        self.source = source
        self.log = log or (lambda msg: None)
        self.remote = source.local_path(f"{DATA}/resources.assets") is None
        self._caches = {}
        self._open = []
        self._env = None
        self._script_names = {}
        self._protosets = None
        self._container = None

    # -- files

    def _cache(self, name):
        rel = f"{DATA}/{name}"
        if rel not in self._caches:
            size = self.source.size(rel)
            if size is None:
                raise ExtractError(f"missing game file: {rel}")
            self._caches[rel] = SparseCache(self.source, rel, size)
        return self._caches[rel]

    def _prefetch(self, wanted):
        """wanted: [(file name, start, end)]; one batched read for everything not cached yet."""
        if not self.remote or not wanted:
            return
        by_file = defaultdict(list)
        for name, s, e in wanted:
            by_file[name].append((s, e))
        plans = [(self._cache(n), self._cache(n).plan(r)) for n, r in sorted(by_file.items())]
        flat = [p for _, plan in plans for p in plan]
        if not flat:
            return
        blobs = iter(self.source.read_ranges(flat))
        for cache, plan in plans:
            cache.fill(plan, [next(blobs) for _ in plan])

    def _fileobj(self, name):
        local = self.source.local_path(f"{DATA}/{name}")
        f = open(local, "rb") if local is not None else SparseFile(self._cache(name))
        self._open.append(f)
        return f

    # -- version

    def version(self):
        import UnityPy
        if self.remote:
            c = self._cache("globalgamemanagers")
            self._prefetch([("globalgamemanagers", 0, c.size)])
        env = UnityPy.Environment()
        env.load_file(self._fileobj("globalgamemanagers"), name="globalgamemanagers")
        for obj in env.objects:
            if obj.type.name == "PlayerSettings":
                v = obj.read_typetree().get("bundleVersion")
                if v:
                    return v
        raise ExtractError("PlayerSettings.bundleVersion not found in globalgamemanagers")

    # -- environment

    def _load(self):
        if self._env is not None:
            return self._env
        import UnityPy
        from UnityPy.helpers import TypeTreeGenerator

        managed = f"{DATA}/Managed"
        dlls = sorted(n for n in (self.source.listdir(managed) or []) if n.lower().endswith(".dll"))
        if "Assembly-CSharp.dll" not in dlls:
            raise ExtractError(f"missing game file: {managed}/Assembly-CSharp.dll")
        if self.remote:
            wanted = [(n, 0, self._cache(n).size) for n in WHOLE_FILES]
            wanted += [(n, 0, 64) for n in SPARSE_FILES]
            self._prefetch(wanted)
            self._prefetch([(n, 0, serialized_data_offset(self._cache(n).read(0, 64))) for n in SPARSE_FILES])
        self.log(f"reading {len(dlls)} managed assemblies")
        dll_bytes = self.source.read_ranges([(f"{managed}/{n}", 0, self.source.size(f"{managed}/{n}")) for n in dlls])

        env = UnityPy.Environment()
        for name in WHOLE_FILES + SPARSE_FILES:
            env.load_file(self._fileobj(name), name=name)
        unity_version = getattr(env.files.get("resources.assets"), "unity_version", None) or UNITY_VERSION
        gen = TypeTreeGenerator.TypeTreeGenerator(unity_version)
        loaded = 0
        for n, data in zip(dlls, dll_bytes):
            try:
                gen.load_dll(data)
                loaded += 1
            except Exception as e:  # some system assemblies are not loadable; only ours is essential
                if n == "Assembly-CSharp.dll":
                    raise ExtractError(f"cannot load {managed}/{n} into the type tree generator: {e}") from e
        self.log(f"type trees for Unity {unity_version} from {loaded}/{len(dlls)} assemblies")
        env.typetree_generator = gen
        self._env = env
        if self.remote:
            self._prefetch_objects()
        return env

    def _prefetch_objects(self):
        wanted, big = [], []
        for name in SPARSE_FILES:
            for obj in self._env.files[name].objects.values():
                t = obj.type.name
                if t in PREFETCH_TYPES or t == "MonoBehaviour" and obj.byte_size <= SMALL_MONOBEHAVIOUR:
                    wanted.append((name, obj.byte_start, obj.byte_start + obj.byte_size))
                elif t == "MonoBehaviour":
                    big.append((name, obj))
        self.log(f"prefetching {len(wanted)} objects")
        self._prefetch(wanted + [(n, o.byte_start, o.byte_start + MONO_HEAD) for n, o in big])
        self._prefetch([(n, o.byte_start, o.byte_start + o.byte_size) for n, o in big
                        if (self._mono_name(o) or "").endswith("ProtoSet")])

    def close(self):
        for f in self._open:
            f.close()
        self._open.clear()
        misses = sum(c.misses for c in self._caches.values())
        if misses:
            self.log(f"{misses} on-demand remote reads outside the prefetch plan")

    # -- helpers

    @staticmethod
    def _head(obj, n):
        obj.reader.Position = obj.byte_start
        return obj.reader.read_bytes(min(n, obj.byte_size))

    def _mono_name(self, obj):
        """m_Name of a MonoBehaviour from its first bytes (PPtr GameObject, enabled, PPtr script, name)."""
        head = self._head(obj, MONO_HEAD)
        if len(head) < 32:
            return None
        ln = struct.unpack_from("<i", head, 28)[0]
        if not 0 < ln <= len(head) - 32:
            return None
        return head[32:32 + ln].decode("utf-8", "replace")

    def _script_name(self, obj):
        head = self._head(obj, 28)
        fid, pid = struct.unpack_from("<iq", head, 16)
        key = (obj.assets_file.name, fid, pid)
        if key not in self._script_names:
            name = None
            if pid:
                try:
                    name = self._pptr(obj.assets_file, fid, pid).read().m_ClassName
                except Exception:
                    name = None
            self._script_names[key] = name
        return self._script_names[key]

    @staticmethod
    def _pptr(assets_file, fid, pid):
        from UnityPy.classes import PPtr
        p = PPtr(m_FileID=fid, m_PathID=pid)
        p.assetsfile = assets_file
        return p

    def _containers(self):
        if self._container is None:
            env = self._load()
            rm = next((o for o in env.files["globalgamemanagers"].objects.values()
                       if o.type.name == "ResourceManager"), None)
            if rm is None:
                raise ExtractError("ResourceManager not found in globalgamemanagers")
            self._container = defaultdict(list)
            for path, ptr in rm.read().m_Container:
                self._container[path.lower()].append(ptr)
        return self._container

    # -- ProtoSets

    def protoset(self, name):
        if self._protosets is None:
            env = self._load()
            found = {}
            for obj in env.files["resources.assets"].objects.values():
                if obj.type.name == "MonoBehaviour":
                    n = self._mono_name(obj)
                    if n and n.endswith("ProtoSet") and n not in found:
                        found[n] = obj
            self._protosets = found
        obj = self._protosets.get(name)
        if obj is None:
            raise ExtractError(f"ProtoSet {name} not found in resources.assets")
        try:
            return obj.read_typetree()
        except Exception as e:
            raise ExtractError(f"cannot parse {name}: {type(e).__name__}: {e}") from e

    # -- prefabs

    def prefab(self, path, scripts):
        for ptr in self._containers().get(path.lower(), []):
            r = ptr.deref()
            if r.type.name == "GameObject":
                try:
                    return self._node(r, scripts)
                except ExtractError:
                    raise
                except Exception as e:
                    raise ExtractError(f"cannot read prefab {path}: {type(e).__name__}: {e}") from e
        return None

    def _node(self, go_reader, scripts):
        go = go_reader.read()
        transform, tid, comps = None, None, []
        for pair in go.m_Component:
            ptr = pair.component if hasattr(pair, "component") else pair
            r = ptr.deref()
            t = r.type.name
            if t in ("Transform", "RectTransform"):
                transform, tid = r.read(), r.path_id
                comps.append(Component(t))
            elif t == "MonoBehaviour":
                script = self._script_name(r)
                comps.append(Component(t, script, r.read_typetree() if script in scripts else None))
            elif t in RENDERER_TYPES:
                comps.append(Component(t, materials=lambda r=r: self._materials(r)))
            else:
                comps.append(Component(t))
        if transform is None:
            raise ExtractError(f"GameObject {go.m_Name} has no Transform")
        p, q, s = transform.m_LocalPosition, transform.m_LocalRotation, transform.m_LocalScale
        children = [self._node(ch.deref().read().m_GameObject.deref(), scripts) for ch in transform.m_Children]
        return Node(id=tid, name=go.m_Name, active=bool(go.m_IsActive), pos=(p.x, p.y, p.z),
                    rot=(q.x, q.y, q.z, q.w), scale=(s.x, s.y, s.z), components=comps, children=children)

    def _materials(self, renderer_reader):
        out = []
        for m in renderer_reader.read_typetree().get("m_Materials", []):
            if not m.get("m_PathID"):
                out.append(None)
                continue
            mat = self._pptr(renderer_reader.assets_file, m["m_FileID"], m["m_PathID"]).deref().read_typetree()
            colors = {}
            for entry in mat.get("m_SavedProperties", {}).get("m_Colors", []):
                key, c = entry
                colors[key] = (c["r"], c["g"], c["b"], c["a"])
            out.append({"name": mat.get("m_Name"), "colors": colors})
        return out

    # -- icons

    def icons(self, paths):
        textures = {}
        for path in paths:
            ptrs = self._containers().get(path.lower(), [])
            tex = next((p.deref() for p in ptrs if p.deref().type.name == "Texture2D"), None)
            if tex is None:
                sprite = next((p.deref() for p in ptrs if p.deref().type.name == "Sprite"), None)
                if sprite is not None:
                    rd = sprite.read().m_RD
                    tex = rd.texture.deref() if rd.texture.m_PathID else None
            if tex is not None:
                textures[path] = tex
        files = {r.assets_file.name for r in textures.values()}
        self._prefetch([(r.assets_file.name, r.byte_start, r.byte_start + r.byte_size)
                        for r in textures.values() if r.assets_file.name in SPARSE_FILES])
        parsed = {path: r.read() for path, r in textures.items()}
        streamed = {path: t for path, t in parsed.items() if t.m_StreamData and t.m_StreamData.size}
        stream_ranges = [(f"{DATA}/{posixpath.basename(t.m_StreamData.path.replace(chr(92), '/'))}",
                          t.m_StreamData.offset, t.m_StreamData.size) for t in streamed.values()]
        stream_data = dict(zip(streamed, self.source.read_ranges(stream_ranges))) if stream_ranges else {}
        self.log(f"decoding {len(parsed)} icons from {sorted(files)} ({len(stream_data)} streamed)")
        out = {}
        for path, t in parsed.items():
            out[path] = self._decode(t, stream_data.get(path))
        return out

    @staticmethod
    def _decode(tex, stream_bytes):
        from UnityPy.export.Texture2DConverter import parse_image_data
        if stream_bytes is None:
            return tex.image.convert("RGBA")
        reader = tex.object_reader
        img = parse_image_data(stream_bytes, tex.m_Width, tex.m_Height, tex.m_TextureFormat, reader.version,
                               reader.platform, getattr(tex, "m_PlatformBlob", None))
        return img.convert("RGBA")
