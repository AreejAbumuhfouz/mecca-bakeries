// Shared helpers for the i18n codemod and the dictionary extractor.
// A "key" is the Arabic source text; template expressions become {0}, {1}, ...
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../..');
const ts = require(require.resolve('typescript', { paths: [path.join(ROOT, 'apps/api')] }));
const AR = /[؀-ۿ]/;

/** Attributes whose Arabic value is data, not display text. */
const SKIP_ATTRS = new Set(['value', 'key', 'defaultValue', 'href', 'id', 'name', 'className', 'type', 'dir', 'lang', 'src']);
/** Object properties whose value is data. */
const SKIP_PROPS = new Set(['value', 'key', 'code', 'id', 'kind']);
/** Calls whose arguments are not shown to users. */
const SKIP_CALLEE = /^(logger|console|log)\.|^t$|^tr$|^translate$|^require$|^describe$|^it$|^test$|^expect$/;

/** Turns a JSX text run into the text React would render (whitespace rules). */
function jsxText(raw) {
  const lines = raw.split(/\r?\n/);
  if (lines.length === 1) return raw;
  const out = [];
  lines.forEach((line, i) => {
    let l = line;
    if (i !== 0) l = l.replace(/^\s+/, '');
    if (i !== lines.length - 1) l = l.replace(/\s+$/, '');
    if (l) out.push(l);
  });
  return out.join(' ');
}

function sourceFile(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function calleeName(call) {
  return call.expression.getText();
}

/** True when a literal at this node must stay as it is. */
function isDataPosition(node) {
  const p = node.parent;
  if (!p) return true;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p)) return true;
  if (ts.isLiteralTypeNode(p)) return true;
  if (ts.isPropertyAssignment(p) && p.name === node) return true;
  if (ts.isPropertyAssignment(p) && SKIP_PROPS.has(p.name.getText().replace(/['"]/g, ''))) return true;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return true;
  if (ts.isCaseClause(p)) return true;
  if (ts.isBinaryExpression(p) && /^(===|!==|==|!=|in)$/.test(p.operatorToken.getText())) return true;
  if (ts.isEnumMember(p)) return true;
  if (ts.isJsxAttribute(p) && SKIP_ATTRS.has(p.name.getText())) return true;
  if (ts.isCallExpression(p) && SKIP_CALLEE.test(calleeName(p))) return true;
  // Directives like 'use client'.
  if (ts.isExpressionStatement(p)) return true;
  return false;
}

/** {key, args} for a string literal or template expression. */
function literalKey(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { key: node.text, args: [] };
  // Template expression: head + spans.
  let key = node.head.text;
  const args = [];
  node.templateSpans.forEach((span, i) => {
    key += `{${i}}` + span.literal.text;
    args.push(span.expression.getText());
  });
  return { key, args };
}

function isFiles(dir, filter) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!['node_modules', '.next', 'dist', '.expo'].includes(e.name)) walk(f);
      } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts') && filter(f)) out.push(f);
    }
  };
  walk(dir);
  return out;
}

/** Every file whose Arabic text is translated, per app. */
function targets() {
  const rel = (f) => path.relative(ROOT, f);
  const api = isFiles(path.join(ROOT, 'apps/api/src'), (f) => {
    const r = rel(f);
    return !/db\/(seed|migrations)|whatsapp\/templates\.ts|lib\/i18n\.ts/.test(r);
  });
  const web = isFiles(path.join(ROOT, 'apps/web/src'), (f) => !/lib\/i18n\.tsx?$/.test(rel(f)));
  const mobile = [
    ...isFiles(path.join(ROOT, 'apps/mobile/src'), (f) => !/src\/i18n\.tsx?$/.test(rel(f))),
    path.join(ROOT, 'apps/mobile/App.tsx'),
  ];
  const shared = isFiles(path.join(ROOT, 'packages/shared/src'), (f) => !/i18n\//.test(rel(f)));
  return { api, web, mobile, shared };
}

module.exports = { ROOT, ts, AR, jsxText, sourceFile, isDataPosition, literalKey, targets, SKIP_CALLEE, calleeName };
