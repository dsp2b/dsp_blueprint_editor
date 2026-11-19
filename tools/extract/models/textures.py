"""Texture handling for GLB export: tint baking, size cap and fixed-parameter JPEG encoding."""
import io

import numpy as np
from PIL import Image

MAX_TEXTURE = 512
JPEG_QUALITY = 85


def tinted(img, color):
    """DSP albedo textures are grayscale; alpha is the mask where the material's _Color tints the surface
    (this is how Mk.I/II/III share one texture). Bakes rgb * lerp(1, _Color, alpha) into an opaque image."""
    a = np.asarray(img.convert("RGBA")).astype(np.float32) / 255.0
    tint = 1.0 + a[..., 3:4] * (np.array(color[:3], dtype=np.float32) - 1.0)
    rgb = np.clip(a[..., :3] * tint, 0, 1)
    return Image.fromarray((rgb * 255 + 0.5).astype(np.uint8), "RGB")


def fit(img, limit=MAX_TEXTURE):
    if max(img.size) <= limit:
        return img
    s = limit / max(img.size)
    return img.resize((max(1, int(img.width * s)), max(1, int(img.height * s))), Image.LANCZOS)


def jpeg_bytes(img):
    buf = io.BytesIO()
    fit(img).convert("RGB").save(buf, "JPEG", quality=JPEG_QUALITY, optimize=False)
    return buf.getvalue()


def png_bytes(img):
    buf = io.BytesIO()
    fit(img).convert("RGBA").save(buf, "PNG", compress_level=9, optimize=False)
    return buf.getvalue()


def masked_tint(img, mask, color):
    """rgb * lerp(1, color, mask) where `mask` is a separate image's channel (belts keep the tier-colour
    mask in the blue channel of _ClipTex); opaque RGB result."""
    a = np.asarray(img.convert("RGB")).astype(np.float32) / 255.0
    m = Image.fromarray(np.asarray(mask.convert("RGB"))[..., 2], "L")
    if m.size != img.size:
        m = m.resize(img.size, Image.BILINEAR)
    m = np.asarray(m).astype(np.float32)[..., None] / 255.0
    tint = 1.0 + m * (np.array(color[:3], dtype=np.float32) - 1.0)
    return Image.fromarray((np.clip(a * tint, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")


def scaled(img, color):
    """rgb * color (emission colour); opaque RGB result."""
    a = np.asarray(img.convert("RGB")).astype(np.float32) / 255.0
    return Image.fromarray((np.clip(a * np.array(color[:3], dtype=np.float32), 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")
