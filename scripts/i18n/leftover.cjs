// Prints Arabic literals that are not inside a t(...) call, for review.
const fs = require('fs');
const { ts, AR, sourceFile, targets, calleeName } = require('./shared.cjs');
const app = process.argv[2];
for (const f of targets()[app]) {
  const src = sourceFile(f);
  const visit = (n, inT) => {
    const isT = ts.isCallExpression(n) && /^(t|tr)$/.test(calleeName(n));
    if (!inT && !isT && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n) || ts.isJsxText(n)) && AR.test(n.getText())) {
      const { line } = src.getLineAndCharacterOfPosition(n.getStart());
      console.log(`${f.replace(/.*apps\//, '')}:${line + 1}  ${n.getText().slice(0, 90).replace(/\n/g, ' ')}`);
    }
    ts.forEachChild(n, (c) => visit(c, inT || isT));
  };
  visit(src, false);
}
