// API only: module-level t('…') runs once at import, outside any request, so it would
// always be Arabic. Turn it back into a plain string; those texts are translated where
// they are sent (error handler, reports, import screens).
const fs = require('fs');
const { ts, sourceFile, targets, calleeName } = require('./shared.cjs');
let n = 0;
for (const f of targets().api) {
  const src = sourceFile(f);
  const edits = [];
  const visit = (node, inFn) => {
    if (!inFn && ts.isCallExpression(node) && calleeName(node) === 't') {
      const [a, ...rest] = node.arguments;
      if (a && ts.isStringLiteral(a) && !rest.length) edits.push({ s: node.getStart(), e: node.end, x: a.getText() });
      else if (a && ts.isStringLiteral(a)) {
        // Template with args: rebuild a template literal.
        let i = 0;
        const body = a.text.replace(/\{(\d+)\}/g, (_, k) => '${' + rest[Number(k)].getText() + '}');
        edits.push({ s: node.getStart(), e: node.end, x: '`' + body.replace(/`/g, '\\`') + '`' });
      }
      return;
    }
    ts.forEachChild(node, (c) => visit(c, inFn || ts.isFunctionLike(c)));
  };
  visit(src, false);
  if (!edits.length) continue;
  let text = src.getFullText();
  edits.sort((a, b) => b.s - a.s).forEach((e) => (text = text.slice(0, e.s) + e.x + text.slice(e.e)));
  if (!/\bt\(/.test(text.replace(/import \{ t \} from [^\n]+\n/, ''))) text = text.replace(/import \{ t \} from [^\n]+\n/, '');
  fs.writeFileSync(f, text);
  n += edits.length;
}
console.log('unwrapped', n);
