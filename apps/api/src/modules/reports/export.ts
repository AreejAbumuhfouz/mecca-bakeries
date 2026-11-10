import ExcelJS from 'exceljs';
import { sql } from 'drizzle-orm';
import { filsToJodString } from '@mecca/shared';
import type { Db } from '../../db/client.js';
import { embeddedFontCss, escapeHtml as e } from '../../lib/pdf.js';
import type { BrandHeader } from '../../lib/brand-header.js';
import type { Column, ReportTable, Row } from './reports.service.js';
import { currentLocale, isRtlNow, t } from '../../lib/i18n.js';

const BROWN = 'FF3E2A1C';
const CREAM = 'FFFBF7F0';

/** Money stays in fils in the data; Excel shows dinars with three decimals. */
function cellValue(c: Column, v: Row[string]) {
  if (v === null || v === undefined || v === '') return null;
  if (c.kind === 'money') return Number(v) / 1000;
  if (c.kind === 'percent') return Number(v) / 100;
  if (c.kind === 'int') return Number(v);
  return String(v);
}

function addTableSheet(
  wb: ExcelJS.Workbook,
  name: string,
  table: Pick<ReportTable, 'title' | 'subtitle' | 'columns' | 'rows' | 'totals'>,
) {
  const ws = wb.addWorksheet(name.slice(0, 31), {
    views: [{ rightToLeft: isRtlNow(), state: 'frozen', ySplit: 3 }],
  });
  ws.mergeCells(1, 1, 1, Math.max(1, table.columns.length));
  ws.getCell(1, 1).value = table.title;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: BROWN } };
  ws.getCell(2, 1).value = table.subtitle;
  ws.getCell(2, 1).font = { color: { argb: 'FF7A6E62' } };
  const header = ws.getRow(3);
  table.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BROWN } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    ws.getColumn(i + 1).width = c.kind === 'text' ? 26 : 15;
    ws.getColumn(i + 1).numFmt =
      c.kind === 'money'
        ? '#,##0.000'
        : c.kind === 'percent'
          ? '0.0%'
          : c.kind === 'int'
            ? '#,##0'
            : '@';
  });
  header.height = 30;
  for (const r of table.rows) ws.addRow(table.columns.map((c) => cellValue(c, r[c.key])));
  if (table.totals) {
    const tr = ws.addRow(
      table.columns.map((c, i) =>
        i === 0
          ? String(table.totals![c.key] ?? t('المجموع'))
          : c.kind === 'percent'
            ? null
            : cellValue(c, table.totals![c.key]),
      ),
    );
    tr.font = { bold: true };
    tr.eachCell(
      (cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CREAM } }),
    );
  }
  return ws;
}

