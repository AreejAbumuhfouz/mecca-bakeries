import { describe, expect, it } from 'vitest';
import { effectivePrice, evaluateCredit, type CreditContract } from './credit-engine.js';

const contract = (over: Partial<CreditContract> = {}): CreditContract => ({
  status: 'active',
  startDate: '2026-11-01',
  endDate: '2027-10-31',
  renewalAlertDays: 30,
  paymentType: 'credit',
  creditLimit: 500_000, // 500 JOD
  overdueGraceDays: 0,
  ...over,
});
const today = '2026-12-15';
const codes = (d: ReturnType<typeof evaluateCredit>) => d.reasons.map((r) => r.code);

describe('credit engine', () => {
  it('allows an order within the limit with no overdue debt', () => {
    const d = evaluateCredit({
      today,
      contract: contract(),
      openInvoices: [{ balance: 100_000, dueDate: '2026-12-30' }],
      orderAmount: 50_000,
    });
    expect(d).toMatchObject({ allowed: true, outstanding: 100_000, available: 400_000 });
    expect(d.reasons).toEqual([]);
  });

  it('blocks when outstanding + order exceeds the limit (exactly at the limit is allowed)', () => {
    const open = [{ balance: 450_000, dueDate: '2026-12-30' }];
    expect(
      evaluateCredit({ today, contract: contract(), openInvoices: open, orderAmount: 50_000 })
        .allowed,
    ).toBe(true);
    const d = evaluateCredit({
      today,
      contract: contract(),
      openInvoices: open,
      orderAmount: 50_001,
    });
    expect(codes(d)).toEqual(['CREDIT_LIMIT_EXCEEDED']);
    expect(d.reasons[0]!.message).toContain('50.000');
  });

  it('blocks on overdue invoices, respecting grace days', () => {
    const open = [
      { balance: 20_000, dueDate: '2026-12-10' }, // 5 days late
      { balance: 30_000, dueDate: '2026-12-20' }, // not due yet
    ];
    const strict = evaluateCredit({
      today,
      contract: contract(),
      openInvoices: open,
      orderAmount: 0,
    });
    expect(codes(strict)).toEqual(['OVERDUE_DEBT']);
    expect(strict.overdueAmount).toBe(20_000);

    const lenient = evaluateCredit({
      today,
      contract: contract({ overdueGraceDays: 7 }),
      openInvoices: open,
      orderAmount: 0,
    });
    expect(lenient.allowed).toBe(true);
    // Paid invoices (balance 0) never count as overdue.
    expect(
      evaluateCredit({
        today,
        contract: contract(),
        openInvoices: [{ balance: 0, dueDate: '2026-01-01' }],
        orderAmount: 0,
      }).allowed,
    ).toBe(true);
  });

  it('blocks expired, not-started, suspended and terminated contracts', () => {
    const check = (c: CreditContract) =>
      codes(evaluateCredit({ today, contract: c, openInvoices: [], orderAmount: 0 }));
    expect(check(contract({ endDate: '2026-12-14' }))).toEqual(['CONTRACT_EXPIRED']);
    expect(check(contract({ startDate: '2026-12-16' }))).toEqual(['CONTRACT_NOT_STARTED']);
    expect(check(contract({ status: 'suspended' }))).toEqual(['CONTRACT_SUSPENDED']);
    expect(check(contract({ status: 'terminated' }))).toEqual(['CONTRACT_TERMINATED']);
    // Last day of the contract still counts.
    expect(check(contract({ endDate: today }))).toEqual([]);
  });

  it('reports expiring contracts without blocking them', () => {
    const d = evaluateCredit({
      today,
      contract: contract({ endDate: '2027-01-05' }),
      openInvoices: [],
      orderAmount: 0,
    });
    expect(d).toMatchObject({ allowed: true, contractState: 'expiring' });
  });

  it('ignores the credit limit for cash contracts but still checks overdue debt', () => {
    const cash = contract({ paymentType: 'cash', creditLimit: 0 });
    expect(
      evaluateCredit({ today, contract: cash, openInvoices: [], orderAmount: 9_000_000 }),
    ).toMatchObject({ allowed: true, available: null });
    expect(
      codes(
        evaluateCredit({
          today,
          contract: cash,
          openInvoices: [{ balance: 5_000, dueDate: '2026-12-01' }],
          orderAmount: 0,
        }),
      ),
    ).toEqual(['OVERDUE_DEBT']);
  });

  it('blocks customers without a contract and can report several reasons together', () => {
    expect(
      codes(evaluateCredit({ today, contract: null, openInvoices: [], orderAmount: 0 })),
    ).toEqual(['NO_CONTRACT']);
    const d = evaluateCredit({
      today,
      contract: contract({ endDate: '2026-12-01', creditLimit: 10_000 }),
      openInvoices: [{ balance: 20_000, dueDate: '2026-11-15' }],
      orderAmount: 1,
    });
    expect(codes(d)).toEqual(['CONTRACT_EXPIRED', 'OVERDUE_DEBT', 'CREDIT_LIMIT_EXCEEDED']);
  });
});

describe('effective price', () => {
  it('uses the special price first, then the discount, then the base price', () => {
    expect(effectivePrice(350, 300, 1000)).toEqual({ price: 300, source: 'contract' });
    expect(effectivePrice(350, undefined, 1000)).toEqual({ price: 315, source: 'discount' });
    expect(effectivePrice(350, undefined, 0)).toEqual({ price: 350, source: 'base' });
    expect(effectivePrice(333, undefined, 250)).toEqual({ price: 325, source: 'discount' });
  });
});
