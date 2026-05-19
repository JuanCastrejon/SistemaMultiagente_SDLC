import fs from "node:fs";
import path from "node:path";
import { listFiles } from "../src/file-utils.js";

const root = process.cwd();
const checkUrls = process.argv.includes("--check-urls");
const mdFiles = listFiles(root).filter((file) => file.endsWith(".md") && !file.includes("node_modules/"));
const errors = [];

function stripCodeBlocks(content) {
  return content.replace(/```[\s\S]*?```/g, "");
}

function shouldSkip(target) {
  return (
    target.startsWith("#") ||
    target.startsWith("mailto:") ||
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.includes("{{") ||
    target.includes("<") ||
    target.includes(">")
  );
}

for (const file of mdFiles) {
  const content = stripCodeBlocks(fs.readFileSync(path.join(root, file), "utf8"));
  const linkPattern = /(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const raw = match[1];
    if (shouldSkip(raw)) {
      if (!checkUrls && /^https?:\/\//.test(raw)) continue;
      continue;
    }
    const clean = raw.split("#")[0];
    if (!clean) continue;
    const base = path.dirname(path.join(root, file));
    const resolved = path.resolve(base, clean);
    if (!resolved.startsWith(root) || !fs.existsSync(resolved)) {
      errors.push(`${file}: broken link ${raw}`);
    }
  }
}

if (errors.length > 0) {
  console.error("Docs links validation: FAIL");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Docs links validation: PASS (${mdFiles.length} markdown files)`);
