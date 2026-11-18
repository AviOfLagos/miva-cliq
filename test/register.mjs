// Test-only module hooks: lets `node --test` load the app's TypeScript as-is,
// with no new dependencies. Transpiles .ts/.tsx with the installed `typescript`
// (Node's built-in type stripping rejects parameter properties, used in
// lib/moodle/auth.ts) and resolves the `@/` path alias plus extensionless
// relative imports the way the Next bundler does.
import { registerHooks } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

registerHooks({
  resolve(specifier, context, next) {
    let base = null;
    if (specifier.startsWith("@/")) {
      base = path.join(ROOT, specifier.slice(2));
    } else if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith("file:") &&
      !context.parentURL.includes("/node_modules/")
    ) {
      base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    }
    if (base) {
      if (!path.extname(base)) {
        const hit = EXTS.map((e) => base + e).find(isFile);
        if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
      }
      if (isFile(base)) return { url: pathToFileURL(base).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith("file:") && /\.tsx?$/.test(url)) {
      const file = fileURLToPath(url);
      const out = ts.transpileModule(readFileSync(file, "utf8"), {
        fileName: file,
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      });
      return { format: "module", source: out.outputText, shortCircuit: true };
    }
    return next(url, context);
  },
});
