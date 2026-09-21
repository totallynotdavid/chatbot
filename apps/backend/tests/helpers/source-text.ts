import ts from "typescript";

function parseSource(text: string): ts.SourceFile {
  return ts.createSourceFile(
    "source.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function isJSDocNode(node: ts.Node): boolean {
  return (
    node.kind >= ts.SyntaxKind.FirstJSDocNode &&
    node.kind <= ts.SyntaxKind.LastJSDocNode
  );
}

/**
 * The `[start, end)` ranges of the comments in `from..to`, the trivia before
 * one token. That gap holds only whitespace and comments.
 */
function commentRanges(
  text: string,
  from: number,
  to: number,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = from;

  while (i < to) {
    if (text.startsWith("//", i)) {
      let end = i;
      while (end < to && text[end] !== "\n" && text[end] !== "\r") end++;
      ranges.push([i, end]);
      i = end;
    } else if (text.startsWith("/*", i)) {
      const close = text.indexOf("*/", i + 2);
      const end = close === -1 || close + 2 > to ? to : close + 2;
      ranges.push([i, end]);
      i = end;
    } else {
      i++;
    }
  }

  return ranges;
}

/**
 * The same text with every comment replaced by spaces. Newlines stay, so an
 * offset or a line number in the result is the same one in `text`. Only the
 * trivia before each parsed token is searched, so a `//` or an apostrophe
 * inside a string, a template or a regex literal is never read as a comment.
 */
export function stripComments(text: string): string {
  const source = parseSource(text);
  const chars = text.split("");
  const blank = (start: number, end: number) => {
    for (let i = start; i < end; i++) {
      if (text[i] !== "\n" && text[i] !== "\r") chars[i] = " ";
    }
  };

  const visit = (node: ts.Node) => {
    // A JSDoc node lies inside a comment that the trivia before its
    // declaration already covers.
    if (isJSDocNode(node)) return;

    const children = node.getChildren(source);
    if (children.length > 0) {
      for (const child of children) visit(child);
      return;
    }
    if (node.kind === ts.SyntaxKind.SyntaxList) return;

    for (const [start, end] of commentRanges(
      text,
      node.pos,
      node.getStart(source),
    )) {
      blank(start, end);
    }
  };
  visit(source);

  return chars.join("");
}

export type StringLiteral = {
  /** Offset of the opening quote. */
  index: number;
  /**
   * The text between the quotes. A template's substitutions are code, so they
   * are blanked here, and a literal inside one is listed on its own.
   */
  content: string;
};

/**
 * Every string literal and template literal in `text`, in source order. The
 * content of a template is its own text with each `${}` substitution blanked,
 * so code inside a substitution is never read as SQL. A literal inside a
 * substitution is listed on its own, so each query is judged once.
 */
export function stringLiterals(text: string): StringLiteral[] {
  const source = parseSource(text);
  const found: StringLiteral[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node)
    ) {
      const start = node.getStart(source);
      const open = start + 1;
      const chars = text.slice(open, Math.max(open, node.end - 1)).split("");

      if (ts.isTemplateExpression(node)) {
        for (const span of node.templateSpans) {
          chars.fill(
            " ",
            span.expression.pos - open,
            span.expression.end - open,
          );
        }
      }

      found.push({ index: start, content: chars.join("") });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}
