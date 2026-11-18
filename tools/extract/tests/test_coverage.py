from tools.extract.coverage import NO_STATIC_MODEL, coverage


def item(iid, model, count=1, can_build=1, name="x"):
    return {"ID": iid, "Name": name, "CanBuild": can_build, "ModelIndex": model, "ModelCount": count}


def test_all_buildable_items_covered():
    records, uncovered = coverage([item(1, 65), item(2, 0), item(3, 70, can_build=0)], {65})
    assert uncovered == []
    assert records == [{"item": 1, "name": "x", "models": [65], "status": "selection-box"}]


def test_every_variant_model_of_an_item_must_be_covered():
    records, uncovered = coverage([item(2020, 38, count=3, name="四向分流器")], {38, 40})
    assert uncovered == [{"item": 2020, "name": "四向分流器", "models": [38, 39, 40], "missing": [39]}]


def test_belts_are_explicitly_marked_no_static_model():
    assert NO_STATIC_MODEL == frozenset({35, 36, 37})
    records, uncovered = coverage([item(2001, 35)], {35})
    assert uncovered == []
    assert records[0]["status"] == "no-static-model"


def test_records_sorted_by_item_id():
    records, _ = coverage([item(9, 65), item(3, 65), item(5, 65)], {65})
    assert [r["item"] for r in records] == [3, 5, 9]
