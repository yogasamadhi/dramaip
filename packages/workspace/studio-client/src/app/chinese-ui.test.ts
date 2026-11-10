import { expect, test } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

async function visibleSourcePaths(): Promise<string[]> {
  const entries = await readdir(import.meta.dirname, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => join(entry.parentPath, entry.name));
}

function expressionText(node: ts.Expression | undefined): string[] {
  if (!node) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return [node.text];
  if (ts.isConditionalExpression(node))
    return [
      ...expressionText(node.whenTrue),
      ...expressionText(node.whenFalse),
    ];
  if (ts.isParenthesizedExpression(node))
    return expressionText(node.expression);
  if (ts.isBinaryExpression(node))
    return [...expressionText(node.left), ...expressionText(node.right)];
  return [];
}

function childText(child: ts.JsxChild): string[] {
  if (ts.isJsxText(child)) return [child.text];
  if (ts.isJsxExpression(child)) return expressionText(child.expression);
  if (ts.isJsxElement(child)) return child.children.flatMap(childText);
  if (ts.isJsxFragment(child)) return child.children.flatMap(childText);
  return [];
}

test("所有静态按钮文案均包含中文", async () => {
  const buttonTexts: string[] = [];
  const controlTags = new Set(["button", "BareButton", "Button"]);
  for (const visibleSourcePath of await visibleSourcePaths()) {
    const source = await readFile(visibleSourcePath, "utf8");
    const sourceFile = ts.createSourceFile(
      visibleSourcePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isJsxElement(node) &&
        controlTags.has(node.openingElement.tagName.getText(sourceFile))
      ) {
        buttonTexts.push(
          ...node.children
            .flatMap(childText)
            .map((value) => value.replace(/\s+/g, " ").trim())
            .filter(Boolean),
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  expect(buttonTexts.length).toBeGreaterThan(20);
  const englishOnly = buttonTexts.filter(
    (value) => /[A-Za-z]/.test(value) && !/[㐀-鿿]/u.test(value),
  );
  expect(englishOnly).toEqual([]);
});

test("输入提示和可访问标签不使用纯英文", async () => {
  const visibleMessages: string[] = [];
  for (const visibleSourcePath of await visibleSourcePaths()) {
    const source = await readFile(visibleSourcePath, "utf8");
    visibleMessages.push(
      ...[
        ...source.matchAll(/(?:placeholder|aria-label|title)="([^"]+)"/g),
        ...source.matchAll(/throw\s+new\s+Error\("([^"]+)"\)/g),
      ].map((match) => match[1]),
    );
  }
  const englishOnly = visibleMessages.filter(
    (value) => /[A-Za-z]/.test(value) && !/[㐀-鿿]/u.test(value),
  );
  expect(englishOnly).toEqual([]);
});
