import math

import pytest

from fakes import (ROT_Y90, assembler_prefab, belt_prefab, mono, node, pptr, renderer, v3)
from tools.extract.buildings import building_entry, f32, main_tint, pose_relative_to_root, work_params
from tools.extract.errors import ExtractError


def close(a, b, tol=1e-5):
    return all(abs(x - y) <= tol for x, y in zip(a, b)) and len(a) == len(b)


def test_f32_gives_shortest_float32_repr():
    assert f32(0.6000000238418579) == 0.6
    assert f32(2.299999952316284) == 2.3
    assert f32(1.0) == 1.0
    assert f32(-0.0) == 0.0
    assert f32(0.1) == 0.1


def test_pose_of_nested_transform_is_composed_up_to_but_excluding_root():
    root = assembler_prefab()
    # make the root itself non-identity: it must not leak into root-relative poses
    root.pos = (100.0, 100.0, 100.0)
    root.rot = ROT_Y90
    pos, rot = pose_relative_to_root(root, 202)
    # arm at (0,1,0) rotated 90deg about Y; slot at local (1,0,0) -> (0,1,-1) in root space
    assert close(pos, (0.0, 1.0, -1.0))
    assert close(rot, ROT_Y90)


def test_pose_respects_parent_scale():
    child = node(2, "c", pos=(1.0, 0.0, 0.0))
    mid = node(1, "m", pos=(0.0, 0.0, 0.0), scale=(2.0, 2.0, 2.0), children=[child])
    root = node(0, "r", children=[mid])
    pos, _ = pose_relative_to_root(root, 2)
    assert close(pos, (2.0, 0.0, 0.0))


def test_pose_of_unknown_transform_is_an_error():
    with pytest.raises(ExtractError, match="999"):
        pose_relative_to_root(assembler_prefab(), 999)


def test_work_params_follow_prefabdesc_conversions():
    find = {
        "AssemblerDesc": {"recipeType": 4, "speedf": 0.75},
        "LabDesc": {"assembleSpeed": 1.0, "researchSpeed": 1.0},
        "BeltDesc": {"beltPrototype": 2001, "speed": 1},
        "InserterDesc": {"grade": 1, "sttf": 0.3333333432674408, "delayf": 0.0, "canStack": 0, "stackSize": 1},
        "MinerDesc": {"minerType": 2, "periodf": 0.5},
        "AnimDesc": {"prepare_length": 0.0, "working_length": 5.0},
        "PowerDesc": {"consumer": 1, "workEnergyPerTick": 4500, "idleEnergyPerTick": 200, "generator": 0},
    }.get
    w = work_params(find)
    assert w["assemblerSpeed"] == 7500
    assert w["assemblerRecipeType"] == 4
    assert w["labAssembleSpeed"] == 10000
    assert w["labResearchSpeed"] == 1.0
    assert w["beltSpeed"] == 1 and w["beltPrototype"] == 2001
    assert w["inserterSTT"] == 200000 and w["inserterGrade"] == 1 and w["inserterCanStack"] is False
    assert w["minerPeriod"] == 300000 and w["minerType"] == 2
    assert w["anim_working_length"] == 5.0
    assert w["workEnergyPerTick"] == 4500 and w["isPowerConsumer"] is True


def test_work_params_defaults_and_absent_components():
    w = work_params(lambda script: None)
    assert "assemblerSpeed" not in w and "beltSpeed" not in w
    assert w["anim_prepare_length"] == 0.0 and w["anim_working_length"] == 1.0


def test_round_to_int_uses_bankers_rounding_like_mathf():
    w = work_params({"AssemblerDesc": {"recipeType": 1, "speedf": 0.00005}}.get)
    assert w["assemblerSpeed"] == 0  # Mathf.RoundToInt(0.5) == 0


def test_main_tint_is_first_active_renderers_first_material_color():
    tint = main_tint(assembler_prefab())
    assert tint == [1.0, f32(0.6596300005912781), f32(0.3066037893295288), 1.0]


def test_main_tint_none_without_renderer_or_color():
    assert main_tint(belt_prefab()) is None
    assert main_tint(node(1, "r", components=[renderer(None)])) is None


def test_main_tint_ignores_canvas_renderer():
    root = node(1, "r", components=[renderer((0.0, 1.0, 0.0, 1.0), kind="CanvasRenderer")])
    assert main_tint(root) is None


def test_building_entry_for_assembler():
    e = building_entry({"ID": 65, "PrefabPath": "Entities/Prefabs/assembler-mk-1"}, assembler_prefab())
    assert e["modelIndex"] == 65
    assert e["prefab"] == "Entities/Prefabs/assembler-mk-1"
    assert e["selectSize"] == [4.2, 4.6, 4.2]
    assert e["selectCenter"] == [0.0, 2.3, 0.0]
    assert len(e["slotPoses"]) == 1 and len(e["insertPoses"]) == 1
    assert close(e["slotPoses"][0]["pos"], (0.0, 1.0, -1.0))
    assert close(e["insertPoses"][0]["pos"], (0.0, 0.5, 2.0))
    assert close(e["insertPoses"][0]["rot"], ROT_Y90)
    assert e["tint"] == [1.0, 0.65963, 0.3066038, 1.0]
    assert e["work"]["assemblerSpeed"] == 7500


def test_building_entry_none_without_slotconfig():
    assert building_entry({"ID": 1, "PrefabPath": "x"}, node(1, "x")) is None


def test_slotconfig_is_found_in_inactive_children_first_in_preorder():
    inner = node(3, "inner", active=False, components=[
        mono("SlotConfig", selectCenter=v3(0, 0, 0), selectSize=v3(2, 2, 2), slotPoses=[], insertPoses=[])])
    later = node(4, "later", components=[
        mono("SlotConfig", selectCenter=v3(0, 0, 0), selectSize=v3(9, 9, 9), slotPoses=[], insertPoses=[])])
    root = node(1, "root", children=[node(2, "a", children=[inner]), later])
    assert building_entry({"ID": 7, "PrefabPath": "p"}, root)["selectSize"] == [2.0, 2.0, 2.0]


def test_external_slot_pointer_is_an_error():
    root = node(1, "root", components=[
        mono("SlotConfig", selectCenter=v3(0, 0, 0), selectSize=v3(1, 1, 1), slotPoses=[pptr(5, fid=2)], insertPoses=[])])
    with pytest.raises(ExtractError, match="model 9"):
        building_entry({"ID": 9, "PrefabPath": "p"}, root)


def test_quaternions_are_unit_length():
    e = building_entry({"ID": 65, "PrefabPath": "p"}, assembler_prefab())
    for p in e["slotPoses"] + e["insertPoses"]:
        assert math.isclose(sum(c * c for c in p["rot"]), 1.0, rel_tol=1e-6)
