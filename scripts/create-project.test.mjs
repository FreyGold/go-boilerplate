import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const isTemplate =
  JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name ===
    "boilerplate" &&
  existsSync(join(root, "apps/backend/cmd/go-boilerplate/main.go"));
const templateTest = isTemplate ? test : test.skip;
const repositoryUrl = "https://github.com/FreyGold/go-boilerplate.git";
const scriptUrl = pathToFileURL(join(root, "scripts/create-project.sh")).href;
const excluded = new Set([
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

function runGit(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), "create-project-test-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const upstream = join(temp, "upstream");
  const workspace = join(temp, "workspace");
  const scratch = join(temp, "scratch");
  mkdirSync(workspace);
  mkdirSync(scratch);
  cpSync(root, upstream, {
    recursive: true,
    filter: (path) =>
      !relative(root, path)
        .split(sep)
        .some(
          (part) =>
            excluded.has(part) ||
            part === ".env" ||
            part.endsWith(".tsbuildinfo"),
        ),
  });
  runGit(upstream, "init", "--quiet", "--initial-branch=main");
  runGit(upstream, "add", "--all");
  runGit(
    upstream,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--quiet",
    "-m",
    "Test template",
  );

  const env = {
    ...process.env,
    TMPDIR: scratch,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${pathToFileURL(upstream).href}.insteadOf`,
    GIT_CONFIG_VALUE_0: repositoryUrl,
    GIT_TERMINAL_PROMPT: "0",
  };
  return { env, scratch, temp, workspace };
}

function createProject(fixture, ...args) {
  return spawnSync(
    "bash",
    [
      "-o",
      "pipefail",
      "-c",
      'curl -fsSL "$1" | bash -s -- "${@:2}"',
      "--",
      scriptUrl,
      ...args,
    ],
    { cwd: fixture.workspace, env: fixture.env, encoding: "utf8" },
  );
}

templateTest(
  "creates an initialized project from the downloaded script",
  (t) => {
    const context = fixture(t);
    const result = createProject(
      context,
      "my-project",
      "--module",
      "example.com/acme/my-project",
    );
    assert.equal(result.status, 0, result.stderr);
    const project = join(context.workspace, "my-project");
    assert.equal(existsSync(join(project, ".git")), false);
    assert.equal(
      JSON.parse(readFileSync(join(project, "package.json"), "utf8")).name,
      "my-project",
    );
    assert.match(
      readFileSync(join(project, "apps/backend/go.mod"), "utf8"),
      /^module example\.com\/acme\/my-project\n/,
    );
    assert.match(
      readFileSync(
        join(project, "apps/backend/cmd/my-project/main.go"),
        "utf8",
      ),
      /example\.com\/acme\/my-project\/internal\/config/,
    );
    assert.match(
      readFileSync(join(project, "apps/backend/.env.sample"), "utf8"),
      /MY_PROJECT_DATABASE\.NAME="my-project"/,
    );
    assert.equal(
      JSON.parse(
        readFileSync(join(project, "packages/openapi/package.json"), "utf8"),
      ).name,
      "@my-project/openapi",
    );
    assert.match(
      readFileSync(join(project, "scripts/create-project.sh"), "utf8"),
      /FreyGold\/go-boilerplate\.git/,
    );
    assert.match(
      readFileSync(join(project, "README.md"), "utf8"),
      /FreyGold\/go-boilerplate\/refs\/heads\/main\/scripts\/create-project\.sh/,
    );
    assert.deepEqual(readdirSync(context.scratch), []);
  },
);

templateTest("uses the default module path", (t) => {
  const context = fixture(t);
  const result = createProject(context, "catalog");
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readFileSync(
      join(context.workspace, "catalog/apps/backend/go.mod"),
      "utf8",
    ),
    /^module github\.com\/freygold\/catalog\n/,
  );
  assert.deepEqual(readdirSync(context.scratch), []);
});

templateTest("keeps an existing destination and rejects invalid names", (t) => {
  const context = fixture(t);
  const existing = join(context.workspace, "my-project");
  mkdirSync(existing);
  writeFileSync(join(existing, "data.txt"), "keep this file");

  const collision = createProject(context, "my-project");
  assert.notEqual(collision.status, 0);
  assert.match(collision.stderr, /already exists/);
  assert.equal(
    readFileSync(join(existing, "data.txt"), "utf8"),
    "keep this file",
  );

  for (const args of [
    ["../unsafe"],
    ["Bad Name"],
    ["a".repeat(64)],
    ["extra", "argument"],
  ]) {
    const result = createProject(context, ...args);
    assert.notEqual(result.status, 0);
  }
  assert.deepEqual(readdirSync(context.scratch), []);
});

templateTest("cleans up when initialization or cloning fails", (t) => {
  const context = fixture(t);
  const invalidModule = createProject(
    context,
    "my-project",
    "--module",
    "not/a/module",
  );
  assert.notEqual(invalidModule.status, 0);
  assert.match(invalidModule.stderr, /module path/);
  assert.equal(existsSync(join(context.workspace, "my-project")), false);
  assert.deepEqual(readdirSync(context.scratch), []);

  context.env.GIT_CONFIG_KEY_0 = `url.${pathToFileURL(join(context.temp, "missing")).href}.insteadOf`;
  const failedClone = createProject(context, "my-project");
  assert.notEqual(failedClone.status, 0);
  assert.equal(existsSync(join(context.workspace, "my-project")), false);
  assert.deepEqual(readdirSync(context.scratch), []);
});

templateTest("removes a partial destination when copying fails", (t) => {
  const context = fixture(t);
  const bin = join(context.temp, "bin");
  mkdirSync(bin);
  const failingCopy = join(bin, "cp");
  writeFileSync(
    failingCopy,
    '#!/usr/bin/env bash\nprintf partial > "$4/partial.txt"\nexit 1\n',
  );
  chmodSync(failingCopy, 0o755);
  context.env.PATH = `${bin}:${process.env.PATH}`;

  const result = createProject(context, "my-project");
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(join(context.workspace, "my-project")), false);
  assert.deepEqual(readdirSync(context.scratch), []);
});
