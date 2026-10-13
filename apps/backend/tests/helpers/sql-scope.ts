import ts from "typescript";

// Finds SELECT statements that read tenant-owned tables without their own
// tenant predicates. The checker binds each identifier to its declaration and
// judges each UNION arm and conditional alternative separately. A name's
// declaration and unconditional appends contribute text. Call results and
// property reads do not. The rules are in docs/tenancy.md#how-a-read-is-scoped.

export type UnscopedRead = {
  /** 1-based line where the statement starts. */
  line: number;
  /** The tenant-owned tables the arm reads, or a note that it could not tell. */
  detail: string;
  /** The arm's own text, with whitespace collapsed. */
  sql: string;
};

/** Stands for text the guard cannot read. */
const OPAQUE = String.fromCharCode(0xe000);
/** Stands for a parenthesised sub-select cut out of its arm. */
const NESTED = String.fromCharCode(0xe001);
/** The maximum number of alternatives the guard can distinguish. */
const MAX_ALTERNATIVES = 64;

/** The helpers of `db/query.ts` that put a tenant predicate into SQL. */
const PREDICATE_HELPERS = new Set([
  "tenantPredicate",
  "openTenantsOnly",
  "tenantOrPlatformPredicate",
]);
const HELPER_MODULE = /(^|\/)query(\.ts|\.js)?$/;
/** What a helper call stands for in the text of a statement. */
const PREDICATE_TEXT = "tenant_id = ?";

/** `tenant_id = ?` against a parameter, or `tenant_id IN (...)`. */
const PREDICATE = /\btenant_id\s*=\s*[?:$@]|\btenant_id\s+IN\b/i;
/**
 * A sub-select tied to its outer row's tenant: `m.tenant_id = o.tenant_id`.
 * It reads no more than the outer row's tenant, which the outer statement is
 * judged on. Only a nested arm may use it.
 */
const CORRELATED = /\b\w+\.tenant_id\s*=\s*\w+\.tenant_id\b/i;

/** Array methods and properties that only read their receiver. */
const READS = new Set([
  "join",
  "map",
  "forEach",
  "filter",
  "slice",
  "flat",
  "flatMap",
  "some",
  "every",
  "find",
  "includes",
  "indexOf",
  "reduce",
  "length",
  "at",
  "keys",
  "values",
  "entries",
]);
/** Methods whose result is the receiver's text, trimmed or joined. */
const PASS_THROUGH = new Set([
  "join",
  "trim",
  "trimStart",
  "trimEnd",
  "toString",
  "filter",
  "slice",
  "flat",
]);

class Undecidable extends Error {}

type Root = {
  expr: ts.Expression;
  statement?: ts.Statement;
  /** Appends in the same block after this root, each a list of expressions. */
  appends: Array<{ parts: readonly ts.Expression[]; separator: string }>;
};

type Binding = {
  roots: Root[];
  /** An array that something other than a read or a push can change. */
  unreadable: boolean;
};

type Append = {
  parts: readonly ts.Expression[];
  separator: string;
  statement: ts.Statement;
};

function unwrap(node: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

const VALUE_OPERATORS = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
]);

/** The outermost expression that yields a literal's text as one value. */
function chainTop(literal: ts.Node): ts.Node {
  let node = literal;
  for (;;) {
    const parent = node.parent;
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isTypeAssertionExpression(parent) ||
      (ts.isBinaryExpression(parent) &&
        VALUE_OPERATORS.has(parent.operatorToken.kind)) ||
      (ts.isConditionalExpression(parent) && node !== parent.condition)
    ) {
      node = parent;
    } else {
      return node;
    }
  }
}

/** The literal text of a chain, without the substitutions of its templates. */
function literalTexts(node: ts.Expression): string[] {
  node = unwrap(node);

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [node.text];
  }
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
  }
  if (
    ts.isBinaryExpression(node) &&
    VALUE_OPERATORS.has(node.operatorToken.kind)
  ) {
    return [...literalTexts(node.left), ...literalTexts(node.right)];
  }
  if (ts.isConditionalExpression(node)) {
    return [...literalTexts(node.whenTrue), ...literalTexts(node.whenFalse)];
  }
  return [];
}

