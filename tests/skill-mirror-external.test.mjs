// ---------------------------------------------------------------------------
// `doctor` avisaba `skill-mirror-without-canonical` para CUALQUIER skill en un
// mirror (.claude/skills, .agents/skills, .windsurf/skills) sin carpeta
// hermana en `.github/skills` — sin consultar el manifiesto. Un consumidor con
// stack externo real (vercel, nestjs...) declarado via `externalCollections` o
// `crossMirrorSkills` en scripts/agent-skills.manifest.json quedaba con
// decenas de avisos permanentes indistinguibles de un espejo huerfano de
// verdad. Fix: 2.0.2.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");

function writeSkill(root, name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\n---\n`, "utf8");
}

function doctorFindings(target) {
  const out = spawnSync("node", [cli, "doctor", "--target", target, "--json"], { cwd: repoRoot, encoding: "utf8" });
  return JSON.parse(out.stdout).findings;
}

const target = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-skill-mirror-"));

// Canonica real, espejada normal: nunca deberia avisar.
writeSkill(path.join(target, ".github", "skills"), "commit");
writeSkill(path.join(target, ".claude", "skills"), "commit");

// Externa declarada via externalCollections: NO es huerfana.
writeSkill(path.join(target, ".claude", "skills"), "vercel-react-best-practices");

// Cross-mirror declarada via crossMirrorSkills hacia .agents/skills: NO es huerfana.
writeSkill(path.join(target, ".agents", "skills"), "nestjs-best-practices");

// Sin declarar en ningun lado: SI es huerfana, sigue avisando.
writeSkill(path.join(target, ".claude", "skills"), "huerfana-de-verdad");

fs.mkdirSync(path.join(target, "scripts"), { recursive: true });
fs.writeFileSync(
  path.join(target, "scripts", "agent-skills.manifest.json"),
  JSON.stringify(
    {
      externalCollections: [
        { source: "vercel-labs/agent-skills", skills: [{ name: "vercel-react-best-practices" }] }
      ],
      crossMirrorSkills: [
        { fromRoot: ".claude/skills", toRoots: [".agents/skills"], skills: ["nestjs-best-practices"] }
      ]
    },
    null,
    2
  ),
  "utf8"
);

const findings = doctorFindings(target);
const warnedPaths = findings.filter((f) => f.code === "skill-mirror-without-canonical").map((f) => f.path);

assert.ok(!warnedPaths.some((p) => p.includes("vercel-react-best-practices")), JSON.stringify(warnedPaths));
assert.ok(!warnedPaths.some((p) => p.includes("nestjs-best-practices")), JSON.stringify(warnedPaths));
assert.ok(warnedPaths.some((p) => p.includes("huerfana-de-verdad")), JSON.stringify(warnedPaths));

console.log("skill-mirror-external: PASS");

// --- manifiesto ilegible: no debe reventar doctor, solo dejar de eximir ----
const brokenTarget = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-skill-mirror-broken-"));
writeSkill(path.join(brokenTarget, ".github", "skills"), "commit");
writeSkill(path.join(brokenTarget, ".claude", "skills"), "huerfana-otra-vez");
fs.mkdirSync(path.join(brokenTarget, "scripts"), { recursive: true });
fs.writeFileSync(path.join(brokenTarget, "scripts", "agent-skills.manifest.json"), "{ esto no es json", "utf8");

const brokenFindings = doctorFindings(brokenTarget);
assert.ok(brokenFindings.some((f) => f.code === "skill-mirror-without-canonical" && f.path.includes("huerfana-otra-vez")));

console.log("skill-mirror-external manifiesto ilegible: PASS");
