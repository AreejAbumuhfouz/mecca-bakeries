import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { addDays, ammanDate } from '@mecca/shared';
import type { Db } from '../../db/client.js';
import { requirePermission } from '../../middleware/auth.js';
import { isoDate } from '../../lib/validation.js';
import type { PdfRenderer } from '../../lib/pdf.js';
import { brandHeader } from '../../lib/brand-header.js';
import { writeAudit } from '../audit/audit.service.js';
import type { FilesService } from '../files/files.service.js';
import { sendPdf } from '../billing/billing.routes.js';
import { fullExportXlsx, reportHtml, reportXlsx } from './export.js';
import {
  GROUP_LABELS_AR,
  REPORTS,
  type ReportKey,
  type ReportsService,
} from './reports.service.js';

const Query = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  groupBy: z.string().max(20).optional(),
  format: z.enum(['json', 'xlsx', 'pdf']).default('json'),
});
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function reportsRouter(
  svc: ReportsService,
  deps: { db: Db; files: FilesService; pdf: PdfRenderer },
  authenticate: RequestHandler,
): Router {
  const router = Router();
  router.use(authenticate);

  /** Home page numbers; each section only for those who may see it. */
  router.get('/kpis', async (req, res) => {
    res.json({ ok: true, data: await svc.kpis(req.auth!) });
  });

  router.get('/', requirePermission('reports.view'), (_req, res) => {
    res.json({
      ok: true,
      data: Object.entries(REPORTS).map(([key, r]) => ({
        key,
        title: r.title,
        groups: r.groups.map((g) => ({ key: g, label: GROUP_LABELS_AR[g] })),
      })),
    });
  });

  /** All of the bakery's data as one Excel file (data ownership). */
  router.get('/export/all', requirePermission('settings.manage'), async (req, res) => {
    const bytes = await fullExportXlsx(deps.db);
    await writeAudit(deps.db, req.audit, {
      action: 'data.export',
      entity: 'system',
      entityId: 'all',
    });
    res.setHeader('Content-Type', XLSX);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="mecca-bakeries-data-${ammanDate()}.xlsx"`,
    );
    res.send(bytes);
  });

  router.get('/:key', requirePermission('reports.view'), async (req, res) => {
    const key = z.enum(Object.keys(REPORTS) as [ReportKey, ...ReportKey[]]).parse(req.params.key);
    const q = Query.parse(req.query);
    const to = q.to ?? ammanDate();
    const from = q.from ?? addDays(to, -29);
    const table = await svc.run(key, { from, to, groupBy: q.groupBy });
    const file = `${key}-${from}_${to}`;
    if (q.format === 'xlsx') {
      res.setHeader('Content-Type', XLSX);
      res.setHeader('Content-Disposition', `attachment; filename="${file}.xlsx"`);
      res.send(await reportXlsx(table));
      return;
    }
    if (q.format === 'pdf') {
      const html = reportHtml(table, await brandHeader(deps.db, deps.files), ammanDate());
      sendPdf(res, { bytes: await deps.pdf(html), filename: `${file}.pdf` });
      return;
    }
    res.json({ ok: true, data: table });
  });
  return router;
}
