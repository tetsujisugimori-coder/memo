#!/usr/bin/env python3
"""Independent Draft 2020-12 oracle. Only reads full CLI process records."""
from __future__ import annotations
import json
import math
import pathlib
from jsonschema import Draft202012Validator

ROOT = pathlib.Path(__file__).resolve().parents[4]
COLLECTOR = ROOT / "design/idb-incomplete-stop/collector"
OUTPUT = ROOT / "r2-cli-review-output"
with (COLLECTOR / "input.schema.json").open(encoding="utf-8") as fh:
    input_schema = json.load(fh)
with (COLLECTOR / "result.schema.json").open(encoding="utf-8") as fh:
    result_schema = json.load(fh)
Draft202012Validator.check_schema(input_schema)
Draft202012Validator.check_schema(result_schema)
input_validator = Draft202012Validator(input_schema)
result_validator = Draft202012Validator(result_schema)

def strict_json(text: str):
    def reject_constant(token: str):
        raise ValueError("JSON nonfinite token: " + token)
    return json.loads(text, parse_constant=reject_constant)

def has_nonfinite(value):
    if isinstance(value, bool) or value is None:
        return False
    if isinstance(value, float):
        return not math.isfinite(value)
    if isinstance(value, dict):
        return any(has_nonfinite(v) for v in value.values())
    if isinstance(value, list):
        return any(has_nonfinite(v) for v in value)
    return False

checks = []
input_checks = []
for record_file in sorted(OUTPUT.glob("*.json")):
    if not (record_file.name.startswith("new-") or record_file.name.startswith("old-")):
        continue
    if record_file.name == "new-missing-file.json":
        continue
    record = strict_json(record_file.read_text(encoding="utf-8"))
    stdout = record["stdout"]
    result = strict_json(stdout)
    errors = list(result_validator.iter_errors(result))
    if errors:
        raise AssertionError(record_file.name + " result schema errors: " +
                             str([(list(e.path), e.message) for e in errors[:3]]))
    if result["exitCode"] != record["processStatus"]:
        raise AssertionError(record_file.name + " inconsistent JSON/process exit")
    checks.append(record_file.name)
    if record["phase"] != "new" or record["repeat"]:
        continue
    source = OUTPUT / ("input-" + record["id"] + ".json")
    input_text = source.read_text(encoding="utf-8")
    try:
        data = strict_json(input_text)
        valid = not has_nonfinite(data) and input_validator.is_valid(data)
    except ValueError:
        valid = False
    expected_input_valid = record["id"].startswith("clock-") or record["id"] in {
        "normal", "mixed-clock-reversed-events",
        "valid-schema-but-gap-8192", "mismatched-external-hash"
    }
    if record["id"].startswith("invalid-"):
        expected_input_valid = False
    if record["id"] == "duplicate-json-key":
        # Python accepts duplicate object keys: this is a separate Collector parse
        # integrity contract, not a JSON Schema assertion.
        continue
    if valid != expected_input_valid:
        raise AssertionError(record_file.name + " independent input schema disagreement: " +
                             str((valid, expected_input_valid)))
    input_checks.append(record["id"])
if not checks or len(input_checks) < 25:
    raise AssertionError("coverage too small: " + str((len(checks), len(input_checks))))
summary = {
    "resultSchemaChecks": len(checks),
    "inputSchemaChecks": len(input_checks),
    "dialect": "Draft 2020-12",
    "independentOracle": "python-jsonschema",
    "outcome": "PASS",
}
(OUTPUT / "python-schema-oracle.json").write_text(
    json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary))