export async function reportXlsx(table: ReportTable) {
  const wb = new ExcelJS.Workbook();
  wb.creator = t('مخابز مكة');
  addTableSheet(wb, table.title, table);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const fmt = (c: Column, v: Row[string]) => {
  if (v === null || v === undefined || v === '') return '';
  if (c.kind === 'money') return filsToJodString(Number(v));
  if (c.kind === 'percent') return `${v}%`;
  if (c.kind === 'int') return Number(v).toLocaleString('en-US');
  return String(v);
};

export function reportHtml(table: ReportTable, brand: BrandHeader, printedAt: string) {
  const num = (c: Column) => c.kind !== 'text';
  const head = table.columns.map((c) => `<th>${e(c.label)}</th>`).join('');
  const body = table.rows
    .map(
      (r) =>
        `<tr>${table.columns.map((c) => `<td class="${num(c) ? 'n' : ''}">${e(fmt(c, r[c.key]))}</td>`).join('')}</tr>`,
    )
    .join('');
  const totals = table.totals
    ? `<tr class="t">${table.columns.map((c, i) => `<td class="${num(c) ? 'n' : ''}">${i === 0 ? e(String(table.totals![c.key] ?? t('المجموع'))) : c.kind === 'percent' ? '' : e(fmt(c, table.totals![c.key]))}</td>`).join('')}</tr>`
    : '';
  const landscape = table.columns.length > 7;
  return `<!doctype html><html lang="${currentLocale()}" dir="${isRtlNow() ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${e(table.title)}</title><style>
${embeddedFontCss()}
@page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:14mm 10mm}
body{font-family:Cairo,sans-serif;color:#3E2A1C;font-size:10.5px;margin:0}
header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #C8862A;padding-bottom:8px;margin-bottom:10px}
header img{height:52px}h1{margin:0;font-size:19px}.m{color:#7A6E62}
table{width:100%;border-collapse:collapse}th{background:#3E2A1C;color:#fff;padding:6px;text-align:start}
td{padding:5px 6px;border-bottom:1px solid #E8DCC8}.n{direction:ltr;text-align:right;white-space:nowrap}
tr:nth-child(even) td{background:#FBF7F0}tr.t td{font-weight:700;border-top:2px solid #3E2A1C;background:#F7EAD0}
footer{margin-top:14px;color:#7A6E62;font-size:9px;display:flex;justify-content:space-between}
</style></head><body>
<header><div><h1>${e(table.title)}</h1><div class="m">${e(table.subtitle)}</div></div>${brand.logoDataUrl ? `<img src="${brand.logoDataUrl}" alt="">` : `<b>${e(brand.name)}</b>`}</header>
<table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${table.columns.length}" class="m">${t('لا توجد بيانات في هذه الفترة')}</td></tr>`}${totals}</tbody></table>
<footer><span>${t('{0} — المبالغ بالدينار الأردني', e(brand.name))}</span><span>${t('طُبع {0}', e(printedAt))}</span></footer>
</body></html>`;
}

/**
 * Everything the bakery owns, one sheet per table, so the data can leave the system at
 * any time. Login tokens, codes and the audit internals are left out.
 */
const EXPORT_TABLES: [string, string][] = [
  ['trade_names', 'الأسماء التجارية'],
  ['customer_categories', 'تصنيفات العملاء'],
  ['customers', 'العملاء'],
  ['branches', 'الفروع'],
  ['contracts', 'العقود'],
  ['contract_prices', 'أسعار العقود'],
  ['item_sections', 'الأقسام'],
  ['items', 'الأصناف'],
  ['orders', 'الطلبات'],
  ['order_items', 'بنود الطلبات'],
  ['production_days', 'أيام الإنتاج'],
  ['production_items', 'بنود الإنتاج'],
  ['production_lines', 'خطوط الإنتاج'],
  ['vehicles', 'السيارات'],
  ['vehicle_loads', 'التحميل'],
  ['variance_approvals', 'اعتماد الفروقات'],
  ['order_events', 'سجل الطلبات'],
  ['stock_losses', 'التالف والمرتجع'],
  ['routes', 'المسارات'],
  ['trips', 'الرحلات'],
  ['deliveries', 'التوصيلات'],
  ['delivery_lines', 'بنود التسليم'],
  ['invoices', 'الفواتير'],
  ['invoice_lines', 'بنود الفواتير'],
  ['payments', 'المقبوضات'],
  ['payment_allocations', 'توزيع المقبوضات'],
  ['suppliers', 'الموردون'],
  ['purchase_orders', 'طلبات الشراء'],
  ['purchase_order_lines', 'بنود طلبات الشراء'],
  ['users', 'المستخدمون'],
  ['audit_logs', 'سجل التدقيق'],
];
const HIDDEN = new Set(['signature_svg', 'google_sub']);

export async function fullExportXlsx(db: Db) {
  const wb = new ExcelJS.Workbook();
  wb.creator = t('مخابز مكة');
  for (const [table, label] of EXPORT_TABLES) {
    const rows = (await db.execute(
      sql.raw(`select * from ${table} order by 1 limit 200000`),
    )) as unknown as Record<string, unknown>[];
    const ws = wb.addWorksheet(label.slice(0, 31), {
      views: [{ rightToLeft: isRtlNow(), state: 'frozen', ySplit: 1 }],
    });
    const cols = rows[0] ? Object.keys(rows[0]).filter((k) => !HIDDEN.has(k)) : [];
    ws.addRow(cols.length ? cols : [t('(فارغ)')]).font = { bold: true };
    for (const r of rows)
      ws.addRow(
        cols.map((k) => {
          const v = r[k];
          if (v === null || v === undefined) return null;
          if (v instanceof Date) return v.toISOString();
          if (typeof v === 'object') return JSON.stringify(v);
          return v as string | number | boolean;
        }),
      );
    cols.forEach((_, i) => (ws.getColumn(i + 1).width = 18));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
