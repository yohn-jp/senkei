import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

export function syntaxErrors(file, source) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  return parsed.parseDiagnostics.map((diagnostic) => {
    const pos = parsed.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    return `${file}:${pos.line + 1}:${pos.character + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
  });
}

function listSpecs(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSpecs(path));
    else if (entry.isFile() && (entry.name.endsWith(".spec.ts") || entry.name.endsWith(".spec.tsx"))) files.push(path);
  }
  return files;
}

function main() {
  const directories = ["tests/browser/specs", "tests/visual"];
  for (const directory of directories) {
    if (!existsSync(directory)) throw new Error(`Required Playwright spec directory missing: ${directory}`);
  }
  const files = directories.flatMap(listSpecs).sort();
  if (!files.length) throw new Error("No Playwright specs were discovered");
  const errors = files.flatMap((file) => syntaxErrors(file, readFileSync(file, "utf8")));
  if (errors.length) {
    for (const error of errors) console.error(error);
    console.error(`Playwright syntax validation failed (${errors.length} errors in ${files.length} specs)`);
    process.exitCode = 1;
  } else {
    console.log(`Playwright syntax validated: ${files.length} specs`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
