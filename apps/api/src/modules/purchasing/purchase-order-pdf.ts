import { embeddedFontCss, escapeHtml } from '../../lib/pdf.js';
import { t } from '../../lib/i18n.js';

export type PurchaseOrderDoc = {
  number: string;
  createdAt: Date;
  neededDate: string | null;
  notes: string | null;
  supplier: {
    name: string;
    contactName: string | null;
    phone: string | null;
    address: string | null;
  };
  bakery: {
    name: string;
    phone: string | null;
    address: string | null;
    logoDataUrl: string | null;
  };
  lines: { description: string; quantity: string; unit: string; note: string | null }[];
};

const fmtQty = (q: string) => String(Number(q));
const fmtDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman' }).format(d);

/** Arabic RTL purchase order, rendered to PDF by Chromium. */
export function purchaseOrderHtml(po: PurchaseOrderDoc) {
  const e = escapeHtml;
  const rows = po.lines
    .map(
      (l, i) => `<tr>
        <td class="n">${i + 1}</td>
        <td>${e(l.description)}</td>
        <td class="q">${e(fmtQty(l.quantity))}</td>
        <td>${e(l.unit)}</td>
        <td class="muted">${e(l.note)}</td>
      </tr>`,
    )
    .join('');
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<style>
${embeddedFontCss()}
*{box-sizing:border-box}
body{font-family:Cairo,'Geeza Pro','Noto Naskh Arabic',sans-serif;color:#3E2A1C;margin:0;font-size:13px}
header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #C8862A;padding-bottom:12px}
header img{height:70px}
h1{font-size:24px;margin:0}
.muted{color:#7A6E62}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}
.box{border:1px solid #E8DCC8;border-radius:10px;padding:10px 12px;background:#FBF7F0}
.box b{display:block;margin-bottom:2px}
table{width:100%;border-collapse:collapse;margin-top:8px}
th{background:#3E2A1C;color:#fff;text-align:right;padding:8px;font-weight:700}
td{border-bottom:1px solid #E8DCC8;padding:8px;vertical-align:top}
td.n{width:36px;text-align:center}
td.q{font-weight:700;direction:ltr;text-align:right}
.notes{margin-top:16px}
footer{margin-top:28px;display:flex;justify-content:space-between;color:#7A6E62;font-size:11px}
.sign{margin-top:40px;display:grid;grid-template-columns:1fr 1fr;gap:40px}
.sign div{border-top:1px solid #3E2A1C;padding-top:6px;text-align:center}
</style></head><body>
<header>
  <div>
    <h1>${t('طلب شراء')}</h1>
    <div class="muted">${t('رقم')} <b dir="ltr">${e(po.number)}</b> ${t('— تاريخ')} <span dir="ltr">${fmtDate(po.createdAt)}</span></div>
  </div>
  <div style="text-align:left">
    ${po.bakery.logoDataUrl ? `<img src="${po.bakery.logoDataUrl}" alt="">` : `<b>${e(po.bakery.name)}</b>`}
  </div>
</header>
<div class="meta">
  <div class="box"><b>${t('من')}</b>${e(po.bakery.name)}<br><span class="muted">${e(po.bakery.phone)} ${e(po.bakery.address)}</span></div>
  <div class="box"><b>${t('إلى المورد')}</b>${e(po.supplier.name)}${po.supplier.contactName ? ` — ${e(po.supplier.contactName)}` : ''}<br>
    <span class="muted" dir="ltr">${e(po.supplier.phone)}</span> <span class="muted">${e(po.supplier.address)}</span></div>
  <div class="box"><b>${t('مطلوب بتاريخ')}</b><span dir="ltr">${e(po.neededDate ?? '—')}</span></div>
  <div class="box"><b>${t('عدد البنود')}</b>${po.lines.length}</div>
</div>
<table>
  <thead><tr><th>#</th><th>${t('المادة')}</th><th>${t('الكمية')}</th><th>${t('الوحدة')}</th><th>${t('ملاحظة')}</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
${po.notes ? `<div class="notes box"><b>${t('ملاحظات')}</b>${e(po.notes)}</div>` : ''}
<div class="sign"><div>${t('توقيع المخبز')}</div><div>${t('توقيع المورد بالاستلام')}</div></div>
<footer><span>${e(po.bakery.name)}</span><span dir="ltr">${e(po.number)}</span></footer>
</body></html>`;
}
