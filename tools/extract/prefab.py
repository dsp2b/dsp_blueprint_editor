"""Plain-data view of a Unity prefab hierarchy, produced by the reader and consumed by buildings.py."""
from dataclasses import dataclass, field
from typing import Callable, Iterator, List, Optional, Tuple

Vec3 = Tuple[float, float, float]
Quat = Tuple[float, float, float, float]  # x, y, z, w

# Concrete UnityEngine.Renderer subclasses (CanvasRenderer is not one).
RENDERER_TYPES = frozenset({
    "MeshRenderer", "SkinnedMeshRenderer", "ParticleSystemRenderer", "LineRenderer", "TrailRenderer",
    "SpriteRenderer", "BillboardRenderer", "SpriteShapeRenderer", "TilemapRenderer", "VFXRenderer",
})


@dataclass
class Component:
    kind: str                      # Unity class name, e.g. "MonoBehaviour", "MeshRenderer"
    script: Optional[str] = None   # MonoScript class name for MonoBehaviours
    data: Optional[dict] = None    # type tree of MonoBehaviours the caller asked for
    # renderers only: lazily resolved [{"name": str, "colors": {"_Color": (r, g, b, a), ...}}, ...]
    materials: Optional[Callable[[], List[dict]]] = None


@dataclass
class Node:
    id: int                        # path id of the GameObject's Transform (target of Transform PPtrs)
    name: str
    active: bool                   # GameObject.m_IsActive (self only)
    pos: Vec3
    rot: Quat
    scale: Vec3
    components: List[Component] = field(default_factory=list)
    children: List["Node"] = field(default_factory=list)

    def walk(self, active_only=False) -> Iterator["Node"]:
        """Pre-order (self, then children depth-first), the order GetComponentInChildren uses."""
        if active_only and not self.active:
            return
        yield self
        for c in self.children:
            yield from c.walk(active_only)
