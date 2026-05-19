export function up(files = {}) {
  const extra = {
    ".sdlc/migrations/1.2.0-applied.txt": "Migration 1.2.0 applied by SistemaMultiagente_SDLC.\ngenerated-by-sdlc\n"
  };

  const configPath = ".sdlc/config.json";
  if (typeof files[configPath] === "string") {
    const config = JSON.parse(files[configPath]);
    if (!config.scale) {
      config.scale = "feature";
    }
    config.frameworkVersion = "1.2.0";
    extra[configPath] = `${JSON.stringify(config, null, 2)}\n`;
  }

  return extra;
}
