"""Hand parsing of the game's custom binary mesh (MeshData.Load) and of LODModelDesc.

The typetree generator mis-reads LODModelDesc, so it is parsed from raw bytes."""
import struct

import numpy as np

MONO_HEADER = 28  # GameObject PPtr (12), enabled (1+pad), script PPtr (12)


def parse_lod_desc(raw):
    """MonoBehaviour header, m_Name, then PPtr<MeshDataAsset>[] lodMeshDatas, float[] lodDistances.
    -> ([(fileID, pathID)], [distance])"""
    off = MONO_HEADER
    ln = struct.unpack_from("<i", raw, off)[0]
    off += 4 + ln
    off = (off + 3) & ~3
    n = struct.unpack_from("<i", raw, off)[0]
    off += 4
    ptrs = []
    for _ in range(n):
        ptrs.append(struct.unpack_from("<iq", raw, off))
        off += 12
    n2 = struct.unpack_from("<i", raw, off)[0]
    off += 4
    return ptrs, list(struct.unpack_from(f"<{n2}f", raw, off))


def parse_mesh_data(b):
    """-> {"pos","nrm","col","uv": float32 arrays or None, "subs": [int32 index arrays]}"""
    vc, _, sc = struct.unpack_from("<iii", b, 0)
    off = 12 + 4 * sc
    has_n, has_t, has_c, has_uv, has_uv2, has_uv3, has_uv4 = struct.unpack_from("<7?", b, off)
    off += 7

    def take(n):
        nonlocal off
        a = np.frombuffer(b, dtype="<f4", count=vc * n, offset=off).reshape(vc, n)
        off += vc * n * 4
        return a

    m = {"pos": take(3)}
    m["nrm"] = take(3) if has_n else None
    if has_t:
        take(4)
    m["col"] = take(4) if has_c else None
    m["uv"] = take(2) if has_uv else None
    for flag in (has_uv2, has_uv3, has_uv4):
        if flag:
            take(2)
    subs = []
    for _ in range(sc):
        n = struct.unpack_from("<i", b, off)[0]
        off += 4
        subs.append(np.frombuffer(b, dtype="<i4", count=n, offset=off))
        off += 4 * n
    if off != len(b):
        raise ValueError(f"mesh data size mismatch: parsed {off} of {len(b)} bytes")
    m["subs"] = subs
    return m
