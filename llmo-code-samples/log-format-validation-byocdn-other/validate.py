#!/usr/bin/env python3
"""Validate BYOCDN-Other JSON Lines logs against ingestion requirements."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


REQUIRED_FIELDS: dict[str, type] = {
    "timestamp": str,
    "host": str,
    "url": str,
    "request_method": str,
    "request_user_agent": str,
    "request_referer": str,
    "response_status": int,
    "response_content_type": str,
    "time_to_first_byte": int,
}

ISO_8601_UTC_Z_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$"
)
UPLOAD_PATH_RE = re.compile(r"/byocdn-other/(\d{4})/(\d{2})/(\d{2})(?:/|$)")


@dataclass
class ValidationIssue:
    line_number: int
    message: str


def is_iso8601_utc_z(value: str) -> bool:
    """Return True if value is ISO 8601 UTC string ending in Z."""
    if not ISO_8601_UTC_Z_RE.match(value):
        return False
    try:
        dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def _is_int_not_bool(value: Any) -> bool:
    # bool is a subclass of int in Python; reject True/False explicitly.
    return isinstance(value, int) and not isinstance(value, bool)


def is_valid_url(value: str) -> bool:
    """Return True when the URL includes a path, as a relative or full URL."""
    parsed = urlparse(value)
    has_origin = bool(parsed.scheme or parsed.netloc)

    if has_origin and not (parsed.scheme and parsed.netloc):
        return False
    if not has_origin and not value.startswith("/"):
        return False
    if not parsed.path or not parsed.path.startswith("/"):
        return False
    if parsed.fragment:
        return False

    return True


def validate_record(record: dict[str, Any], line_number: int) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []

    missing = [field for field in REQUIRED_FIELDS if field not in record]
    if missing:
        issues.append(
            ValidationIssue(
                line_number, f"Missing required fields: {', '.join(sorted(missing))}"
            )
        )

    for field, expected_type in REQUIRED_FIELDS.items():
        if field not in record:
            continue

        value = record[field]
        if expected_type is int:
            if not _is_int_not_bool(value):
                issues.append(
                    ValidationIssue(
                        line_number,
                        f"Field '{field}' must be integer, got {type(value).__name__}",
                    )
                )
        elif not isinstance(value, expected_type):
            issues.append(
                ValidationIssue(
                    line_number,
                    f"Field '{field}' must be {expected_type.__name__}, got {type(value).__name__}",
                )
            )

    if "timestamp" in record and isinstance(record.get("timestamp"), str):
        if not is_iso8601_utc_z(record["timestamp"]):
            issues.append(
                ValidationIssue(
                    line_number,
                    "Field 'timestamp' must be an ISO 8601 UTC string like 2025-02-01T23:00:05Z",
                )
            )

    if "url" in record and isinstance(record.get("url"), str):
        if not is_valid_url(record["url"]):
            issues.append(
                ValidationIssue(
                    line_number,
                    "Field 'url' must include a path. Query parameters should be included when present. Full URLs are acceptable but not required.",
                )
            )

    if "time_to_first_byte" in record and _is_int_not_bool(
        record.get("time_to_first_byte")
    ):
        if record["time_to_first_byte"] < 0:
            issues.append(
                ValidationIssue(
                    line_number,
                    "Field 'time_to_first_byte' must be >= 0 milliseconds",
                )
            )

    return issues


def validate_jsonl_file(path: Path) -> tuple[int, int, list[ValidationIssue]]:
    line_count = 0
    valid_count = 0
    issues: list[ValidationIssue] = []

    with path.open("r", encoding="utf-8") as handle:
        for idx, raw_line in enumerate(handle, start=1):
            line_count += 1
            line = raw_line.rstrip("\n")
            if not line.strip():
                issues.append(
                    ValidationIssue(
                        idx, "Empty line (expected one JSON object per line)"
                    )
                )
                continue

            try:
                payload = json.loads(line)
            except json.JSONDecodeError as exc:
                issues.append(ValidationIssue(idx, f"Malformed JSON: {exc.msg}"))
                continue

            if not isinstance(payload, dict):
                issues.append(
                    ValidationIssue(
                        idx,
                        f"Top-level value must be JSON object, got {type(payload).__name__}",
                    )
                )
                continue

            record_issues = validate_record(payload, idx)
            if record_issues:
                issues.extend(record_issues)
            else:
                valid_count += 1

    return line_count, valid_count, issues


def validate_upload_path(upload_path: str) -> str | None:
    """Validate a full S3 key/prefix containing IMSOrg/raw/byocdn-other/yyyy/mm/dd."""
    match = UPLOAD_PATH_RE.search(upload_path)
    if not match:
        return (
            "Upload path check failed: expected a full S3 key/prefix containing "
            "IMSOrg/raw/byocdn-other/yyyy/mm/dd/."
        )

    year, month, day = match.groups()
    try:
        dt.date(int(year), int(month), int(day))
    except ValueError:
        return f"Upload path check failed: invalid date segment {year}/{month}/{day}."

    return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Validate BYOCDN Other JSON Lines logs for required schema, strict types, "
            "and an optional full S3 upload path structure."
        )
    )
    parser.add_argument("log_file", help="Path to newline-delimited JSON log file.")
    parser.add_argument(
        "--upload-path",
        help=(
            "Optional full S3 key/prefix to validate, expected to include the IMS Org "
            'segment and raw/byocdn-other/yyyy/mm/dd/, e.g. '
            '"ABC123AdobeOrg/raw/byocdn-other/2025/02/01/logs.jsonl".'
        ),
    )
    args = parser.parse_args()

    path = Path(args.log_file)
    if not path.exists():
        print(f"ERROR: File does not exist: {path}", file=sys.stderr)
        return 2
    if not path.is_file():
        print(f"ERROR: Not a file: {path}", file=sys.stderr)
        return 2

    total, valid, issues = validate_jsonl_file(path)

    print(f"Validated file: {path}")
    print(f"Total lines: {total}")
    print(f"Valid lines: {valid}")
    print(f"Invalid lines: {len({issue.line_number for issue in issues})}")

    if args.upload_path:
        path_issue = validate_upload_path(args.upload_path)
        if path_issue:
            print(f"[UPLOAD PATH] {path_issue}")
            issues.append(ValidationIssue(0, path_issue))
        else:
            print("[UPLOAD PATH] OK")

    if issues:
        issues_by_line: dict[int, list[str]] = defaultdict(list)
        for issue in issues:
            issues_by_line[issue.line_number].append(issue.message)

        print("\nInvalid log entries:")
        for line_number in sorted(issues_by_line):
            reasons = "; ".join(issues_by_line[line_number])
            prefix = f"line {line_number}" if line_number > 0 else "path"
            print(f" - {prefix} is invalid: {reasons}")
        print("\nValidation completed with invalid entries.")
        return 1

    print("All checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
