import { Router, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import {
  addDays,
  ammanDate,
  INVOICE_LINE_KINDS,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_SOURCES,
} from '@mecca/shared';
import { requireAnyPermission, requirePermission } from '../../middleware/auth.js';
import { AppError, notFound } from '../../lib/errors.js';
import { boolQuery, fils, Id, isoDate, optionalText, pageQuery } from '../../lib/validation.js';
import type { BillingService } from './billing.service.js';
import type { BalanceAlerts } from './balance-alerts.js';
import { t } from '../../lib/i18n.js';

const reason = z.string().trim().min(3, 'اكتب السبب').max(500);

const InvoiceQuery = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  customerId: z.string().uuid().optional(),
  tradeNameId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  search: z.string().trim().max(80).optional(),
  unpaid: boolQuery,
  ...pageQuery,
});
const InvoiceUpdate = z.object({
  discount2Bps: z.number().int().min(0).max(10_000).optional(),
  notes: optionalText(500),
  reason: optionalText(500),
  lines: z
    .array(
      z.object({
        kind: z.enum(INVOICE_LINE_KINDS),
        itemId: z.string().uuid().nullable().optional(),
        description: z.string().trim().min(1).max(160),
        unit: optionalText(30),
        quantity: z.number().int().min(1).max(1_000_000),
        unitPrice: fils,
        listPrice: fils.optional(),
      }),
    )
    .max(300)
    .optional(),
});
const Approve = z.union([
  z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }),
  z.object({ date: isoDate }),
]);
const Opening = z.object({ amount: fils.min(1), date: isoDate, note: optionalText(300) });
const PaymentQuery = z.object({
  customerId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  source: z.enum(PAYMENT_SOURCES).optional(),
  search: z.string().trim().max(80).optional(),
  ...pageQuery,
});
const Payment = z.object({
  customerId: z.string().uuid(),
  amount: fils.min(1),
  method: z.enum(PAYMENT_METHODS),
  receivedOn: isoDate,
  reference: optionalText(80),
  chequeDueDate: isoDate.nullable().optional(),
  note: optionalText(300),
  allocations: z
    .array(z.object({ invoiceId: z.string().uuid(), amount: fils.min(1) }))
    .max(100)
    .optional(),
});
const Period = z.object({ from: isoDate.optional(), to: isoDate.optional() });
const ReceivablesQuery = z.object({
  search: z.string().trim().max(80).optional(),
  onlyOverdue: boolQuery,
  tradeNameId: z.string().uuid().optional(),
});

/** Default statement period: the last 90 days. */
export function period(q: { from?: string; to?: string }) {
  const to = q.to ?? ammanDate();
  return { from: q.from ?? addDays(to, -90), to };
}

