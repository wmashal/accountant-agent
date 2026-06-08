const BASE = '/api/dashboard'

export interface CustomerSummary {
  id: number
  phone_number: string
  display_name: string | null
  company_name: string | null
  company_id: string | null
  total_receipts: number
  total_income: number
  total_expense: number
  created_at: string
}

export interface Receipt {
  id: number
  message_sid: string
  vendor: string | null
  cost: number | null
  tax: number | null
  currency: string
  date: string | null
  abn: string | null
  receipt_language: string | null
  extraction_model: string | null
  transaction_type: 'income' | 'expense'
  status: string
  file_url: string | null
  created_at: string
}

export const api = {
  getCustomers: (): Promise<CustomerSummary[]> =>
    fetch(`${BASE}/customers`).then(r => r.json()),

  getReceipts: (customerId: number): Promise<Receipt[]> =>
    fetch(`${BASE}/customers/${customerId}/receipts`).then(r => r.json()),

  updateReceipt: (id: number, patch: Partial<Receipt>): Promise<Receipt> =>
    fetch(`${BASE}/receipts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(r => r.json()),

  updateCustomerName: (id: number, display_name: string) =>
    fetch(`${BASE}/customers/${id}/name`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name }),
    }).then(r => r.json()),

  updateCustomerProfile: (id: number, patch: { display_name?: string; company_name?: string; company_id?: string }) =>
    fetch(`${BASE}/customers/${id}/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(r => r.json()),
}
