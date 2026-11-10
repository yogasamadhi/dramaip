import ts from "typescript";

const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m;

/**
 * Transform standard TypeScript decorators before Vite's default parser sees
 * source files. Copied from DeepSeek Harness `vitest.shared.ts` (MIT); the
 * infra packages copied from it use `@Inject` and similar class decorators.
 * @returns a pre-transform Vite plugin for source-mode test configurations.
 */
export function standardDecoratorPlugin() {
  return {
    name: "dramaip-standard-decorators",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      const file = id.split("?", 1)[0]!;
      if (!/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return;
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          ...(file.endsWith("x") ? { jsx: ts.JsxEmit.ReactJSX } : {}),
          sourceMap: true,
        },
      });
      return {
        code: result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, "\n"),
        map: result.sourceMapText,
      };
    },
  };
}
