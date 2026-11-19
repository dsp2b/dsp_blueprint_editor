import json


def dump_json(obj, sort_keys=True) -> bytes:
    """The one JSON encoding used for every output file (stable bytes for identical input)."""
    return (json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=sort_keys, allow_nan=False) + "\n").encode("utf-8")
