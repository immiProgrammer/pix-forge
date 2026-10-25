import { readFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const tag = process.env.RELEASE_TAG;
if (
  !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(tag || "")
) {
  throw new Error(
    "Release tag must be vMAJOR.MINOR.PATCH (optionally with a prerelease suffix).",
  );
}
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const version = tag.slice(1);
const cargo = readFileSync("apps/desktop/src-tauri/Cargo.toml", "utf8");
const packageSection = cargo.split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
const cargoVersion = packageSection?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const versions = {
  "package.json": readJson("package.json").version,
  "apps/desktop/package.json": readJson("apps/desktop/package.json").version,
  "apps/desktop/src-tauri/tauri.conf.json": readJson(
    "apps/desktop/src-tauri/tauri.conf.json",
  ).version,
  "apps/desktop/src-tauri/Cargo.toml": cargoVersion,
};
for (const [path, actual] of Object.entries(versions)) {
  if (actual !== version)
    throw new Error(
      `${path} has version ${actual}; tag ${tag} requires ${version}.`,
    );
}
const head = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const tagged = execFileSync(
  "git",
  ["rev-parse", "--verify", `refs/tags/${tag}^{commit}`],
  { encoding: "utf8" },
).trim();
if (head !== tagged) throw new Error(`The checkout does not match tag ${tag}.`);
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
console.log(`Validated PixForge ${version} at ${head}.`);
