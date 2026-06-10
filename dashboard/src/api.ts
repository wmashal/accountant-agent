const BASE = '/api/dashboard'

export interface CustomerSummary {
  id: number
  phone_number: string
  display_name: string | null
  company_name: string | null
  company_id: string | null
  drive_folder_id: string | null
  drive_share_link: string | null
  source: string
  default_currency: string
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
  tax_rate: number | null
  currency: string
  date: string | null
  upload_date: string | null
  receipt_number: string | null
  receipt_language: string | null
  extraction_model: string | null
  transaction_type: 'income' | 'expense'
  status: string
  file_url: string | null
  drive_file_id: string | null
  created_at: string
}

export interface CreateCustomerData {
  display_name: string
  company_name?: string
  company_id?: string
  phone_number?: string
  default_currency: string
}

export interface LoginResponse {
  access_token: string
  token_type: string
  accountant_id: number | null
  display_name: string | null
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

export function getToken(): string | null {
  return localStorage.getItem('token')
}

export function setToken(token: string): void {
  localStorage.setItem('token', token)
}

export function clearToken(): void {
  localStorage.removeItem('token')
}

function authHeaders(): HeadersInit {
  const token = getToken()
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    clearToken()
    window.location.reload()
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text || res.statusText)
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const authApi = {
  login: (username: string, password: string): Promise<LoginResponse> =>
    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).then(res => {
      if (!res.ok) throw new Error('Invalid credentials')
      return res.json()
    }),
}

export const api = {
  getCustomers: (): Promise<CustomerSummary[]> =>
    fetch(`${BASE}/customers`, { headers: authHeaders() }).then(r => handleResponse<CustomerSummary[]>(r)),

  createCustomer: (data: CreateCustomerData): Promise<CustomerSummary> =>
    fetch(`${BASE}/customers`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(data),
    }).then(r => handleResponse<CustomerSummary>(r)),

  getReceipts: (customerId: number): Promise<Receipt[]> =>
    fetch(`${BASE}/customers/${customerId}/receipts`, { headers: authHeaders() }).then(r => handleResponse<Receipt[]>(r)),

  updateReceipt: (id: number, patch: Partial<Receipt>): Promise<Receipt> =>
    fetch(`${BASE}/receipts/${id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(patch),
    }).then(r => handleResponse<Receipt>(r)),

  deleteReceipt: (id: number): Promise<void> =>
    fetch(`${BASE}/receipts/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    }).then(r => {
      if (r.status === 401) { clearToken(); window.location.reload() }
    }),

  updateCustomerName: (id: number, display_name: string) =>
    fetch(`${BASE}/customers/${id}/name`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ display_name }),
    }).then(r => handleResponse(r)),

  updateCustomerProfile: (id: number, patch: { display_name?: string; company_name?: string; company_id?: string; phone_number?: string; default_currency?: string }) =>
    fetch(`${BASE}/customers/${id}/profile`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(patch),
    }).then(r => handleResponse(r)),
}
