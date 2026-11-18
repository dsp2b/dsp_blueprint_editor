"""Translation tables from <game>/Locale (UTF-16 text, one `key<TAB>?<TAB>?<TAB>text` per line)."""
from .errors import ExtractError
from .jsonout import dump_json

REQUIRED_LCIDS = (2052, 1033)  # zh-CN and en-US are what the consumers need


def _decode(raw: bytes) -> str:
    return raw.decode("utf-16")  # files start with a BOM


def parse_header(text):
    languages, tables = [], []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("[") and line.endswith("]") or line.startswith("Version="):
            continue
        cells = line.split(",")
        if len(cells) >= 5 and cells[0].isdigit():
            languages.append({"lcid": int(cells[0]), "name": cells[1], "code": cells[2], "abbr": cells[3],
                              "fallback": int(cells[4]) if cells[4].isdigit() else None})
        elif "=" in line:
            tables.append(line.split("=", 1)[0])
    return {"languages": languages, "tables": tables}


def parse_table(text):
    out = {}
    for line in text.split("\n"):
        cells = line.rstrip("\r").split("\t")
        if len(cells) < 4 or not cells[0]:
            continue
        out[cells[0]] = "\t".join(cells[3:])
    return out


def read_locales(source):
    """Returns {"locale/<lcid>.json": bytes} for every language in Header.txt that is installed."""
    header = parse_header(_decode(source.read("Locale/Header.txt")))
    files = {}
    for lang in header["languages"]:
        lcid = lang["lcid"]
        paths = [f"Locale/{lcid}/{t}.txt" for t in header["tables"]]
        sizes = {p: source.size(p) for p in paths}
        present = [p for p in paths if sizes[p] is not None]
        if not present:
            if lcid in REQUIRED_LCIDS:
                raise ExtractError(f"locale {lcid} ({lang['code']}) is not installed (Locale/{lcid}/ missing)")
            continue
        missing = [p for p in paths if sizes[p] is None]
        if missing:
            raise ExtractError("missing locale file(s): " + ", ".join(missing))
        blobs = source.read_ranges([(p, 0, sizes[p]) for p in paths])
        tables = {t: parse_table(_decode(b)) for t, b in zip(header["tables"], blobs)}
        files[f"locale/{lcid}.json"] = dump_json({**lang, "tables": tables}, sort_keys=False)
    return files
