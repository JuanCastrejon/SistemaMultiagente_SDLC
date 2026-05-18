import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "schemas",
  "sdlc.config.schema.json"
);

let _validate = null;

function getValidate() {
  if (_validate) return _validate;
  const ajv = new Ajv({ allErrors: true });
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  _validate = ajv.compile(schema);
  return _validate;
}

export function validateConfigShape(config) {
  const validate = getValidate();
  if (validate(config)) return [];
  return (validate.errors ?? []).map((err) => {
    const loc = err.instancePath || "(root)";
    return `${loc}: ${err.message}`;
  });
}
