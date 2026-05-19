from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


@dataclass
class SourceFile:
    path: Path
    source: str
    text: str


def slugify(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "session"


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def read_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {path}")
    config = load_json(path)
    config.setdefault("projectSlug", "{{project.slug}}")
    return config


def iter_text_files(root: Path) -> Iterable[Path]:
    if not root.exists():
        return []
    return sorted(
        [
            p
            for p in root.rglob("*")
            if p.is_file() and p.suffix.lower() in {".md", ".txt", ".json", ".jsonl"}
        ]
    )


def collect_sources(config: dict[str, Any]) -> list[SourceFile]:
    sources: list[SourceFile] = []
    export_dirs = config.get("exportDirs", {})
    for name, raw_dir in sorted(export_dirs.items()):
        if not raw_dir:
            continue
        root = Path(str(raw_dir)).expanduser()
        for path in iter_text_files(root):
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            sources.append(SourceFile(path=path, source=name, text=text))

    codex = config.get("sources", {}).get("codex", {})
    for raw_dir in codex.get("sessionRoots", []) if codex.get("enabled", False) else []:
        root = Path(str(raw_dir)).expanduser()
        for path in iter_text_files(root):
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            sources.append(SourceFile(path=path, source="codex", text=text))
    return sources


def summarize(text: str, max_chars: int = 1800) -> str:
    clean = re.sub(r"\s+", " ", text).strip()
    if len(clean) <= max_chars:
        return clean
    return clean[:max_chars].rstrip() + "..."


def build_note(source: SourceFile, project_slug: str) -> tuple[str, str]:
    stat = source.path.stat()
    timestamp = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    title = source.path.stem
    note_slug = slugify(f"{source.source}-{title}-{int(stat.st_mtime)}")
    content = [
        "---",
        "generated_by: claude-to-obsidian",
        f"project: {project_slug}",
        f"source: {source.source}",
        f"source_path: {source.path.as_posix()}",
        f"source_modified_at: {timestamp}",
        "---",
        "",
        f"# {title}",
        "",
        "## Summary",
        "",
        summarize(source.text),
        "",
        "## Raw Source",
        "",
        "```text",
        source.text[:12000],
        "```",
        "",
    ]
    return f"{note_slug}.md", "\n".join(content)


def write_notes(config: dict[str, Any], sources: list[SourceFile], apply: bool) -> dict[str, Any]:
    project_slug = str(config.get("projectSlug") or "{{project.slug}}")
    vault_root = Path(str(config.get("vaultRoot") or "{{obsidian.memoryWorkspace}}/vault")).expanduser()
    target_dir = vault_root / project_slug / "sessions"
    results: list[dict[str, str]] = []

    for source in sources:
        file_name, content = build_note(source, project_slug)
        target = target_dir / file_name
        results.append({"source": str(source.path), "target": str(target)})
        if apply:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
    return {"target_dir": str(target_dir), "notes": results}


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert exported AI sessions into Obsidian-ready notes.")
    parser.add_argument("--config", default="scripts/obsidian-memory.config.local.json")
    parser.add_argument("--apply", action="store_true", help="Write notes. Default is dry-run.")
    parser.add_argument("--dry-run", action="store_true", help="Force dry-run.")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    apply = bool(args.apply and not args.dry_run)
    config = read_config(Path(args.config))
    sources = collect_sources(config)
    output = write_notes(config, sources, apply=apply)
    result = {
        "status": "ok",
        "dry_run": not apply,
        "sources": len(sources),
        **output,
    }
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"claude-to-obsidian: sources={len(sources)} dry_run={not apply} target={output['target_dir']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
