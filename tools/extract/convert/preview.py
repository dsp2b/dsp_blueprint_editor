"""TypeScript data modules of the blueprint preview tool (replace gen_items/recipes/midi/signal/tech)."""
from ..errors import ExtractError


def _q(s):
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def _grid(g):
    return f"[{g // 1000}, {(g // 100) % 10}, {g % 100}]"


def items_ts(item_set):
    out = ["import { Item } from './types';\n\nexport const items: Item[] = [\n"]
    for d in item_set["dataArray"]:
        if d["GridIndex"] == 0:
            continue
        models = ", ".join(str(m) for m in range(d["ModelIndex"], d["ModelIndex"] + d["ModelCount"])) \
            if d["ModelIndex"] > 0 else ""
        out.append("    {\n"
                   f"        id: {d['ID']}, models: [{models}], grid: {_grid(d['GridIndex'])},\n"
                   f"        name: {_q(d['Name'])}, icon: {_q(d['IconPath'].split('/')[-1])},\n"
                   f"        grade: {d['Grade']}, upgrades: [{', '.join(str(u) for u in d['Upgrades'])}], "
                   f"buildIndex: {d['BuildIndex']},\n")
        if d["Productive"]:
            out.append("        productive: true,\n")
        out.append("    },\n")
    out.append("];\n")
    return "".join(out)


def recipes_ts(recipe_set):
    out = ["import { Recipe } from './types';\nimport { itemsMap } from './items';\n\n"
           "export const recipes: Recipe[] = [\n"]
    for d in recipe_set["dataArray"]:
        out.append(f"    {{\n        id: {d['ID']}, name: {_q(d['Name'])}, time: {d['TimeSpend']},\n")
        for key, ids, counts in (("from", d["Items"], d["ItemCounts"]), ("to", d["Results"], d["ResultCounts"])):
            out.append(f"        {key}: [\n")
            out.extend(f"            {{item: itemsMap.get({i})!, count: {c}}},\n" for i, c in zip(ids, counts))
            out.append("        ],\n")
        out.append(f"        grid: {_grid(d['GridIndex'])},\n")
        if d["IconPath"]:
            out.append(f"        icon: {_q(d['IconPath'].split('/')[-1])},\n")
        if d["NonProductive"]:
            out.append("        nonProductive: true,\n")
        out.append("    },\n")
    out.append("];\n")
    return "".join(out)


def midi_ts(midi_set):
    out = ["import { MIDI } from './types';\n\nexport const midi: readonly MIDI[] = [\n"]
    for d in midi_set["dataArray"]:
        out.append(f"    {{id: {d['ID']}, isInstrument: {'true' if d['Instrument'] else 'false'}, "
                   f"pitchRange: {list(d['PitchRange'])}}},\n")
    out.append("];\n\nexport const midiMap = new Map<number, MIDI>();\n"
               "for (const m of midi)\n    midiMap.set(m.id, m);\n")
    return "".join(out)


def signal_ts(signal_set):
    out = ['import { Signal } from "./types";\n\nexport const signal: Signal[] = [\n']
    for d in signal_set["dataArray"]:
        grid_index = d["GridIndex"] - 1101
        if grid_index // 1000 != 2:
            raise ExtractError(f"signal {d['ID']}: unexpected GridIndex {d['GridIndex']} (expected page 3)")
        out.append(f"    {{id: {d['ID']}, gridPos: [{(grid_index % 1000) // 100}, {grid_index % 100}]}},\n")
    out.append("];\n")
    return "".join(out)


def tech_ts(tech_set):
    out = ['import { Tech } from "./types";\n\nexport const tech: Tech[] = [\n']
    out.extend(f"    {{id: {d['ID']}}},\n" for d in tech_set["dataArray"] if d["Published"])
    out.append("];\n")
    return "".join(out)
