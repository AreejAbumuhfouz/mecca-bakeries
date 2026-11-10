// API: a t('…') whose key is an HTML document gets split back into a template literal
// with one t() per Arabic text between tags.
const fs = require('fs');
const { ts, AR, sourceFile, targets, calleeName } = require('./shared.cjs');
const q = (s) => JSON.stringify(s);
for (const f of targets().api) for (let round = 0; round < 6; round++) {
  const src = sourceFile(f);
  const edits = [];
  const visit = (n) => {
    if (ts.isCallExpression(n) && calleeName(n) === 't') {
      const [a, ...rest] = n.arguments;
      if (a && ts.isStringLiteral(a) && /<[a-z]/i.test(a.text)) {
        const args = rest.map((r) => r.getText());
        // Split into tag / text chunks; translate text chunks with Arabic.
        const parts = a.text.split(/(<[^>]*>)/);
        let out = '';
        for (const p of parts) {
          const esc = (x) => x.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
          if (p.startsWith('<') || !AR.test(p)) {
            out += p
              .split(/(\{\d+\})/)
              .map((c) => (/^\{\d+\}$/.test(c) ? '${' + args[Number(c.slice(1, -1))] + '}' : esc(c)))
              .join('');
            continue;
          }
          const lead = p.match(/^\s*/)[0];
          const trail = p.match(/\s*$/)[0];
          const core = p.trim();
          const used = [];
          const key = core.replace(/\{(\d+)\}/g, (_, i) => {
            used.push(args[Number(i)]);
            return `{${used.length - 1}}`;
          });
          out += esc(lead) + '${t(' + [q(key), ...used].join(', ') + ')}' + esc(trail);
        }
        edits.push({ s: n.getStart(), e: n.end, x: '`' + out + '`' });
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  if (!edits.length) break;
  let text = src.getFullText();
  edits.sort((a, b) => b.s - a.s).forEach((e) => (text = text.slice(0, e.s) + e.x + text.slice(e.e)));
  fs.writeFileSync(f, text);
  console.log(f.replace(/.*src\//, ''), edits.length);
}
