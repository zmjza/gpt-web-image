#!/usr/bin/env python3
"""Validate the evidence gates in liran_docs/09-真机实测.md.

This is a conservative document gate, not a replacement for real-device work.
It only checks that the required rows contain an explicit result and that the
current commit/CI evidence and declared scope boundaries are recorded.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


REQUIRED_ROWS = (
    "2.1",
    "2.2",
    "2.3",
    "3.1",
    "3.2",
    "3.3",
    "3.4",
    "3.5",
    "4.1",
    "4.2",
    "5.1",
    "5.2",
    "5.3",
    "5.4",
    "MP-1",
    "MP-2",
    "MP-3",
    "MP-4",
    "MP-5",
    "MP-6",
    "IMG-1",
    "IMG-2",
    "IMG-3",
    "IMG-4",
    "IMG-5",
    "IMG-6",
)

EXEMPT_MARKERS = ("待验收", "待补证", "未验证", "未执行", "受阻")
EVIDENCE_WORDS = ("真实", "隔离", "通过", "绿色", "success", "completed")


def parse_rows(markdown: str) -> dict[str, list[str]]:
    rows: dict[str, list[str]] = {}
    for line in markdown.splitlines():
        if not line.lstrip().startswith("|"):
            continue
        fields = [field.strip() for field in line.strip().strip("|").split("|")]
        if not fields or fields[0] in {"---", "步骤", "项目"}:
            continue
        key = fields[0]
        if key in REQUIRED_ROWS:
            rows.setdefault(key, []).append(fields)
    return rows


def current_commit() -> str | None:
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    value = completed.stdout.strip()
    return value if re.fullmatch(r"[0-9a-f]{40}", value) else None


def evidence_commit(markdown: str) -> str | None:
    match = re.search(r"当前提交\s*[：:]\s*`?([0-9a-f]{40})`?", markdown, re.I)
    return match.group(1).lower() if match else None


def is_current_or_ancestor(commit: str, head: str) -> bool:
    if commit == head:
        return True
    try:
        completed = subprocess.run(
            ["git", "merge-base", "--is-ancestor", commit, head],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return False
    return completed.returncode == 0


def validate(markdown: str, strict: bool) -> tuple[list[str], list[str], dict[str, object]]:
    rows = parse_rows(markdown)
    errors: list[str] = []
    warnings: list[str] = []

    for key in REQUIRED_ROWS:
        entries = rows.get(key, [])
        if not entries:
            errors.append(f"缺少必验条目：{key}")
            continue
        if len(entries) > 1:
            errors.append(f"必验条目重复：{key}")
            continue
        result = entries[0][-1] if entries[0] else ""
        if key.startswith(("MP-", "IMG-")):
            if any(marker in result for marker in EXEMPT_MARKERS):
                errors.append(f"{key} 仍包含未完成/豁免标记：{result}")
            if not any(word in result for word in EVIDENCE_WORDS):
                errors.append(f"{key} 缺少可识别的证据描述")
        elif "✅" not in result:
            errors.append(f"{key} 没有明确通过标记：{result}")

    if strict:
        commit = current_commit()
        recorded = evidence_commit(markdown)
        if commit and not recorded:
            errors.append("文档未记录可验证的当前提交")
        elif commit and recorded and not is_current_or_ancestor(recorded, commit):
            errors.append(f"文档证据提交不是当前提交或其祖先：{recorded}（当前 HEAD：{commit}）")
        elif not commit:
            warnings.append("无法读取当前 Git 提交，未执行提交一致性校验")

        if not re.search(r"当前提交\s*[：:]\s*`?[0-9a-f]{40}`?", markdown, re.I):
            errors.append("缺少“当前提交”证据行")
        if not re.search(r"Windows\s*(?:Actions|CI).*?run\s*`?\d+`?", markdown, re.I | re.S):
            errors.append("缺少当前 Windows Actions run 证据")
        if not re.search(r"(?:completed/success|状态\s*[：:]\s*`?success`?)", markdown, re.I):
            errors.append("Windows Actions 未记录成功状态")
        for marker in ("macOS 真机", "隔离创建/导入", "页面样式"):
            if marker not in markdown:
                errors.append(f"缺少范围证据：{marker}")
        if "4.3" not in markdown or "4.4" not in markdown or "不纳入本轮验收" not in markdown:
            errors.append("未明确记录 4.3/4.4 的本轮范围")
        if "Windows x64" not in markdown or "豁免" not in markdown or "未执行" not in markdown:
            errors.append("未明确记录 Windows x64 用户真机豁免")
    else:
        warnings.extend(errors)

    summary = {
        "required": len(REQUIRED_ROWS),
        "found": sum(1 for key in REQUIRED_ROWS if key in rows),
        "errors": len(errors),
        "warnings": len(warnings),
        "strict": strict,
    }
    return errors, warnings, summary


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (OSError, ValueError):
                pass
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checklist", type=Path, help="Markdown real-test checklist")
    parser.add_argument("--require-complete", action="store_true", help="fail unless all in-scope evidence gates pass")
    parser.add_argument("--json", action="store_true", help="emit a machine-readable result")
    args = parser.parse_args()

    try:
        markdown = args.checklist.read_text(encoding="utf-8")
    except OSError as error:
        message = f"无法读取清单：{error}"
        if args.json:
            print(json.dumps({"ok": False, "errors": [message]}, ensure_ascii=False))
        else:
            print(message, file=sys.stderr)
        return 2

    errors, warnings, summary = validate(markdown, args.require_complete)
    result = {"ok": not errors, **summary, "errors": errors, "warnings": warnings}
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(f"real-test-checklist: {'PASS' if not errors else 'FAIL'} ({summary['found']}/{summary['required']} required rows)")
        for message in errors:
            print(f"ERROR: {message}")
        if not args.require_complete:
            for message in warnings:
                print(f"WARN: {message}")
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
