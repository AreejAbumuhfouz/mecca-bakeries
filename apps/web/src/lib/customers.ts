export type Category = { id: string; name: string; nameEn: string | null; isActive: boolean };
export type TradeNameOption = { id: string; name: string; isActive: boolean };

export type CustomerRow = {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  categoryId: string | null;
  categoryName: string | null;
  tradeNameId: string | null;
  tradeName: string | null;
  contactName: string | null;
  phone: string | null;
  city: string | null;
  isActive: boolean;
  branchCount: number;
};

export type Branch = {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
  deliveryNotes: string | null;
  isActive: boolean;
};

export type Customer = {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  categoryId: string | null;
  tradeNameId: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  category: Category | null;
  tradeName: TradeNameOption | null;
  branches: Branch[];
};

export type CustomerForm = {
  code: string;
  name: string;
  nameEn: string;
  categoryId: string;
  tradeNameId: string;
  contactName: string;
  phone: string;
  email: string;
  city: string;
  address: string;
  notes: string;
};

export const emptyCustomerForm: CustomerForm = {
  code: '',
  name: '',
  nameEn: '',
  categoryId: '',
  tradeNameId: '',
  contactName: '',
  phone: '',
  email: '',
  city: '',
  address: '',
  notes: '',
};

export type BranchForm = {
  code: string;
  name: string;
  contactName: string;
  phone: string;
  city: string;
  address: string;
  deliveryNotes: string;
};

export const emptyBranchForm: BranchForm = {
  code: '',
  name: '',
  contactName: '',
  phone: '',
  city: '',
  address: '',
  deliveryNotes: '',
};

/** Form strings → API body: empty code is omitted (auto code), other empties become null. */
export function toBody<T extends Record<string, string>>(form: T) {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(form)) {
    const value = v.trim();
    if (k === 'code' && !value) continue;
    out[k] = value === '' ? null : value;
  }
  return out;
}
