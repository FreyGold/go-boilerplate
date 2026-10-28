import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const isTemplate =
  JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name ===
    "boilerplate" &&
  existsSync(join(root, "apps/backend/cmd/go-boilerplate/main.go"));
const templateTest = isTemplate ? test : test.skip;
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

function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), "project-init-test-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const project = join(temp, "project");
  cpSync(root, project, {
    recursive: true,
    filter: (path) => {
      const parts = relative(root, path).split(sep);
      return !parts.some(
        (part) =>
          excluded.has(part) ||
          part === ".env" ||
          part.endsWith(".tsbuildinfo"),
      );
    },
  });
  return { project, temp };
}

function initialize(project, ...args) {
  return spawnSync(
    process.execPath,
    [join(project, "scripts/init-project.mjs"), ...args],
    {
      cwd: tmpdir(),
      encoding: "utf8",
    },
  );
}

function read(project, path) {
  return readFileSync(join(project, path), "utf8");
}

function projectTextFiles(directory, base = directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = relative(base, path);
    if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
    if (
      name === "scripts/init-project.mjs" ||
      name === "scripts/init-project.test.mjs" ||
      name === "scripts/create-project.sh" ||
      name === "scripts/create-project.test.mjs"
    )
      continue;
    if (entry.isDirectory()) files.push(...projectTextFiles(path, base));
    else if (entry.isFile()) {
      const content = readFileSync(path);
      if (!content.includes(0) && !name.endsWith(".bin"))
        files.push({ name, content: content.toString("utf8") });
    }
  }
  return files;
}

templateTest(
  "initializes project files, paths, and configuration with a custom module",
  (t) => {
    const { project, temp } = fixture(t);
    mkdirSync(join(project, ".git"), { recursive: true });
    mkdirSync(join(project, "node_modules/example"), { recursive: true });
    mkdirSync(join(project, "apps/frontend/dist"), { recursive: true });
    mkdirSync(join(project, "fixtures/boilerplate-assets"), {
      recursive: true,
    });
    writeFileSync(join(project, ".git/config"), "go-boilerplate");
    writeFileSync(
      join(project, "node_modules/example/index.js"),
      "boilerplate",
    );
    writeFileSync(
      join(project, "apps/frontend/dist/index.html"),
      "boilerplate",
    );
    writeFileSync(
      join(project, "apps/backend/.env"),
      "BOILERPLATE_DATABASE.NAME=boilerplate\n",
    );
    writeFileSync(
      join(project, "fixtures/boilerplate-assets/old-go-boilerplate.txt"),
      "Go Boilerplate / BOILERPLATE / boilerplate",
    );
    writeFileSync(
      join(project, "fixtures/bom.txt"),
      Buffer.from("\ufeffBoilerplate"),
    );
    const binary = Buffer.from("boilerplate\0go-boilerplate");
    writeFileSync(join(project, "fixtures/example.bin"), binary);
    const outside = join(temp, "outside.txt");
    writeFileSync(outside, "go-boilerplate");
    symlinkSync(outside, join(project, "fixtures/link.txt"));

    const result = initialize(
      project,
      "my-project",
      "--module",
      "example.com/acme/my-project",
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(read(project, "package.json")).name, "my-project");
    assert.match(
      read(project, "apps/backend/go.mod"),
      /^module example\.com\/acme\/my-project\n/,
    );
    assert.match(
      read(project, "apps/backend/cmd/my-project/main.go"),
      /example\.com\/acme\/my-project\/internal\/config/,
    );
    assert.equal(
      existsSync(join(project, "apps/backend/cmd/go-boilerplate")),
      false,
    );
    assert.match(
      read(project, "apps/backend/Dockerfile"),
      /\.\/cmd\/my-project/,
    );
    assert.match(
      read(project, "apps/backend/Taskfile.yml"),
      /MY_PROJECT_DB_DSN/,
    );
    assert.match(
      read(project, "apps/backend/internal/config/config.go"),
      /env\.Provider\("MY_PROJECT_"/,
    );
    assert.match(
      read(project, "apps/backend/.env.sample"),
      /MY_PROJECT_DATABASE\.NAME="my-project"/,
    );
    assert.equal(
      read(project, "apps/backend/.env"),
      "MY_PROJECT_DATABASE.NAME=my-project\n",
    );
    assert.match(
      read(project, "compose.yaml"),
      /MY_PROJECT_DATABASE\.NAME: \$\{POSTGRES_DB:-my-project\}/,
    );
    assert.equal(
      JSON.parse(read(project, "packages/openapi/package.json")).name,
      "@my-project/openapi",
    );
    assert.match(
      read(project, "apps/frontend/src/api/index.ts"),
      /@my-project\/openapi/,
    );
    assert.match(read(project, "bun.lock"), /@my-project\/openapi/);
    assert.match(
      read(project, "packages/emails/bun.lock"),
      /@my-project\/emails/,
    );
    assert.match(
      read(project, "apps/frontend/index.html"),
      /My Project Frontend/,
    );
    assert.match(
      read(project, "apps/backend/templates/emails/welcome.html"),
      /Welcome to My Project/,
    );
    assert.equal(
      read(project, "fixtures/my-project-assets/old-my-project.txt"),
      "My Project / MY_PROJECT / my-project",
    );
    assert.deepEqual(
      readFileSync(join(project, "fixtures/bom.txt")),
      Buffer.from("\ufeffMy Project"),
    );
    assert.deepEqual(
      readFileSync(join(project, "fixtures/example.bin")),
      binary,
    );
    assert.equal(readFileSync(outside, "utf8"), "go-boilerplate");
    assert.equal(read(project, ".git/config"), "go-boilerplate");
    assert.equal(read(project, "node_modules/example/index.js"), "boilerplate");
    assert.equal(read(project, "apps/frontend/dist/index.html"), "boilerplate");

    for (const file of projectTextFiles(project)) {
      const projectContent = file.content.replaceAll(
        "https://raw.githubusercontent.com/FreyGold/go-boilerplate/refs/heads/main/scripts/create-project.sh",
        "",
      );
      assert.doesNotMatch(projectContent, /boilerplate/i, file.name);
      assert.doesNotMatch(file.name, /boilerplate/i, file.name);
    }
  },
);

templateTest(
  "uses the default module and prevents a second initialization",
  (t) => {
    const { project } = fixture(t);
    const first = initialize(project, "catalog");
    assert.equal(first.status, 0, first.stderr);
    assert.match(
      read(project, "apps/backend/go.mod"),
      /^module github\.com\/freygold\/catalog\n/,
    );

    const second = initialize(project, "another-project");
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /already initialized/);
    assert.equal(JSON.parse(read(project, "package.json")).name, "catalog");
    assert.equal(
      existsSync(join(project, "apps/backend/cmd/catalog/main.go")),
      true,
    );

    const testRun = spawnSync(
      process.execPath,
      ["--test", join(project, "scripts/init-project.test.mjs")],
      { cwd: tmpdir(), encoding: "utf8" },
    );
    assert.equal(testRun.status, 0, testRun.stderr || testRun.stdout);
  },
);

