from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


def slugify(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "node"


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def load_graph(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        return data
    raise ValueError(f"Graph must be a JSON object: {path}")


def node_id(node: dict[str, Any]) -> str:
    for key in ("id", "path", "name", "label"):
        if node.get(key):
            return str(node[key])
    return "unknown"


def node_title(node: dict[str, Any]) -> str:
    for key in ("label", "name", "path", "id"):
        if node.get(key):
            return str(node[key])
    return "Untitled node"


def write_markdown(output_dir: Path, graph: dict[str, Any], graph_path: Path) -> dict[str, int]:
    output_dir.mkdir(parents=True, exist_ok=True)
    nodes = as_list(graph.get("nodes"))
    edges = as_list(graph.get("edges"))
    index_lines = [
        "# Graphify export",
        "",
        f"Project: {{project.slug}}",
        f"Source graph: `{graph_path.as_posix()}`",
        "",
        "## Summary",
        "",
        f"- Nodes: {len(nodes)}",
        f"- Edges: {len(edges)}",
        "",
        "## Nodes",
        "",
    ]

    for node in nodes:
        if not isinstance(node, dict):
            continue
        nid = node_id(node)
        title = node_title(node)
        file_name = f"{slugify(nid)}.md"
        index_lines.append(f"- [[{file_name[:-3]}|{title}]]")
        metadata = json.dumps(node, indent=2, ensure_ascii=False)
        note = [
            "---",
            "generated_by: graphify",
            f"project: {{project.slug}}",
            f"node_id: {nid}",
            "---",
            "",
            f"# {title}",
            "",
            "## Metadata",
            "",
            "```json",
            metadata,
            "```",
            "",
            "## Connected edges",
            "",
        ]
        connected = [
            edge
            for edge in edges
            if isinstance(edge, dict)
            and (str(edge.get("source")) == nid or str(edge.get("target")) == nid)
        ]
        if connected:
            for edge in connected:
                note.append(f"- `{edge.get('source')}` -> `{edge.get('target')}`")
        else:
            note.append("- No connected edges in graph export.")
        (output_dir / file_name).write_text("\n".join(note) + "\n", encoding="utf-8")

    (output_dir / "README.md").write_text("\n".join(index_lines) + "\n", encoding="utf-8")
    return {"nodes": len(nodes), "edges": len(edges)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Export graphify JSON into Obsidian-ready markdown notes.")
    parser.add_argument("--graph", required=True, help="Path to graphify-out/graph.json.")
    parser.add_argument("--output-dir", required=True, help="Destination directory inside the memory vault.")
    parser.add_argument("--json", action="store_true", help="Print structured JSON output.")
    args = parser.parse_args()

    graph_path = Path(args.graph).resolve()
    output_dir = Path(args.output_dir).resolve()
    graph = load_graph(graph_path)
    summary = write_markdown(output_dir, graph, graph_path)
    result = {"status": "ok", "output_dir": str(output_dir), **summary}
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"Graphify export written to {output_dir} ({summary['nodes']} nodes, {summary['edges']} edges)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
