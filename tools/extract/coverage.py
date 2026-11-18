"""Every buildable item must map to models we can show."""

# Belts are drawn by the game's belt renderer, not from a prefab mesh, so they have no static
# model to export; they are covered by being listed here.
NO_STATIC_MODEL = frozenset({35, 36, 37})


def item_models(item):
    return list(range(item["ModelIndex"], item["ModelIndex"] + max(1, item.get("ModelCount", 1))))


def coverage(items, boxed_models, no_static_model=NO_STATIC_MODEL):
    """items: ItemProto dicts; boxed_models: model indices that have a SlotConfig selection box.

    Returns (records, uncovered), both sorted by item id. Buildable = CanBuild and ModelIndex > 0.
    """
    records, uncovered = [], []
    for it in sorted(items, key=lambda i: i["ID"]):
        if not it.get("CanBuild") or it.get("ModelIndex", 0) <= 0:
            continue
        models = item_models(it)
        missing = [m for m in models if m not in boxed_models and m not in no_static_model]
        if missing:
            uncovered.append({"item": it["ID"], "name": it.get("Name"), "models": models, "missing": missing})
            continue
        status = "no-static-model" if all(m in no_static_model for m in models) else "selection-box"
        records.append({"item": it["ID"], "name": it.get("Name"), "models": models, "status": status})
    return records, uncovered