export function sendPdf(res: Response, pdf: { bytes: Buffer; filename: string }) {
  res.setHeader('Content-Type', 'application/pdf');
  // Header values must be ASCII; the Arabic name goes in the RFC 5987 form.
  const ascii = pdf.filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(pdf.filename)}`,
  );
  res.send(pdf.bytes);
}

export function billingRouter(
  svc: BillingService,
  alerts: BalanceAlerts,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  router.use(authenticate);
  const viewInvoices = requireAnyPermission('invoices.view', 'payments.view');
  const manageInvoices = requirePermission('invoices.manage');
  const viewPayments = requireAnyPermission('payments.view', 'invoices.view');
  const managePayments = requirePermission('payments.manage');

  // ---- invoices
  router.get('/invoices', viewInvoices, async (req, res) => {
    res.json({ ok: true, data: await svc.list(InvoiceQuery.parse(req.query)) });
  });
  router.post('/invoices/approve', manageInvoices, async (req, res) => {
    const body = Approve.parse(req.body);
    const ids = 'ids' in body ? body.ids : await svc.draftIds(body.date);
    res.json({
      ok: true,
      data: ids.length ? await svc.approve(ids, req.auth!, req.audit) : { approved: 0 },
    });
  });
  router.get('/invoices/:id', viewInvoices, async (req, res) => {
    res.json({ ok: true, data: await svc.get(Id.parse(req.params).id) });
  });
  router.get('/invoices/:id/pdf', viewInvoices, async (req, res) => {
    sendPdf(res, await svc.pdf(Id.parse(req.params).id));
  });
  router.patch('/invoices/:id', manageInvoices, async (req, res) => {
    const { id } = Id.parse(req.params);
    res.json({
      ok: true,
      data: await svc.update(id, InvoiceUpdate.parse(req.body), req.auth!, req.audit),
    });
  });
  router.post('/invoices/:id/cancel', manageInvoices, async (req, res) => {
    const { id } = Id.parse(req.params);
    const body = z.object({ reason }).parse(req.body);
    res.json({ ok: true, data: await svc.cancel(id, body.reason, req.auth!, req.audit) });
  });

  // ---- payments
  router.get('/payments', viewPayments, async (req, res) => {
    res.json({ ok: true, data: await svc.listPayments(PaymentQuery.parse(req.query)) });
  });
  router.get('/payments/:id', viewPayments, async (req, res) => {
    res.json({ ok: true, data: await svc.getPayment(Id.parse(req.params).id) });
  });
  router.post('/payments', managePayments, async (req, res) => {
    const body = Payment.parse(req.body);
    if (body.method === 'cheque' && !body.reference)
      throw new AppError(422, 'CHEQUE_NUMBER', t('اكتب رقم الشيك'));
    res.status(201).json({ ok: true, data: await svc.createPayment(body, req.auth!, req.audit) });
  });
  router.post('/payments/:id/cancel', managePayments, async (req, res) => {
    const { id } = Id.parse(req.params);
    const body = z.object({ reason }).parse(req.body);
    res.json({ ok: true, data: await svc.cancelPayment(id, body.reason, req.audit) });
  });

  // ---- receivables and statements
  router.get('/receivables', viewPayments, async (req, res) => {
    res.json({ ok: true, data: await svc.receivables(ReceivablesQuery.parse(req.query)) });
  });
  router.get('/customers/:id/summary', viewPayments, async (req, res) => {
    res.json({ ok: true, data: await svc.summary(Id.parse(req.params).id) });
  });
  router.get('/customers/:id/statement', viewPayments, async (req, res) => {
    const { from, to } = period(Period.parse(req.query));
    res.json({ ok: true, data: await svc.statement(Id.parse(req.params).id, from, to) });
  });
  router.get('/customers/:id/statement/pdf', viewPayments, async (req, res) => {
    const { from, to } = period(Period.parse(req.query));
    sendPdf(res, await svc.statementPdf(Id.parse(req.params).id, from, to));
  });
  router.post('/customers/:id/opening', manageInvoices, async (req, res) => {
    const { id } = Id.parse(req.params);
    res.status(201).json({
      ok: true,
      data: await svc.createOpening(id, Opening.parse(req.body), req.auth!, req.audit),
    });
  });
  router.patch('/customers/:id/alerts', managePayments, async (req, res) => {
    const { id } = Id.parse(req.params);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    res.json({ ok: true, data: await svc.setBalanceAlerts(id, enabled, req.audit) });
  });
  router.post('/customers/:id/send-statement', managePayments, async (req, res) => {
    res.json({ ok: true, data: await alerts.sendTo(Id.parse(req.params).id, req.auth!.id) });
  });
  return router;
}

/** Restaurant app: own invoices, balance and statement. */
export function accountRouter(svc: BillingService, authenticate: RequestHandler): Router {
  const router = Router();
  router.use(authenticate, requirePermission('own_account.view'));
  const customerOf = (req: { auth?: { customerId: string | null } }) => {
    const id = req.auth?.customerId;
    if (!id) throw new AppError(403, 'NO_CUSTOMER', t('الحساب غير مربوط بعميل'));
    return id;
  };
  async function ownInvoice(req: Parameters<RequestHandler>[0]) {
    const inv = await svc.get(Id.parse(req.params).id);
    if (inv.customerId !== customerOf(req) || inv.status === 'cancelled') throw notFound('Invoice');
    return inv;
  }

  router.get('/balance', async (req, res) => {
    res.json({ ok: true, data: await svc.summary(customerOf(req)) });
  });
  router.get('/invoices', async (req, res) => {
    const q = z.object({ ...pageQuery, unpaid: boolQuery }).parse(req.query);
    const data = await svc.list({ ...q, customerId: customerOf(req) });
    res.json({
      ok: true,
      data: { ...data, items: data.items.filter((i) => i.status !== 'cancelled') },
    });
  });
  router.get('/invoices/:id', async (req, res) => {
    res.json({ ok: true, data: await ownInvoice(req) });
  });
  router.get('/invoices/:id/pdf', async (req, res) => {
    const inv = await ownInvoice(req);
    sendPdf(res, await svc.pdf(inv.id));
  });
  router.get('/statement', async (req, res) => {
    const { from, to } = period(Period.parse(req.query));
    res.json({ ok: true, data: await svc.statement(customerOf(req), from, to) });
  });
  router.get('/statement/pdf', async (req, res) => {
    const { from, to } = period(Period.parse(req.query));
    sendPdf(res, await svc.statementPdf(customerOf(req), from, to));
  });
  return router;
}
