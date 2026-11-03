import { filsToJodString } from '@mecca/shared';
import { embeddedFontCss, escapeHtml as e } from '../../lib/pdf.js';
import type { BrandHeader } from '../../lib/brand-header.js';

const jod = (fils: number) => filsToJodString(fils);

/** Shared look of every printed document (Arabic, RTL, brand colours). */
const baseCss = () => `
${embeddedFontCss()}
*{box-sizing:border-box}
body{font-family:Cairo,'Geeza Pro','Noto Naskh Arabic',sans-serif;color:#3E2A1C;margin:0;font-size:12.5px}
header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #C8862A;padding-bottom:10px}
header img{height:68px}
h1{font-size:22px;margin:0}
.muted{color:#7A6E62}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0}
.box{border:1px solid #E8DCC8;border-radius:10px;padding:8px 12px;background:#FBF7F0}
.box b{display:block;margin-bottom:2px}
table{width:100%;border-collapse:collapse;margin-top:6px}
th{background:#3E2A1C;color:#fff;text-align:right;padding:7px;font-weight:700}
td{border-bottom:1px solid #E8DCC8;padding:7px;vertical-align:top}
.num{direction:ltr;text-align:right;white-space:nowrap}
.b{font-weight:700}
.ret td{color:#9B2C22}
.totals{margin-top:12px;margin-right:auto;width:46%}
.totals td{padding:5px 8px}
.totals tr.grand td{font-size:15px;font-weight:700;border-top:2px solid #3E2A1C;border-bottom:none}
footer{margin-top:24px;display:flex;justify-content:space-between;color:#7A6E62;font-size:10.5px}
.sign{margin-top:34px;display:grid;grid-template-columns:1fr 1fr;gap:40px}
.sign div{border-top:1px solid #3E2A1C;padding-top:6px;text-align:center}
.stamp{display:inline-block;border:2px solid #9B2C22;color:#9B2C22;border-radius:8px;padding:2px 10px;font-weight:700}
.page{page-break-after:always}
.page:last-child{page-break-after:auto}
`;

const brandBlock = (b: BrandHeader) =>
  b.logoDataUrl
    ? `<img src="${b.logoDataUrl}" alt="">`
    : `<b style="font-size:18px">${e(b.name)}</b>`;

const doc = (title: string, body: string) => `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${e(title)}</title>
<style>${baseCss()}</style></head><body>${body}</body></html>`;

// ---------------------------------------------------------------- invoice

