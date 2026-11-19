"""src/locales/{zh,en}.json: the keys the UI needs, in the game's own wording (replaces i18n.py)."""
from ..errors import ExtractError

LANGS = {"zh": 2052, "en": 1033}


def _flatten(locale):
    flat = {}
    for table in locale["tables"].values():
        flat.update(table)
    return flat


def required_keys(protosets):
    keys = {d["Name"] for d in protosets["Item"]["dataArray"] if d["GridIndex"] != 0}
    keys |= {d["Name"] for d in protosets["Recipe"]["dataArray"]}
    return keys


def build_translations(locales, protosets, extra_keys):
    """Returns ({'zh': {key: text}, 'en': {...}}, notes). Keys: item/recipe names sorted, then `extra_keys`
    (the UI keys already in the existing zh.json) sorted. A missing item/recipe name is an error; a missing
    extra key is only reported (a UI key may be dropped by the game). Empty texts are dropped."""
    required = required_keys(protosets)
    extras = sorted(set(extra_keys) - required)
    out, notes = {}, []
    for lang, lcid in LANGS.items():
        if lcid not in locales:
            raise ExtractError(f"locale {lcid} ({lang}) is missing from the raw data")
        flat = _flatten(locales[lcid])
        missing = sorted(k for k in required if k not in flat)
        if missing:
            raise ExtractError(f"{lang}: item/recipe names missing from the game locale: {', '.join(missing)}")
        gone = [k for k in extras if k not in flat]
        if gone:
            notes.append(f"{lang}: existing keys not in the game locale, dropped: {', '.join(gone)}")
        out[lang] = {k: flat[k] for k in sorted(required) + extras if flat.get(k)}
    return out, notes
