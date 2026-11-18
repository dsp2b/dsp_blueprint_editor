"""Unity (left-handed, +X right, +Y up, +Z forward) -> glTF (right-handed) conversion.

x -> -x for positions, normals and translations, triangle winding reversed, v -> 1 - v, rotations
(qx, qy, qz, qw) -> (qx, -qy, -qz, qw). So glTF -X is Unity +X and glTF +Z (building front) is Unity +Z.
"""
import numpy as np

CONVENTION = ("glTF X = -Unity X (Unity left-handed -> glTF right-handed via X mirror, winding reversed, "
              "v flipped); glTF +Z = building front.")


def mirror_x(a):
    out = np.array(a, dtype="<f4", copy=True)
    out[:, 0] *= -1
    return out


def mirror_normals(n):
    out = mirror_x(n)
    length = np.linalg.norm(out, axis=1, keepdims=True)
    length[length == 0] = 1
    return (out / length).astype("<f4")


def reverse_winding(tris):
    """(N,3) or flat index list -> same shape with the last two indices of each triangle swapped."""
    t = np.asarray(tris)
    return t.reshape(-1, 3)[:, [0, 2, 1]].reshape(t.shape)


def flip_v(uv):
    out = np.array(uv, dtype="<f4", copy=True)
    out[:, 1] = 1 - out[:, 1]
    return out


def mirror_translation(t):
    return [-t[0], t[1], t[2]]


def mirror_quat(q):
    return [q[0], -q[1], -q[2], q[3]]