function holdsSelect(node: ts.Expression): boolean {
  return literalTexts(node).some((text) => /\bSELECT\b/i.test(text));
}

function product(parts: string[][]): string[] {
  let acc = [""];
  for (const part of parts) {
    const next = new Set<string>();
    for (const head of acc) for (const tail of part) next.add(head + tail);
    if (next.size > MAX_ALTERNATIVES) throw new Undecidable();
    acc = [...next];
  }
  return acc;
}

function union(...lists: string[][]): string[] {
  const all = new Set(lists.flat());
  if (all.size > MAX_ALTERNATIVES) throw new Undecidable();
  return [...all];
}

/** The statement an expression is the whole of, if it is one. */
function statementOf(node: ts.Node): ts.Statement | undefined {
  const parent = node.parent;
  return ts.isExpressionStatement(parent) && parent.expression === node
    ? parent
    : undefined;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Splits SQL into arms at `UNION`, `INTERSECT` and `EXCEPT`, and lifts each
 * parenthesised sub-select out of the arm that holds it. `own` is the arm's
 * text. `code` is the same text with quoted spans emptied and comments
 * blanked, so only code is matched for a predicate or a table.
 */
type Arm = { own: string; code: string; nested: Arm[][] };

const SET_OPERATOR = /(?:UNION(?:\s+ALL)?|INTERSECT|EXCEPT)\b/iy;
const NESTED_SELECT = /\(\s*SELECT\b/iy;
// An unclosed block comment runs to the end of the SQL text.
const COMMENT = /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y;

function parseArms(text: string, at: { i: number }, nested: boolean): Arm[] {
  const arms: Arm[] = [];
  let own = "";
  let code = "";
  let inner: Arm[][] = [];
  let depth = 0;

  const close = () => {
    arms.push({ own, code, nested: inner });
    own = "";
    code = "";
    inner = [];
  };

  while (at.i < text.length) {
    const ch = text[at.i]!;

    if (ch === "'" || ch === '"') {
      // A quoted span, string or identifier: its parentheses and keywords are
      // data, and so is a `tenant_id = ?` inside it.
      let end = at.i + 1;
      while (end < text.length) {
        if (text[end] === ch && text[end + 1] === ch) end += 2;
        else if (text[end] === ch) break;
        else end++;
      }
      own += text.slice(at.i, end + 1);
      code += ch + ch;
      at.i = end + 1;
      continue;
    }

    COMMENT.lastIndex = at.i;
    const comment = COMMENT.exec(text);
    if (comment) {
      own += comment[0];
      code += " ";
      at.i += comment[0].length;
      continue;
    }

    if (ch === "(") {
      NESTED_SELECT.lastIndex = at.i;
      if (NESTED_SELECT.test(text)) {
        at.i++;
        inner.push(parseArms(text, at, true));
        own += NESTED;
        code += NESTED;
        continue;
      }
      depth++;
    } else if (ch === ")") {
      if (depth > 0) {
        depth--;
      } else if (nested) {
        at.i++;
        break;
      }
    } else if (depth === 0 && !/\w/.test(text[at.i - 1] ?? " ")) {
      SET_OPERATOR.lastIndex = at.i;
      const match = SET_OPERATOR.exec(text);
      if (match) {
        close();
        at.i += match[0].length;
        continue;
      }
    }

    own += ch;
    code += ch;
    at.i++;
  }

  close();
  return arms;
}

function describeArm(own: string): string {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: an unread interpolation prints as `${...}`.
  return collapse(own.replaceAll(NESTED, "(...)").replaceAll(OPAQUE, "${...}"));
}

export function unscopedReads(
  text: string,
  owned: ReadonlySet<string>,
): UnscopedRead[] {
  const file = ts.createSourceFile(
    "source.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const options: ts.CompilerOptions = {
    noLib: true,
    noResolve: true,
    types: [],
    target: ts.ScriptTarget.Latest,
  };
  const program = ts.createProgram({
    rootNames: [file.fileName],
    options,
    host: {
      getSourceFile: (name) => (name === file.fileName ? file : undefined),
      getDefaultLibFileName: () => "lib.d.ts",
      writeFile: () => {},
      getCurrentDirectory: () => "",
      getCanonicalFileName: (name) => name,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
      fileExists: (name) => name === file.fileName,
      readFile: () => undefined,
    },
  });
  const checker = program.getTypeChecker();

  const symbolAt = (node: ts.Node) => checker.getSymbolAtLocation(node);

  // Every identifier, grouped by the symbol the checker binds it to.
  const references = new Map<ts.Symbol, ts.Identifier[]>();
  const collect = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      const symbol = symbolAt(node);
      if (symbol) {
        const list = references.get(symbol) ?? [];
        list.push(node);
        references.set(symbol, list);
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(file);

  /** Appends that attach to a root, so a unit that is one skips its own pass. */
  const attached = new Set<ts.Node>();
  /** Literals whose text went into a judged statement. */
  const consumed = new Set<ts.Node>();
  const bindings = new Map<ts.Symbol, Binding>();

  function bind(symbol: ts.Symbol): Binding {
    const known = bindings.get(symbol);
    if (known) return known;

    const declaration = symbol.declarations?.[0];
    const binding: Binding = { roots: [], unreadable: false };
    bindings.set(symbol, binding);
    if (
      !declaration ||
      !ts.isVariableDeclaration(declaration) ||
      !ts.isIdentifier(declaration.name)
    ) {
      binding.unreadable = true;
      return binding;
    }

    const appends: Append[] = [];
    let changed = false;
    let leaked = false;

    for (const ref of references.get(symbol) ?? []) {
      const parent = ref.parent;

      if (ref === declaration.name) {
        if (declaration.initializer) {
          const list = declaration.parent;
          binding.roots.push({
            expr: declaration.initializer,
            statement: ts.isVariableStatement(list.parent)
              ? list.parent
              : undefined,
            appends: [],
          });
        }
      } else if (ts.isBinaryExpression(parent) && parent.left === ref) {
        const kind = parent.operatorToken.kind;
        const statement = statementOf(parent);
        if (kind === ts.SyntaxKind.EqualsToken) {
          binding.roots.push({ expr: parent.right, statement, appends: [] });
        } else if (kind === ts.SyntaxKind.PlusEqualsToken && statement) {
          appends.push({ parts: [parent.right], separator: "", statement });
        } else {
          changed = true;
        }
      } else if (
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === ref
      ) {
        const name = parent.name.text;
        const call = parent.parent;
        const statement = statementOf(call);
        if (
          (name === "push" || name === "unshift") &&
          ts.isCallExpression(call) &&
          call.expression === parent
        ) {
          if (statement) {
            appends.push({ parts: call.arguments, separator: " ", statement });
          }
        } else if (!READS.has(name)) {
          changed = true;
        }
      } else if (
        ts.isSpreadElement(parent) ||
        (ts.isForOfStatement(parent) && parent.expression === ref)
      ) {
        // Reading the value does not make the binding unreadable.
      } else {
        leaked = true;
      }
    }

    // An array may change behind the guard's back if it is handed to a call,
    // aliased or edited by anything but `push`. A string cannot.
    const isArray =
      appends.some((a) => a.separator === " ") ||
      binding.roots.some((r) => ts.isArrayLiteralExpression(unwrap(r.expr)));
    if (isArray && (changed || leaked)) {
      binding.unreadable = true;
      return binding;
    }

    // An append is unconditional only when it sits in the root's own block.
    // The nearest root before it in that block is the one it extends.
    for (const append of appends) {
      const candidates = binding.roots.filter(
        (root) =>
          root.statement &&
          root.statement.parent === append.statement.parent &&
          root.statement.end <= append.statement.pos,
      );
      const root = candidates.at(-1);
      if (!root) continue;
      root.appends.push({ parts: append.parts, separator: append.separator });
      for (const part of append.parts) attached.add(part);
    }

    return binding;
  }

  const isPredicateHelper = (callee: ts.Expression): boolean => {
    if (!ts.isIdentifier(callee)) return false;
    const declaration = symbolAt(callee)?.declarations?.[0];
    if (!declaration || !ts.isImportSpecifier(declaration)) return false;

    const imported = (declaration.propertyName ?? declaration.name).text;
    const from = declaration.parent.parent.parent.moduleSpecifier;
    return (
      PREDICATE_HELPERS.has(imported) &&
      ts.isStringLiteral(from) &&
      HELPER_MODULE.test(from.text)
    );
  };

  /** Every text `expr` can take where it is used, one string per branch. */
  function alternatives(
    expr: ts.Expression,
    seen: ReadonlySet<ts.Symbol>,
  ): string[] {
    expr = unwrap(expr);

    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      consumed.add(expr);
      return [expr.text];
    }
    if (ts.isNumericLiteral(expr)) return [expr.text];

    if (ts.isTemplateExpression(expr)) {
      consumed.add(expr);
      return product([
        [expr.head.text],
        ...expr.templateSpans.flatMap((span) => [
          alternatives(span.expression, seen),
          [span.literal.text],
        ]),
      ]);
    }

    if (ts.isBinaryExpression(expr)) {
      const left = alternatives(expr.left, seen);
      const right = alternatives(expr.right, seen);
      switch (expr.operatorToken.kind) {
        case ts.SyntaxKind.PlusToken:
          return product([left, right]);
        case ts.SyntaxKind.BarBarToken:
        case ts.SyntaxKind.QuestionQuestionToken:
          return union(left, right);
        case ts.SyntaxKind.AmpersandAmpersandToken:
          return union([""], right);
        default:
          return [OPAQUE];
      }
    }

    if (ts.isConditionalExpression(expr)) {
      return union(
        alternatives(expr.whenTrue, seen),
        alternatives(expr.whenFalse, seen),
      );
    }

    if (ts.isArrayLiteralExpression(expr)) {
      return product(
        expr.elements.flatMap((element, index) => [
          ...(index > 0 ? [[" "]] : []),
          alternatives(
            ts.isSpreadElement(element) ? element.expression : element,
            seen,
          ),
        ]),
      );
    }

    if (ts.isCallExpression(expr)) {
      if (isPredicateHelper(expr.expression)) return [PREDICATE_TEXT];
      const callee = expr.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        PASS_THROUGH.has(callee.name.text)
      ) {
        return alternatives(callee.expression, seen);
      }
      return [OPAQUE];
    }

    if (ts.isIdentifier(expr)) {
      const symbol = symbolAt(expr);
      if (!symbol || seen.has(symbol)) return [OPAQUE];

      const binding = bind(symbol);
      if (binding.unreadable || binding.roots.length === 0) return [OPAQUE];

      const next = new Set(seen).add(symbol);
      return union(
        ...binding.roots.map((root) =>
          // A root that is a statement of its own is judged there, not here.
          holdsSelect(root.expr) ? [OPAQUE] : rootAlternatives(root, next),
        ),
      );
    }

    return [OPAQUE];
  }

  function rootAlternatives(
    root: Root,
    seen: ReadonlySet<ts.Symbol>,
  ): string[] {
    return product([
      alternatives(root.expr, seen),
      ...root.appends.flatMap((append) =>
        append.parts.flatMap((part) => [
          [append.separator],
          alternatives(part, seen),
        ]),
      ),
    ]);
  }

  const found: UnscopedRead[] = [];
  const reported = new Set<string>();

  function judge(
    arms: Arm[],
    inherited: boolean,
    nested: boolean,
    report: (arm: Arm, detail: string) => void,
  ) {
    for (const arm of arms) {
      const scoped =
        inherited ||
        PREDICATE.test(arm.code) ||
        (nested && CORRELATED.test(arm.code));
      const tables = [
        ...new Set(
          [...arm.code.matchAll(/\b(?:FROM|JOIN)\s+(\w+)/gi)]
            .map((m) => m[1]!)
            .filter((table) => owned.has(table)),
        ),
      ];
      const blind = new RegExp(`\\b(?:FROM|JOIN)\\s+${OPAQUE}`, "i").test(
        arm.code,
      );

      if (!scoped && tables.length > 0) report(arm, tables.join(", "));
      else if (!scoped && blind) report(arm, "a table the guard cannot read");

      for (const block of arm.nested) judge(block, scoped, true, report);
    }
  }

  const fragments: Array<ts.StringLiteralLike | ts.TemplateExpression> = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node)
    ) {
      fragments.push(node);
      judgeStatement(chainTop(node) as ts.Expression);
    }
    ts.forEachChild(node, visit);
  };

  /**
   * A fragment that names a tenant-owned table after FROM or JOIN, yet reached
   * no judged statement: it was joined, concatenated or passed on in a way the
   * guard does not follow. DELETE is not a read.
   */
  function reportStrayFragments() {
    for (const fragment of fragments) {
      if (consumed.has(fragment)) continue;

      const text = literalTexts(fragment).join(OPAQUE);
      const arms = parseArms(text, { i: 0 }, false);
      const code = arms.map((arm) => arm.code).join(" ");
      if (/\bDELETE\b/i.test(code)) continue;

      const tables = [...code.matchAll(/\b(?:FROM|JOIN)\s+(\w+)/gi)]
        .map((m) => m[1]!)
        .filter((table) => owned.has(table));
      if (tables.length === 0) continue;

      const line =
        file.getLineAndCharacterOfPosition(fragment.getStart(file)).line + 1;
      const sql = describeArm(text);
      const key = `${line}\n${sql}`;
      if (reported.has(key)) continue;
      reported.add(key);
      found.push({
        line,
        detail: `${[...new Set(tables)].join(", ")}, in a fragment the guard cannot follow into a statement`,
        sql,
      });
    }
  }

  const judged = new Set<ts.Node>();

  function judgeStatement(top: ts.Expression) {
    if (judged.has(top)) return;
    judged.add(top);
    if (!holdsSelect(top) || attached.has(top)) return;

    const line =
      file.getLineAndCharacterOfPosition(top.getStart(file)).line + 1;
    const note = (arm: string, detail: string) => {
      const key = `${line}\n${arm}`;
      if (reported.has(key)) return;
      reported.add(key);
      found.push({ line, detail, sql: arm });
    };

    // The declaration this statement initializes, so its appends count.
    let target: ts.Symbol | undefined;
    const parent = top.parent;
    if (
      ts.isVariableDeclaration(parent) &&
      parent.initializer === top &&
      ts.isIdentifier(parent.name)
    ) {
      target = symbolAt(parent.name);
    } else if (
      ts.isBinaryExpression(parent) &&
      parent.right === top &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(parent.left)
    ) {
      target = symbolAt(parent.left);
    }

    let texts: string[];
    try {
      const root = target
        ? bind(target).roots.find((candidate) => candidate.expr === top)
        : undefined;
      const seen = new Set(target ? [target] : []);
      texts = root ? rootAlternatives(root, seen) : alternatives(top, seen);
    } catch (error) {
      if (!(error instanceof Undecidable)) throw error;
      note(
        describeArm(literalTexts(top).join(OPAQUE)),
        "too many branches to read",
      );
      return;
    }

    for (const sql of texts) {
      judge(parseArms(sql, { i: 0 }, false), false, false, (arm, detail) =>
        note(describeArm(arm.own), detail),
      );
    }
  }

  for (const symbol of references.keys()) bind(symbol);

  visit(file);
  reportStrayFragments();

  return found.sort((a, b) => a.line - b.line);
}
