// One-off codemod: wraps Arabic display text in t('…') calls.
// Usage: node scripts/i18n/codemod.cjs [api|web|mobile]...
const path = require('path');
const fs = require('fs');
const { ROOT, ts, AR, jsxText, sourceFile, isDataPosition, literalKey, targets } = require('./shared.cjs');

const RENAME = 'tr';

function importLine(app, file) {
  if (app === 'web') return "import { t } from '@/lib/i18n';";
  if (app === 'api') {
    let r = path.relative(path.dirname(file), path.join(ROOT, 'apps/api/src/lib/i18n.js'));
    if (!r.startsWith('.')) r = './' + r;
    return `import { t } from '${r}';`;
  }
  let r = path.relative(path.dirname(file), path.join(ROOT, 'apps/mobile/src/i18n'));
  if (!r.startsWith('.')) r = './' + r;
  return `import { t } from '${r}';`;
}

function apply(text, edits) {
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  return text;
}

/** Renames local bindings called `t` so they don't hide the translate function. */
function renameLocalT(file) {
  const src = sourceFile(file);
  const scopes = [];
  const visit = (n) => {
    if (
      (ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isBindingElement(n)) &&
      ts.isIdentifier(n.name) &&
      n.name.text === 't'
    ) {
      let s = n.parent;
      while (s && !ts.isFunctionLike(s) && !ts.isBlock(s) && !ts.isSourceFile(s) && !ts.isForOfStatement(s) && !ts.isForStatement(s)) s = s.parent;
      if (ts.isParameter(n)) s = n.parent;
      scopes.push(s);
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  if (!scopes.length) return false;
  const edits = new Map();
  for (const scope of scopes) {
    const walk = (n) => {
      if (ts.isIdentifier(n) && n.text === 't') {
        const p = n.parent;
        const isPropName =
          (ts.isPropertyAccessExpression(p) && p.name === n) ||
          (ts.isPropertyAssignment(p) && p.name === n) ||
          (ts.isPropertySignature(p) && p.name === n) ||
          (ts.isBindingElement(p) && p.propertyName === n);
        if (!isPropName) {
          const start = n.getStart();
          if (ts.isShorthandPropertyAssignment(p)) edits.set(start, { start, end: n.end, text: `t: ${RENAME}` });
          else edits.set(start, { start, end: n.end, text: RENAME });
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(scope);
  }
  fs.writeFileSync(file, apply(src.getFullText(), [...edits.values()]));
  return true;
}

const quote = (s) => JSON.stringify(s);

/** One pass: finds innermost candidates and replaces them. Returns number of edits. */
function pass(file) {
  const src = sourceFile(file);
  const text = src.getFullText();
  const cands = [];

  const simpleExpr = (c) =>
    ts.isJsxExpression(c) &&
    c.expression &&
    !AR.test(c.expression.getText()) &&
    !/<[A-Za-z]/.test(c.expression.getText());

  const visit = (n) => {
    // JSX children runs.
    if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
      const kids = n.children;
      let run = [];
      const flush = () => {
        if (run.length) {
          const pieces = [];
          const args = [];
          for (const c of run) {
            if (ts.isJsxText(c)) pieces.push(jsxText(c.getFullText()));
            else if (ts.isStringLiteral(c.expression)) pieces.push(c.expression.text);
            else {
              pieces.push(`{${args.length}}`);
              args.push(c.expression.getText());
            }
          }
          const joined = pieces.join('');
          if (AR.test(joined) && !joined.includes('&')) {
            const lead = /^\s/.test(joined);
            const trail = /\s$/.test(joined);
            const key = joined.trim().replace(/\s+/g, ' ');
            const call = `{t(${[quote(key), ...args].join(', ')})}`;
            const first = run[0];
            const last = run[run.length - 1];
            cands.push({
              start: first.getStart(),
              end: last.end,
              text: (lead ? "{' '}" : '') + call + (trail ? "{' '}" : ''),
            });
          }
        }
        run = [];
      };
      for (const c of kids) {
        if (ts.isJsxText(c) || simpleExpr(c)) run.push(c);
        else flush();
      }
      flush();
    }
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
      const own = ts.isTemplateExpression(n)
        ? n.head.text + n.templateSpans.map((s) => s.literal.text).join('')
        : n.text;
      if (AR.test(own) && !isDataPosition(n) && !ts.isTaggedTemplateExpression(n.parent)) {
        const { key, args } = literalKey(n);
        const call = `t(${[quote(key), ...args].join(', ')})`;
        const inAttr = ts.isJsxAttribute(n.parent);
        cands.push({ start: n.getStart(), end: n.end, text: inAttr ? `{${call}}` : call });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  // Innermost only: drop candidates that contain another.
  const leaves = cands.filter(
    (a) => !cands.some((b) => b !== a && b.start >= a.start && b.end <= a.end && (b.start !== a.start || b.end !== a.end)),
  );
  // Remove duplicates with the same range.
  const seen = new Set();
  const edits = leaves.filter((e) => (seen.has(`${e.start}:${e.end}`) ? false : seen.add(`${e.start}:${e.end}`)));
  if (edits.length) fs.writeFileSync(file, apply(text, edits));
  return edits.length;
}

function addImport(app, file) {
  let text = fs.readFileSync(file, 'utf8');
  if (!/\bt\(/.test(text)) return;
  const line = importLine(app, file);
  if (text.includes(line)) return;
  const src = sourceFile(file);
  let pos = 0;
  for (const s of src.statements) {
    if (ts.isImportDeclaration(s)) pos = s.end;
    else if (ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && pos === 0) pos = s.end;
    else break;
  }
  text = text.slice(0, pos) + (pos ? '\n' : '') + line + (pos ? '' : '\n') + text.slice(pos);
  fs.writeFileSync(file, text);
}

const apps = process.argv.slice(2);
const all = targets();
for (const app of apps) {
  let files = 0;
  let total = 0;
  for (const file of all[app]) {
    const before = fs.readFileSync(file, 'utf8');
    if (!AR.test(before)) continue;
    renameLocalT(file);
    let n;
    let i = 0;
    let count = 0;
    while ((n = pass(file)) && i++ < 12) count += n;
    if (count) {
      addImport(app, file);
      files++;
      total += count;
    } else fs.writeFileSync(file, before);
  }
  console.log(app, 'files', files, 'edits', total);
}
