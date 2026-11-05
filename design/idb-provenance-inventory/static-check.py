"""Read-only evidence checks. No network, subprocess, extraction, or browser imports.

An integrity match is not historical BUILD_BINDING or runtime identity proof.
Python 3 standard library only. JSON output goes to stdout; inputs are never written.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import struct
import zipfile


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def inspect_elf(data):
    """Inspect ELF64 little-endian sections; never call a loader or ldd."""
    if data[:4] != b"\x7fELF":
        return None
    if data[4:6] != b"\x02\x01":
        return {"status": "UNKNOWN", "reason": "unsupported ELF encoding"}
    shoff = struct.unpack_from("<Q", data, 40)[0]
    shsize, shnum, _ = struct.unpack_from("<HHH", data, 58)
    sections = [struct.unpack_from("<IIQQQQIIQQ", data, shoff + i * shsize)
                for i in range(shnum)]
    result = {"status": "PRESENT_PARTIAL", "buildIds": [], "needed": [],
              "rpath": [], "runpath": [], "interpreter": None,
              "limitation": "DT_NEEDED names are not resolved or loaded modules"}
    phoff = struct.unpack_from("<Q", data, 32)[0]
    phsize, phnum = struct.unpack_from("<HH", data, 54)
    for i in range(phnum):
        kind, _, offset, _, _, size, _, _ = struct.unpack_from(
            "<IIQQQQQQ", data, phoff + i * phsize)
        if kind == 3:
            result["interpreter"] = data[offset:offset + size].rstrip(b"\0").decode()
    for section in sections:
        _, kind, _, _, offset, size, link, _, _, entsize = section
        if kind == 7:  # SHT_NOTE
            cursor, end = offset, offset + size
            while cursor + 12 <= end:
                namesz, descsz, note_type = struct.unpack_from("<III", data, cursor)
                cursor += 12
                name = data[cursor:cursor + namesz].rstrip(b"\0")
                cursor += (namesz + 3) & ~3
                desc = data[cursor:cursor + descsz]
                cursor += (descsz + 3) & ~3
                if name == b"GNU" and note_type == 3:
                    result["buildIds"].append(desc.hex())
        if kind == 6:  # SHT_DYNAMIC
            strings = sections[link]
            table = data[strings[4]:strings[4] + strings[5]]
            for cursor in range(offset, offset + size, entsize or 16):
                tag, value = struct.unpack_from("<qQ", data, cursor)
                if tag == 0:
                    break
                key = {1: "needed", 15: "rpath", 29: "runpath"}.get(tag)
                if key:
                    result[key].append(table[value:].split(b"\0", 1)[0].decode())
    return result


def inspect_zip(path):
    entries = []
    descriptions = []
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("duplicate ZIP member")
        for info in archive.infolist():
            data = archive.read(info)
            row = {"name": info.filename, "size": len(data), "sha256": sha256(data)}
            mode = info.external_attr >> 16
            if mode & 0o170000 == 0o120000:
                row["symlinkTarget"] = data.decode()
            elf = inspect_elf(data)
            if elf:
                row["elf"] = elf
            entries.append(row)
            if info.filename in ("minibrowser-wpe/README.txt", "minibrowser-gtk/README.txt"):
                text = data.decode("utf-8")
                fields = {}
                for line in text.splitlines():
                    if line.startswith("  - ") and ": " in line:
                        key, value = line[4:].split(": ", 1)
                        if key in ("WebKit Platform", "Configuration", "Bundle type",
                                   "Builder date", "Builder OS"):
                            fields[key] = value
                descriptions.append({
                    "member": info.filename, "selfReportedFields": fields,
                    "referencedBundleScript": ("Tools/Scripts/generate-bundle"
                                               if "Tools/Scripts/generate-bundle" in text else None),
                    "classification": "PRESENT_PARTIAL",
                    "limitation": "self-description inside current archive only; not authenticated "
                                  "builder run, script version, compile timestamp, CMake flags, "
                                  "or historical exec binding"})
    return {"archive": Path(path).name, "size": Path(path).stat().st_size,
            "sha256": sha256(Path(path).read_bytes()), "entries": entries,
            "bundleSelfDescriptions": descriptions,
            "BUILD_BINDING": "UNKNOWN", "execution": "NOT_RUN"}


def verify_receipts(manifest, root, expectations):
    """Separate pinned expectations from the subject receipts and external bytes."""
    rows, seen = [], set()
    root = Path(root).resolve()
    if not isinstance(manifest, dict) or not isinstance(manifest.get("receipts"), list):
        return [{"status": "FAIL", "reason": "manifest-shape"}]
    for receipt in manifest["receipts"]:
        if not isinstance(receipt, dict) or not isinstance(receipt.get("file"), str):
            rows.append({"status": "FAIL", "reason": "receipt-shape"})
            continue
        name = receipt["file"]
        row = {"file": name, "status": "MATCH", "reasons": []}
        rows.append(row)
        path = (root / name).resolve()
        if name in seen or not path.is_relative_to(root):
            row.update(status="FAIL", reasons=["duplicate-or-outside-root"])
            continue
        seen.add(name)
        pinned = expectations.get("files", {}).get(name, {})
        contradictions = [key for key, value in pinned.items()
                          if receipt.get(key) != value]
        if contradictions:
            row.update(status="FAIL", reasons=["pinned-" + key for key in contradictions])
            continue
        if receipt.get("exitCode", 0) != 0 or not path.is_file():
            row.update(status="UNKNOWN", reasons=["unavailable-bytes"])
            continue
        data = path.read_bytes()
        if receipt.get("sha256") != sha256(data) or receipt.get("size") != len(data):
            row.update(status="FAIL", reasons=["digest-or-size"])
    for missing in expectations.get("files", {}).keys() - seen:
        rows.append({"file": missing, "status": "UNKNOWN", "reason": "missing-receipt"})
    return rows


def verify_saved_index(path):
    """Check original saved gzip/raw digest claims without regenerating outputs."""
    path = Path(path)
    index = load(path)
    rows = []
    for record in index.get("files", []):
        target = (path.parent / record["file"]).resolve()
        if not target.is_relative_to(path.parent.resolve()):
            rows.append({"file": record["file"], "status": "FAIL", "reason": "outside-root"})
            continue
        if not target.is_file():
            rows.append({"file": record["file"], "status": "UNKNOWN"})
            continue
        data = target.read_bytes()
        expected = record.get("gzipSha256", record.get("sha256"))
        ok = expected is not None and sha256(data) == expected
        if "rawSha256" in record:
            raw = gzip.decompress(data)
            ok = ok and sha256(raw) == record["rawSha256"]
            if "rawBytes" in record:
                ok = ok and len(raw) == record["rawBytes"]
        rows.append({"file": record["file"], "status": "MATCH" if ok else "FAIL"})
    return rows


def check_controls(fixtures, expectations):
    """Fixture subjects and literal expected outcomes are stored separately."""
    rows = []
    for case in load(fixtures):
        actual = verify_receipts(case["subject"], Path(fixtures).parent,
                                 expectations["controlPins"])
        statuses = [row["status"] for row in actual]
        rows.append({"id": case["id"], "actual": statuses,
                     "expected": expectations["controls"][case["id"]],
                     "ok": statuses == expectations["controls"][case["id"]]})
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    inspect = sub.add_parser("zip")
    inspect.add_argument("path")
    saved = sub.add_parser("saved-index")
    saved.add_argument("path")
    verify = sub.add_parser("receipts")
    verify.add_argument("manifest")
    verify.add_argument("root")
    verify.add_argument("expectations")
    controls = sub.add_parser("controls")
    controls.add_argument("fixtures")
    controls.add_argument("expectations")
    args = parser.parse_args()
    try:
        if args.command == "zip":
            result = inspect_zip(args.path)
        elif args.command == "saved-index":
            result = verify_saved_index(args.path)
        elif args.command == "receipts":
            result = verify_receipts(load(args.manifest), args.root, load(args.expectations))
        else:
            result = check_controls(args.fixtures, load(args.expectations))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if isinstance(result, list) and any(row.get("status") == "FAIL" or
                                           row.get("ok") is False for row in result):
            return 1
    except (OSError, ValueError, KeyError, TypeError, IndexError, AttributeError,
            struct.error, zipfile.BadZipFile) as error:
        print(json.dumps({"status": "UNKNOWN", "error": str(error)}))
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
