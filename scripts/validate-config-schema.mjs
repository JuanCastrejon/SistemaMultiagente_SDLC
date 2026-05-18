import { readFileSync } from "node:fs";
import { validateConfigShape } from "../src/render.js";

const config = JSON.parse(readFileSync(new URL("../sdlc.config.example.json", import.meta.url), "utf8"));
const errors = validateConfigShape(config);

if (errors.length > 0) {
  console.error("Config schema validation: FAIL");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Config schema validation: PASS");
