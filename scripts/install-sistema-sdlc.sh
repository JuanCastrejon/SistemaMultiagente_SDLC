#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TARGET=""
MODE="greenfield"
PROJECT_NAME=""
PROJECT_SLUG=""
DRY_RUN=""
JSON_FLAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)       TARGET="$2";       shift 2 ;;
    --mode)         MODE="$2";         shift 2 ;;
    --project-name) PROJECT_NAME="$2"; shift 2 ;;
    --project-slug) PROJECT_SLUG="$2"; shift 2 ;;
    --dry-run)      DRY_RUN="--dry-run"; shift ;;
    --json)         JSON_FLAG="--json";  shift ;;
    *) echo "Opcion desconocida: $1" >&2; exit 1 ;;
  esac
done

ARGS=("$REPO_ROOT/bin/sdlc.js" install --mode "$MODE")
[[ -n "$TARGET" ]]       && ARGS+=(--target "$TARGET")
[[ -n "$PROJECT_NAME" ]] && ARGS+=(--project-name "$PROJECT_NAME")
[[ -n "$PROJECT_SLUG" ]] && ARGS+=(--project-slug "$PROJECT_SLUG")
[[ -n "$DRY_RUN" ]]      && ARGS+=("$DRY_RUN")
[[ -n "$JSON_FLAG" ]]    && ARGS+=("$JSON_FLAG")

node "${ARGS[@]}"
