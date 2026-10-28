#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const templateModule = "github.com/freygold/go-boilerplate";
const templateCommand = join(root, "apps/backend/cmd/go-boilerplate");
const creationScriptUrl =
  "https://raw.githubusercontent.com/FreyGold/go-boilerplate/refs/heads/main/scripts/create-project.sh";
const usage =
  "Usage: node scripts/init-project.mjs <name> [--module <module-path>]";
const excludedEntries = new Set([
  ".git",
  ".agents",
  ".codex",
  ".aws",
  ".cache",
  ".next",
  ".turbo",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "out",
  "coverage",
  "tmp",
]);
const excludedFiles = new Set([
  relative(root, fileURLToPath(import.meta.url)),
  join("scripts", "init-project.test.mjs"),
  join("scripts", "create-project.sh"),
  join("scripts", "create-project.test.mjs"),
]);

function parseArguments(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(usage);
    return null;
  }

  if (args.length !== 1 && !(args.length === 3 && args[1] === "--module")) {
    throw new Error(usage);
  }

  const [name] = args;
  if (name.length > 63 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(
      "The name must start with a lowercase letter and contain at most 63 lowercase letters, digits, or single hyphens.",
    );
  }

  const modulePath = args[2] ?? `github.com/freygold/${name}`;
  const modulePart = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;
  const parts = modulePath.split("/");
  const domain = parts[0];
  const last = parts.at(-1);
  const version = /^v([0-9.]+)$/.exec(last);
  const gopkgVersion = /\.v([0-9]+)(-unstable)?$/.exec(last);
  const invalidPart = parts.some(
    (part) =>
      !modulePart.test(part) ||
      part.endsWith(".") ||
      part.includes("..") ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) ||
      /~[0-9]+$/.test(part.split(".")[0]),
  );
  if (
    parts.length < 2 ||
    !domain.includes(".") ||
    !/^[a-z0-9][a-z0-9.-]*$/.test(domain) ||
    invalidPart ||
    (version &&
      (version[1].startsWith("0") ||
        version[1] === "1" ||
        version[1].includes("."))) ||
    (domain === "gopkg.in" &&
      (!gopkgVersion ||
        (gopkgVersion[1].startsWith("0") &&
          (gopkgVersion[1] !== "0" || gopkgVersion[2]))))
  ) {
    throw new Error(
      "The module path must have valid path segments, such as github.com/your-user/my-project.",
    );
  }

  return { name, modulePath };
}

function checkTemplate() {
  const packageJson = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  const goMod = readFileSync(join(root, "apps/backend/go.mod"), "utf8");
  if (
    packageJson.name !== "boilerplate" ||
    !goMod.split(/\r?\n/, 1).includes(`module ${templateModule}`) ||
    !existsSync(templateCommand)
  ) {
    throw new Error(
      "This project is already initialized or is missing template files.",
    );
  }
}

function makeReplacer(name, modulePath) {
  const title = name
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
  const envPrefix = name.replaceAll("-", "_").toUpperCase();
  const pattern =
    /https:\/\/raw\.githubusercontent\.com\/FreyGold\/go-boilerplate\/refs\/heads\/main\/scripts\/create-project\.sh|github\.com\/freygold\/go-boilerplate|go[- ]boilerplate|boilerplate/gi;

  return (text) =>
    text.replace(pattern, (match) => {
      if (match.toLowerCase() === creationScriptUrl.toLowerCase()) return match;
      if (match.toLowerCase() === templateModule) return modulePath;
      if (match === match.toUpperCase()) return envPrefix;
      if (match[0] === match[0].toUpperCase()) return title;
      return name;
    });
}

function createPlan(replace) {
  const updates = [];
  const renames = [];
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

  function visit(directory) {
    const entries = readdirSync(directory, { withFileTypes: true });
    const names = new Map();

    for (const entry of entries) {
      const path = join(directory, entry.name);
      const excluded =
        excludedEntries.has(entry.name) ||
        excludedFiles.has(relative(root, path)) ||
        entry.isSymbolicLink();
      const newName = excluded ? entry.name : replace(entry.name);
      if (newName !== entry.name && existsSync(join(directory, newName))) {
        throw new Error(`Cannot rename ${path}: ${newName} already exists.`);
      }
      const previous = names.get(newName);
      if (previous !== undefined) {
        throw new Error(
          `Cannot rename ${path}: ${previous} and ${entry.name} would both become ${newName}.`,
        );
      }
      names.set(newName, entry.name);

      if (excluded) continue;

      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile()) {
        const original = readFileSync(path);
        if (!original.includes(0)) {
          let content;
          try {
            content = decoder.decode(original);
          } catch {
            content = null;
          }
          if (content !== null) {
            const updated = replace(content);
            if (updated !== content) updates.push({ path, content: updated });
          }
        }
      }

      if (newName !== entry.name) {
        renames.push({ from: path, to: join(directory, newName) });
      }
    }
  }

  visit(root);
  renames.sort((a, b) => b.from.split(sep).length - a.from.split(sep).length);
  return { updates, renames };
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args === null) return;

  checkTemplate();
  const plan = createPlan(makeReplacer(args.name, args.modulePath));
  for (const update of plan.updates) writeFileSync(update.path, update.content);
  for (const rename of plan.renames) renameSync(rename.from, rename.to);

  console.log(`Initialized ${args.name}.`);
  console.log(`Go module: ${args.modulePath}`);
  console.log(
    `Updated ${plan.updates.length} files and renamed ${plan.renames.length} paths.`,
  );
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
