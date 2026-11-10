// Lists every Arabic text used by the apps (the dictionary keys) and reports the ones
// with no English translation. `node scripts/i18n/extract.cjs --json` prints the missing keys.
const fs = require('fs');
const path = require('path');
const { ROOT, ts, AR, sourceFile, literalKey, targets, calleeName } = require('./shared.cjs');

function keysOf(file) {
  const src = sourceFile(file);
  const keys = new Set();
  const visit = (n) => {
    if (ts.isCallExpression(n) && /^(t)$/.test(calleeName(n))) {
      const a = n.arguments[0];
      if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) {
        if (AR.test(a.text)) keys.add(a.text);
      }
    } else if (
      (ts.isStringLiteral(n) ||
        ts.isNoSubstitutionTemplateLiteral(n) ||
        ts.isTemplateExpression(n)) &&
      !ts.isTaggedTemplateExpression(n.parent)
    ) {
      const { key } = literalKey(n);
      // Plain Arabic strings (shared labels, server messages kept as keys).
      if (AR.test(key) && !/<[a-z]|\bselect\b|coalesce\(/i.test(key)) keys.add(key);
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return keys;
}

function allKeys() {
  const all = new Set();
  const t = targets();
  for (const f of [...t.api, ...t.web, ...t.mobile, ...t.shared])
    for (const k of keysOf(f)) all.add(k);
  return [...all].sort();
}

if (require.main === module) {
  // en.ts is TypeScript; read it as JSON-ish via a tiny parse of its object literal.
  const enFile = path.join(ROOT, 'packages/shared/src/i18n/en.ts');
  const en = fs.existsSync(enFile) ? loadEn(enFile) : {};
  const keys = allKeys();
  const missing = keys.filter((k) => !(k in en));
  if (process.argv.includes('--json')) console.log(JSON.stringify(missing, null, 1));
  else console.log(`keys ${keys.length}, missing ${missing.length}`);
  if (process.argv.includes('--check') && missing.length) process.exit(1);
}

function loadEn(file) {
  const src = sourceFile(file);
  const out = {};
  const visit = (n) => {
    if (ts.isPropertyAssignment(n) && ts.isStringLiteral(n.initializer)) {
      const k = ts.isStringLiteral(n.name) ? n.name.text : n.name.getText();
      out[k] = n.initializer.text;
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

module.exports = { allKeys, loadEn };
