"""Read-only evidence checks. No network, subprocess, extraction, or browser imports.

An integrity match is not historical BUILD_BINDING or runtime identity proof.
Python 3 standard library only. JSON output goes to stdout; inputs are never written.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path, PureWindowsPath
import re
import struct
import zipfile
import zlib


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


def resolve_evidence_path(root, name):
    """Use portable relative spelling, then resolve aliases before any byte read."""
    if (not isinstance(name, str) or not name or "\\" in name or ":" in name
            or PureWindowsPath(name).drive or PureWindowsPath(name).root):
        raise ValueError("invalid-path")
    parts = [part for part in name.split("/") if part not in ("", ".")]
    if not parts or any(part == ".." or part.endswith((".", " ")) or
                        re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", part)
                        for part in parts):
        raise ValueError("invalid-path")
    try:
        path = (root / Path(*parts)).resolve()
    except (OSError, RuntimeError) as error:
        raise ValueError("invalid-path") from error
    if not path.is_relative_to(root):
        raise ValueError("duplicate-or-outside-root")
    return path, os.path.normcase(str(path))


def verify_receipts(manifest, root, expectations):
    """Separate pinned expectations from the subject receipts and external bytes."""
    rows, seen = [], set()
    root = Path(root).resolve()
    if not isinstance(manifest, dict) or not isinstance(manifest.get("receipts"), list):
        return [{"status": "FAIL", "reason": "manifest-shape"}]
    pins = {}
    for name, values in expectations.get("files", {}).items():
        try:
            _, key = resolve_evidence_path(root, name)
        except ValueError as error:
            return [{"status": "FAIL", "reason": "expectation-" + str(error)}]
        if key in pins:
            return [{"status": "FAIL", "reason": "expectation-path-alias"}]
        pins[key] = (name, values)
    for receipt in manifest["receipts"]:
        if not isinstance(receipt, dict) or not isinstance(receipt.get("file"), str):
            rows.append({"status": "FAIL", "reason": "receipt-shape"})
            continue
        name = receipt["file"]
        row = {"file": name, "status": "MATCH", "reasons": [],
               "acquisition": "FAILED" if receipt.get("exitCode", 0) != 0 else "SUCCEEDED",
               "contentIntegrity": "NOT_CHECKED"}
        rows.append(row)
        try:
            path, key = resolve_evidence_path(root, name)
        except ValueError as error:
            row.update(status="FAIL", reasons=[str(error)])
            continue
        if key in seen:
            row.update(status="FAIL", reasons=["duplicate-or-outside-root"])
            continue
        seen.add(key)
        pinned = pins.get(key, (name, {}))[1]
        contradictions = [key for key, value in pinned.items()
                          if receipt.get(key) != value]
        if contradictions:
            row.update(status="FAIL", reasons=["pinned-" + key for key in contradictions])
            continue
        try:
            data = path.read_bytes() if path.is_file() else None
        except OSError:
            data = None
        if data is None:
            row.update(status="UNKNOWN", reasons=["unavailable-bytes"],
                       contentIntegrity="UNAVAILABLE")
            continue
        if receipt.get("sha256") != sha256(data) or receipt.get("size") != len(data):
            row.update(status="FAIL", reasons=["digest-or-size"], contentIntegrity="FAIL")
        else:
            row["contentIntegrity"] = "MATCH"
            if receipt.get("exitCode", 0) != 0:
                row.update(status="UNKNOWN", reasons=["acquisition-failed"])
    for missing in pins.keys() - seen:
        rows.append({"file": pins[missing][0], "status": "UNKNOWN", "reason": "missing-receipt"})
    return rows


def verify_saved_index(path, expectations=None, profile=None, *, index_override=...):
    """Check schema, an independently pinned file set, and stored gzip/raw bytes."""
    path = Path(path)
    index = load(path) if index_override is ... else index_override
    if not isinstance(index, dict):
        return [{"status": "FAIL", "reason": "index-shape"}]
    if "files" not in index:
        return [{"status": "UNKNOWN", "reason": "index-files-missing"}]
    if not isinstance(index["files"], list):
        return [{"status": "FAIL", "reason": "index-files-shape"}]
    if not index["files"]:
        return [{"status": "UNKNOWN", "reason": "index-files-empty"}]
    expectations = expectations if expectations is not None else load(
        Path(__file__).with_name("expectations.json"))
    profile = profile or path.parent.parent.name
    pin = expectations.get("savedIndices", {}).get(profile, {}).get("files", {})
    root = path.parent.resolve()
    pins, seen = {}, set()
    for name, values in pin.items():
        _, key = resolve_evidence_path(root, name)
        if key in pins:
            return [{"status": "FAIL", "reason": "expectation-path-alias"}]
        pins[key] = (name, values)
    rows = []
    if not pins:
        rows.append({"status": "UNKNOWN", "reason": "index-profile-required"})
    for record in index["files"]:
        row = {"status": "MATCH"}
        rows.append(row)
        if not isinstance(record, dict):
            row.update(status="FAIL", reason="index-record-shape")
            continue
        pinned = {}
        if "file" in record:
            row["file"] = record["file"]
            try:
                target, key = resolve_evidence_path(root, record["file"])
            except ValueError as error:
                row.update(status="FAIL", reason=str(error))
                continue
            if key in seen:
                row.update(status="FAIL", reason="duplicate-or-outside-root")
                continue
            seen.add(key)
            if pins and key not in pins:
                row.update(status="FAIL", reason="unexpected-index-file")
                continue
            pinned = pins.get(key, (None, {}))[1]
        digest_fields = [field for field in ("sha256", "gzipSha256", "rawSha256")
                         if field in record]
        if any(not isinstance(record[field], str) or
               not re.fullmatch(r"[0-9a-f]{64}", record[field]) for field in digest_fields):
            row.update(status="FAIL", reason="index-digest-format")
            continue
        if "rawBytes" in record and (type(record["rawBytes"]) is not int or record["rawBytes"] < 0):
            row.update(status="FAIL", reason="index-size-format")
            continue
        if "sha256" in record and "gzipSha256" in record and record["sha256"] != record["gzipSha256"]:
            row.update(status="FAIL", reason="index-digest-conflict")
            continue
        missing = [field for field in pinned if field not in record]
        conflicts = [field for field in pinned if field in record and record[field] != pinned[field]]
        if conflicts:
            row.update(status="FAIL", reason="pinned-index-" + conflicts[0])
            continue
        if ("file" not in record or missing or
                not any(field in record for field in ("sha256", "gzipSha256")) or
                ("rawBytes" in record and "rawSha256" not in record)):
            row.update(status="UNKNOWN", reason="index-record-incomplete")
            continue
        try:
            data = target.read_bytes() if target.is_file() else None
        except OSError:
            data = None
        if data is None:
            row.update(status="UNKNOWN", reason="unavailable-bytes")
            continue
        expected = record.get("gzipSha256", record.get("sha256"))
        ok = sha256(data) == expected
        if "rawSha256" in record:
            try:
                raw = gzip.decompress(data)
            except (OSError, EOFError, zlib.error):
                row.update(status="FAIL", reason="raw-decode")
                continue
            ok = ok and sha256(raw) == record["rawSha256"]
            if "rawBytes" in record:
                ok = ok and len(raw) == record["rawBytes"]
        if not ok:
            row.update(status="FAIL", reason="digest-or-size")
    for missing in pins.keys() - seen:
        rows.append({"file": pins[missing][0], "status": "UNKNOWN", "reason": "missing-index-file"})
    return rows


def check_controls(fixtures, expectations):
    """Fixture subjects and literal expected outcomes are stored separately."""
    rows = []
    for case in load(fixtures):
        if case.get("kind", "receipts") == "saved-index":
            actual = verify_saved_index(fixtures, expectations, case.get("profile"),
                                        index_override=case["subject"])
        else:
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
    saved.add_argument("--expectations")
    saved.add_argument("--profile")
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
            result = verify_saved_index(args.path, load(args.expectations) if args.expectations else None,
                                        args.profile)
        elif args.command == "receipts":
            result = verify_receipts(load(args.manifest), args.root, load(args.expectations))
        else:
            result = check_controls(args.fixtures, load(args.expectations))
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if isinstance(result, list) and any(row.get("status") == "FAIL" or
                                           row.get("ok") is False for row in result):
            return 1
        if args.command == "saved-index" and any(row.get("status") == "UNKNOWN" for row in result):
            return 2
    except (OSError, ValueError, KeyError, TypeError, IndexError, AttributeError,
            struct.error, zipfile.BadZipFile) as error:
        print(json.dumps({"status": "UNKNOWN", "error": str(error)}))
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