templateTest("rejects invalid arguments before changing files", (t) => {
  const { project } = fixture(t);
  const before = read(project, "apps/backend/go.mod");
  const invalid = [
    [],
    ["My Project"],
    ["123-project"],
    ["my_project"],
    ["my--project"],
    ["a".repeat(64)],
    ["my-project", "--module"],
    ["my-project", "--module", "example.com//project"],
    ["my-project", "--module", "example.com/project+name"],
    ["my-project", "--module", "Example.com/project"],
    ["my-project", "--module", "example.com/project/v1"],
    ["my-project", "--module", "example.com/CON"],
    ["my-project", "extra"],
  ];
  for (const args of invalid) {
    const result = initialize(project, ...args);
    assert.notEqual(
      result.status,
      0,
      `Expected an error for ${args.join(" ")}`,
    );
    assert.equal(read(project, "apps/backend/go.mod"), before);
    assert.equal(JSON.parse(read(project, "package.json")).name, "boilerplate");
  }
});

templateTest("rejects path collisions before changing files", (t) => {
  const { project } = fixture(t);
  mkdirSync(join(project, "apps/backend/cmd/my-project"));
  const before = read(project, "apps/backend/go.mod");

  const result = initialize(project, "my-project");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /my-project already exists/);
  assert.equal(read(project, "apps/backend/go.mod"), before);
  assert.equal(JSON.parse(read(project, "package.json")).name, "boilerplate");
  assert.equal(
    existsSync(join(project, "apps/backend/cmd/go-boilerplate/main.go")),
    true,
  );
});

templateTest("does not overwrite a path that would also be renamed", (t) => {
  const { project } = fixture(t);
  mkdirSync(join(project, "fixtures"));
  writeFileSync(join(project, "fixtures/boilerplate.txt"), "first");
  writeFileSync(join(project, "fixtures/my-boilerplate.txt"), "second");

  const result = initialize(project, "my-boilerplate");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /my-boilerplate\.txt already exists/);
  assert.equal(read(project, "fixtures/boilerplate.txt"), "first");
  assert.equal(read(project, "fixtures/my-boilerplate.txt"), "second");
  assert.equal(JSON.parse(read(project, "package.json")).name, "boilerplate");
});
