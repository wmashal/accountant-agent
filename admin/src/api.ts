const BASE = '/api/admin'

export interface LoginResponse {
  access_token: string
  token_type: string
}

export interface AccountantOut {
  id: number
  username: string
  display_name: string | null
  company_name: string | null
  logo_url: string | null
  email: string | null
  google_drive_root_folder_id: string | null
  twilio_from_number: string | null
  default_currency: string
  is_active: boolean
  created_at: string
  customer_count: number
  receipt_count: number
}

export interface GlobalStats {
  total_accountants: number
  active_accountants: number
  total_customers: number
  total_receipts: number
  receipts_this_month: number
}

export interface CreateAccountantData {
  username: string
  password: string
  display_name?: string
  company_name?: string
  email?: string
  google_drive_root_folder_id?: string
  twilio_from_number?: string
  gemini_api_key?: string
  default_currency: string
}

export interface UpdateAccountantData {
  username?: string
  display_name?: string
  company_name?: string
  email?: string
  google_drive_root_folder_id?: string
  twilio_from_number?: string
  gemini_api_key?: string
  default_currency?: string
  is_active?: boolean
  new_password?: string
}

export interface MonthlyStats {
  month: string
  receipts: number
  income: number
  expense: number
}

export interface VendorStats {
  vendor: string
  total: number
  count: number
}

export interface AccountantAnalytics {
  monthly: MonthlyStats[]
  top_vendors: VendorStats[]
  total_income: number
  total_expense: number
  confirmed_count: number
  pending_count: number
}

export function getToken(): string | null {
  return localStorage.getItem('admin_token')
}

export function setToken(token: string): void {
  localStorage.setItem('admin_token', token)
}

export function clearToken(): void {
  localStorage.removeItem('admin_token')
}

function authHeaders(): HeadersInit {
  const token = getToken()
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401 || res.status === 403) {
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

export const adminApi = {
  login: (username: string, password: string): Promise<LoginResponse> =>
    fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).then(res => {
      if (!res.ok) throw new Error('Invalid credentials')
      return res.json()
    }),

  getStats: (): Promise<GlobalStats> =>
    fetch(`${BASE}/stats`, { headers: authHeaders() }).then(r => handleResponse<GlobalStats>(r)),

  listAccountants: (): Promise<AccountantOut[]> =>
    fetch(`${BASE}/accountants`, { headers: authHeaders() }).then(r => handleResponse<AccountantOut[]>(r)),

  getAccountant: (id: number): Promise<AccountantOut> =>
    fetch(`${BASE}/accountants/${id}`, { headers: authHeaders() }).then(r => handleResponse<AccountantOut>(r)),

  createAccountant: (data: CreateAccountantData): Promise<AccountantOut> =>
    fetch(`${BASE}/accountants`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(data),
    }).then(r => handleResponse<AccountantOut>(r)),

  updateAccountant: (id: number, data: UpdateAccountantData): Promise<AccountantOut> =>
    fetch(`${BASE}/accountants/${id}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(data),
    }).then(r => handleResponse<AccountantOut>(r)),

  uploadLogo: (id: number, file: File): Promise<{ logo_url: string }> => {
    const token = getToken()
    const fd = new FormData()
    fd.append('logo', file)
    return fetch(`${BASE}/accountants/${id}/logo`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    }).then(r => handleResponse<{ logo_url: string }>(r))
  },

  getAnalytics: (id: number): Promise<AccountantAnalytics> =>
    fetch(`${BASE}/accountants/${id}/analytics`, { headers: authHeaders() }).then(r => handleResponse<AccountantAnalytics>(r)),
}