export type InvoiceDoc = {
  number: string;
  kind: 'sale' | 'opening';
  status: 'draft' | 'approved' | 'cancelled';
  issueDate: string;
  dueDate: string;
  brand: BrandHeader;
  customer: { code: string; name: string; phone: string | null; address: string | null };
  branchName: string | null;
  orderNumber: string | null;
  receiverName: string | null;
  lines: {
    kind: 'sale' | 'return';
    description: string;
    unit: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
  grossTotal: number;
  discount1Amount: number;
  discount2Bps: number;
  discount2Amount: number;
  returnsTotal: number;
  total: number;
  paid: number;
  notes: string | null;
};

export function invoiceHtml(inv: InvoiceDoc) {
  const rows = inv.lines
    .map(
      (l, i) => `<tr class="${l.kind === 'return' ? 'ret' : ''}">
      <td>${i + 1}</td>
      <td>${l.kind === 'return' ? 'مرتجع: ' : ''}${e(l.description)}</td>
      <td>${e(l.unit)}</td>
      <td class="num b">${l.quantity}</td>
      <td class="num">${jod(l.unitPrice)}</td>
      <td class="num b">${jod(l.lineTotal)}</td>
    </tr>`,
    )
    .join('');
  const sales = inv.grossTotal - inv.discount1Amount;
  const totals = [
    inv.discount1Amount
      ? `<tr><td>الإجمالي قبل الخصم</td><td class="num">${jod(inv.grossTotal)}</td></tr>
         <tr><td>الخصم الأول (خصم العقد)</td><td class="num">− ${jod(inv.discount1Amount)}</td></tr>`
      : '',
    `<tr><td>المبيعات</td><td class="num">${jod(sales)}</td></tr>`,
    inv.discount2Amount
      ? `<tr><td>الخصم الثاني (${inv.discount2Bps / 100}%)</td><td class="num">− ${jod(inv.discount2Amount)}</td></tr>`
      : '',
    inv.returnsTotal
      ? `<tr><td>المرتجعات</td><td class="num">− ${jod(inv.returnsTotal)}</td></tr>`
      : '',
    `<tr class="grand"><td>الصافي المستحق</td><td class="num">${jod(inv.total)} د.أ</td></tr>`,
    inv.paid
      ? `<tr><td>المدفوع</td><td class="num">${jod(inv.paid)}</td></tr>
         <tr><td class="b">المتبقي</td><td class="num b">${jod(inv.total - inv.paid)}</td></tr>`
      : '',
  ].join('');
  const title = inv.kind === 'opening' ? 'رصيد افتتاحي' : 'فاتورة';
  return doc(
    inv.number,
    `<header>
  <div>
    <h1>${title} ${inv.status === 'cancelled' ? '<span class="stamp">ملغاة</span>' : inv.status === 'draft' ? '<span class="stamp" style="color:#7A6E62;border-color:#7A6E62">مسودة</span>' : ''}</h1>
    <div class="muted">رقم <b dir="ltr">${e(inv.number)}</b> — تاريخ <span dir="ltr">${e(inv.issueDate)}</span></div>
  </div>
  <div style="text-align:left">${brandBlock(inv.brand)}</div>
</header>
<div class="meta">
  <div class="box"><b>${e(inv.brand.name)}</b><span class="muted">${e(inv.brand.phone)} ${e(inv.brand.address)}</span></div>
  <div class="box"><b>العميل</b>${e(inv.customer.name)} <span class="muted" dir="ltr">${e(inv.customer.code)}</span>${inv.branchName ? ` — ${e(inv.branchName)}` : ''}<br><span class="muted">${e(inv.customer.address)}</span></div>
  <div class="box"><b>تاريخ الاستحقاق</b><span dir="ltr">${e(inv.dueDate)}</span></div>
  <div class="box"><b>${inv.orderNumber ? 'رقم الطلب' : 'ملاحظة'}</b>${inv.orderNumber ? `<span dir="ltr">${e(inv.orderNumber)}</span>` : e(inv.notes)}${inv.receiverName ? ` — استلمه: ${e(inv.receiverName)}` : ''}</div>
</div>
${
  inv.lines.length
    ? `<table><thead><tr><th>#</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr></thead><tbody>${rows}</tbody></table>`
    : ''
}
<table class="totals"><tbody>${totals}</tbody></table>
${inv.notes && inv.orderNumber ? `<div class="box" style="margin-top:12px"><b>ملاحظات</b>${e(inv.notes)}</div>` : ''}
<div class="sign"><div>المحاسب</div><div>توقيع العميل</div></div>
<footer><span>${e(inv.brand.footer ?? inv.brand.name)}</span><span dir="ltr">${e(inv.number)}</span></footer>`,
  );
}

// ---------------------------------------------------------------- statement

export type StatementDoc = {
  brand: BrandHeader;
  customer: { code: string; name: string; phone: string | null; address: string | null };
  from: string;
  to: string;
  opening: number;
  rows: {
    date: string;
    number: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }[];
  closing: number;
  overdue: number;
  aging: { label: string; amount: number }[];
  printedOn: string;
};

export function statementHtml(s: StatementDoc) {
  const rows = s.rows
    .map(
      (r) => `<tr>
      <td class="num">${e(r.date)}</td>
      <td class="num">${e(r.number)}</td>
      <td>${e(r.description)}</td>
      <td class="num">${r.debit ? jod(r.debit) : ''}</td>
      <td class="num">${r.credit ? jod(r.credit) : ''}</td>
      <td class="num b">${jod(r.balance)}</td>
    </tr>`,
    )
    .join('');
  const aging = s.aging
    .map(
      (a) =>
        `<td><div class="muted">${e(a.label)}</div><div class="num b">${jod(a.amount)}</div></td>`,
    )
    .join('');
  return doc(
    `كشف حساب ${s.customer.name}`,
    `<header>
  <div>
    <h1>كشف حساب</h1>
    <div class="muted">من <span dir="ltr">${e(s.from)}</span> إلى <span dir="ltr">${e(s.to)}</span></div>
  </div>
  <div style="text-align:left">${brandBlock(s.brand)}</div>
</header>
<div class="meta">
  <div class="box"><b>العميل</b>${e(s.customer.name)} <span class="muted" dir="ltr">${e(s.customer.code)}</span><br><span class="muted">${e(s.customer.address)}</span></div>
  <div class="box"><b>الرصيد المستحق</b><span class="num" style="font-size:16px;font-weight:700">${jod(s.closing)} د.أ</span>${s.overdue ? ` — <span style="color:#9B2C22">متأخر ${jod(s.overdue)}</span>` : ''}</div>
</div>
<table>
  <thead><tr><th>التاريخ</th><th>الرقم</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
  <tbody>
    <tr><td></td><td></td><td class="b">رصيد سابق</td><td></td><td></td><td class="num b">${jod(s.opening)}</td></tr>
    ${rows}
    <tr><td></td><td></td><td class="b">الرصيد الختامي</td><td></td><td></td><td class="num b">${jod(s.closing)}</td></tr>
  </tbody>
</table>
<h3 style="margin:16px 0 4px">أعمار الذمم</h3>
<table><tbody><tr>${aging}</tr></tbody></table>
<footer><span>${e(s.brand.footer ?? s.brand.name)}</span><span>طُبع <span dir="ltr">${e(s.printedOn)}</span></span></footer>`,
  );
}

// ---------------------------------------------------------------- loading sheet

export type LoadingSheetDoc = {
  brand: BrandHeader;
  deliveryDate: string;
  routeName: string;
  driverName: string | null;
  vehicleName: string | null;
  totals: { code: string; name: string; unit: string; quantity: number }[];
  stops: {
    position: number;
    customerName: string;
    branchName: string;
    address: string | null;
    phone: string | null;
    orderNumber: string;
    orderTotal: number;
    previousBalance: number;
    paymentType: string;
    lines: { name: string; quantity: number }[];
  }[];
};

export function loadingSheetHtml(s: LoadingSheetDoc) {
  const totals = s.totals
    .map(
      (t) =>
        `<tr><td class="num">${e(t.code)}</td><td>${e(t.name)}</td><td>${e(t.unit)}</td><td class="num b" style="font-size:14px">${t.quantity}</td><td style="width:70px"></td></tr>`,
    )
    .join('');
  const stops = s.stops
    .map(
      (st) => `<tr>
      <td class="b">${st.position}</td>
      <td><b>${e(st.customerName)}</b> — ${e(st.branchName)}<br><span class="muted">${e(st.address)} <span dir="ltr">${e(st.phone)}</span></span><br>
        <span class="muted">${st.lines.map((l) => `${e(l.name)} × ${l.quantity}`).join('، ')}</span></td>
      <td class="num">${e(st.orderNumber)}</td>
      <td class="num">${jod(st.orderTotal)}</td>
      <td class="num ${st.previousBalance > 0 ? 'b' : ''}">${jod(st.previousBalance)}</td>
      <td>${e(st.paymentType)}</td>
      <td style="width:80px"></td>
    </tr>`,
    )
    .join('');
  return doc(
    `كشف تحميل ${s.routeName}`,
    `<header>
  <div>
    <h1>كشف التحميل والتوزيع</h1>
    <div class="muted">${e(s.routeName)} — <span dir="ltr">${e(s.deliveryDate)}</span></div>
  </div>
  <div style="text-align:left">${brandBlock(s.brand)}</div>
</header>
<div class="meta">
  <div class="box"><b>السائق</b>${e(s.driverName ?? '—')}</div>
  <div class="box"><b>السيارة</b>${e(s.vehicleName ?? '—')}</div>
</div>
<h3 style="margin:10px 0 4px">ما يُحمَّل على السيارة</h3>
<table><thead><tr><th>الكود</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>✓</th></tr></thead><tbody>${totals}</tbody></table>
<h3 style="margin:16px 0 4px">ترتيب التوزيع</h3>
<table><thead><tr><th>#</th><th>المطعم والأصناف</th><th>الطلب</th><th>قيمة الطلب</th><th>رصيد سابق</th><th>الدفع</th><th>التوقيع</th></tr></thead><tbody>${stops}</tbody></table>
<div class="sign"><div>مسؤول التحميل</div><div>السائق</div></div>
<footer><span>${e(s.brand.name)}</span><span dir="ltr">${e(s.deliveryDate)}</span></footer>`,
  );
}
