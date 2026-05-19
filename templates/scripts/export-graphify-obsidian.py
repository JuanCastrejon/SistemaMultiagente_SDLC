from __future__ import annotations

import argparse
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--graph", required=True)
parser.add_argument("--output-dir", default="${VAULT_PATH}/graphify/${PROJECT_SLUG}")
args = parser.parse_args()
output = Path(args.output_dir)
output.mkdir(parents=True, exist_ok=True)
(output / "README.md").write_text("# Graphify export\n\nDerivado de graphify-out. No editar como fuente de verdad.\n", encoding="utf-8")
print(f"Export placeholder written to {output}")
