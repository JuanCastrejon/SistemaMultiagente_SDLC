// v1.1.0 published the governed template baseline.
// It is represented as a migration target so upgrades can traverse 1.0.0 -> 1.2.0
// and 1.1.0 -> 1.2.0 consistently.
export function up() {
  return {
    ".sdlc/migrations/1.1.0-applied.txt": "Migration 1.1.0 applied by SistemaMultiagente_SDLC.\ngenerated-by-sdlc\n"
  };
}
