"""dsp2b-go `data/*ProtoSet.json` and dsp2b-frontend `app/services/*ProtoSet.json` (rules of the retired
re_dsp gen_protoset.py): nested Proto wrapper, bool fields, Vector2 as X/Y, indent=2."""
import json
import re

GO_SETS = ("Item", "Recipe", "Tech", "Signal")
WRAPPER_KEYS = ("ID", "Name", "SID")

# Unity type trees serialize bool as 0/1; the Go structs use bool.
BOOL_FIELDS = {
    "IsFluid", "IsEntity", "CanBuild", "BuildInGas", "Productive",
    "Handcraft", "Explicit", "NonProductive",
    "Published", "IsHiddenTech", "IsObsolete", "IsLabTech", "PreTechsMax",
}
# Vector2: lower-case x/y in the type tree, X/Y in the Go structs.
VEC2_FIELDS = {"EnemyDropRange"}


def filename(table):
    return f"{table[0].lower()}{table[1:]}ProtoSet.json"


def _fix(key, v):
    if key in BOOL_FIELDS:
        return bool(v)
    if key in VEC2_FIELDS and isinstance(v, dict):
        return {"X": v.get("x", 0), "Y": v.get("y", 0)}
    return v


def to_go(raw_set, table):
    out = {"Type": raw_set.get("Type") or f"{table}ProtoSet", "TableName": raw_set.get("TableName", ""),
           "Signature": raw_set.get("Signature", ""), "DataArray": []}
    for e in raw_set["dataArray"]:
        out["DataArray"].append({
            "Name": e.get("Name", ""), "ID": e.get("ID", 0), "SID": e.get("SID", ""),
            "Proto": {k: _fix(k, v) for k, v in e.items() if k not in WRAPPER_KEYS},
        })
    return out


def fe_icon_path(p):
    """Icons/ItemRecipe/darkfog-lens -> icons/item_recipe/darkfog-lens"""
    if not p:
        return p
    return "/".join(re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", seg).lower() for seg in p.split("/"))


def to_frontend(go):
    fe = json.loads(json.dumps(go))
    for e in fe["DataArray"]:
        if "IconPath" in e["Proto"]:
            e["Proto"]["IconPath"] = fe_icon_path(e["Proto"]["IconPath"])
    return fe


def dump(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")


def _flat(entry):
    return {"Name": entry["Name"], "SID": entry["SID"], **entry["Proto"]}


def compat_report(new, old):
    """Compares entries (by ID) and fields present on both sides; additions/removals are listed apart."""
    new_by = {e["ID"]: e for e in new["DataArray"]}
    old_by = {e["ID"]: e for e in old["DataArray"]}
    changed, new_fields, dropped_fields = [], set(), set()
    common = [i for i in old_by if i in new_by]
    for i in common:
        n, o = _flat(new_by[i]), _flat(old_by[i])
        new_fields |= n.keys() - o.keys()
        dropped_fields |= o.keys() - n.keys()
        for k in o:
            if k in n and n[k] != o[k]:
                changed.append({"id": i, "field": k, "old": o[k], "new": n[k]})
    return {"compared": len(common), "added": sorted(new_by.keys() - old_by.keys()),
            "removed": sorted(old_by.keys() - new_by.keys()), "changed": changed,
            "new_fields": sorted(new_fields), "dropped_fields": sorted(dropped_fields)}


def format_report(name, rep, limit=20):
    lines = [f"{name}: {rep['compared']} entries in both, {len(rep['changed'])} field differences, "
             f"added {rep['added']}, removed {rep['removed']}"]
    if rep["new_fields"]:
        lines.append(f"  fields only in the regenerated file: {rep['new_fields']}")
    if rep["dropped_fields"]:
        lines.append(f"  fields only in the existing file: {rep['dropped_fields']}")
    for c in rep["changed"][:limit]:
        lines.append(f"  id {c['id']} {c['field']}: {c['old']!r} -> {c['new']!r}")
    if len(rep["changed"]) > limit:
        lines.append(f"  ... {len(rep['changed']) - limit} more (see --report)")
    return "\n".join(lines)
