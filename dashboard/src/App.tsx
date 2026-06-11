import { useState, useEffect, useCallback } from "react"
import { api, authApi, getToken, setToken, clearToken, CustomerSummary, Receipt, CreateCustomerData } from "./api"
import "./App.css"

function LoginPage({ onLogin }: { onLogin: (res: { display_name: string | null; company_name: string | null; logo_url: string | null }) => void }) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await authApi.login(username, password)
      setToken(res.access_token)
      onLogin(res)
    } catch {
      setError("Invalid username or password")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", background: "#f5f5f5" }}>
      <form onSubmit={submit} style={{ background: "#fff", padding: "2rem", borderRadius: "8px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)", minWidth: "320px", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h2 style={{ margin: 0, textAlign: "center" }}>Dashboard Login</h2>
        {error && <div style={{ color: "red", fontSize: "0.9rem" }}>{error}</div>}
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          required
          style={{ padding: "0.5rem", borderRadius: "4px", border: "1px solid #ccc", fontSize: "1rem" }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          style={{ padding: "0.5rem", borderRadius: "4px", border: "1px solid #ccc", fontSize: "1rem" }}
        />
        <button type="submit" disabled={loading} style={{ padding: "0.6rem", background: "#007bff", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "1rem" }}>
          {loading ? "Logging in…" : "Login"}
        </button>
      </form>
    </div>
  )
}

// Format a YYYY-MM string to a human-readable month label
function formatMonth(ym: string) {
  if (ym === "Unknown") return "Unknown Date"
  try {
    const [y, m] = ym.split("-")
    return new Date(Number(y), Number(m) - 1, 1).toLocaleString("default", { month: "long", year: "numeric" })
  } catch {
    return ym
  }
}

export default function App() {
  const [token, setTokenState] = useState<string | null>(() => getToken())
  const [profile, setProfile] = useState<{ displayName: string | null; companyName: string | null; logoUrl: string | null }>(() => {
    try { return JSON.parse(localStorage.getItem('acct_profile') || 'null') || { displayName: null, companyName: null, logoUrl: null } }
    catch { return { displayName: null, companyName: null, logoUrl: null } }
  })

  const handleLogin = (res: { display_name: string | null; company_name: string | null; logo_url: string | null }) => {
    setTokenState(getToken())
    const p = { displayName: res.display_name, companyName: res.company_name, logoUrl: res.logo_url }
    setProfile(p)
    localStorage.setItem('acct_profile', JSON.stringify(p))
  }

  const handleLogout = () => {
    clearToken()
    localStorage.removeItem('acct_profile')
    setTokenState(null)
  }

  if (!token) return <LoginPage onLogin={handleLogin} />
  return <Dashboard onLogout={handleLogout} profile={profile} />
}

function Dashboard({ onLogout, profile }: { onLogout: () => void; profile: { displayName: string | null; companyName: string | null; logoUrl: string | null } }) {
  const [customers, setCustomers] = useState<CustomerSummary[]>([])
  const [selected, setSelected] = useState<CustomerSummary | null>(null)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  // Header edit state
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileForm, setProfileForm] = useState({ display_name: "", company_name: "", company_id: "", phone_number: "", default_currency: "USD" })

  // Inline invoice edit state
  const [editingReceiptId, setEditingReceiptId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Partial<Receipt>>({})

  // Filter state
  const [typeFilter, setTypeFilter] = useState<"all" | "income" | "expense">("all")
  const [groupBy, setGroupBy] = useState<"invoice" | "upload">("upload")
  const [invoiceMonthFilter, setInvoiceMonthFilter] = useState<string>("all")
  const [uploadMonthFilter, setUploadMonthFilter] = useState<string>("all")
  const [supplierFilter, setSupplierFilter] = useState<string>("all")

  // Collapsed month groups
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set())

  // File preview modal
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewIsPdf, setPreviewIsPdf] = useState(false)

  // Add Customer modal
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [addForm, setAddForm] = useState<CreateCustomerData>({ display_name: "", company_name: "", company_id: "", phone_number: "", default_currency: "USD" })
  const [addLoading, setAddLoading] = useState(false)
  const [newCustomerDriveLink, setNewCustomerDriveLink] = useState<string | null>(null)

  const loadCustomers = useCallback(async () => {
    setLoading(true)
    const data = await api.getCustomers()
    setCustomers(data)
    setLoading(false)
  }, [])

  useEffect(() => { loadCustomers() }, [loadCustomers])

  const refreshCustomer = async () => {
    if (!selected) return
    const [updatedCustomers, updatedReceipts] = await Promise.all([
      api.getCustomers(),
      api.getReceipts(selected.id),
    ])
    setCustomers(updatedCustomers)
    setReceipts(updatedReceipts)
    const updated = updatedCustomers.find(c => c.id === selected.id)
    if (updated) setSelected(updated)
  }

  const selectCustomer = async (c: CustomerSummary) => {
    setSelected(c)
    setEditingProfile(false)
    setEditingReceiptId(null)
    setInvoiceMonthFilter("all")
    setUploadMonthFilter("all")
    setSupplierFilter("all")
    setProfileForm({
      display_name: c.display_name || "",
      company_name: c.company_name || "",
      company_id: c.company_id || "",
      phone_number: c.phone_number.startsWith("drive_") ? "" : c.phone_number,
      default_currency: c.default_currency || "USD",
    })
    const data = await api.getReceipts(c.id)
    setReceipts(data)
  }

  const saveProfile = async () => {
    if (!selected) return
    await api.updateCustomerProfile(selected.id, profileForm)
    setEditingProfile(false)
    await loadCustomers()
    setSelected(prev => prev ? {
      ...prev,
      display_name: profileForm.display_name || null,
      company_name: profileForm.company_name || null,
      company_id: profileForm.company_id || null,
      phone_number: profileForm.phone_number || prev.phone_number,
    } : prev)
  }

  const toggleType = async (r: Receipt) => {
    const next = r.transaction_type === "income" ? "expense" : "income"
    await api.updateReceipt(r.id, { transaction_type: next })
    setReceipts(prev => prev.map(x => x.id === r.id ? { ...x, transaction_type: next as "income" | "expense" } : x))
    await loadCustomers()
  }

  const startEdit = (r: Receipt) => {
    setEditingReceiptId(r.id)
    setEditForm({
      vendor: r.vendor || "",
      cost: r.cost ?? undefined,
      tax: r.tax ?? undefined,
      tax_rate: r.tax_rate ?? undefined,
      currency: r.currency,
      date: r.date || "",
      receipt_number: r.receipt_number || "",
      transaction_type: r.transaction_type,
      status: r.status,
    })
  }

  const saveEdit = async (r: Receipt) => {
    const updated = await api.updateReceipt(r.id, editForm)
    setReceipts(prev => prev.map(x => x.id === r.id ? { ...x, ...updated } : x))
    setEditingReceiptId(null)
    await loadCustomers()
  }

  const deleteReceipt = async (r: Receipt) => {
    if (!confirm(`Delete invoice from "${r.vendor || 'Unknown'}"? This will also remove the file from storage.`)) return
    await api.deleteReceipt(r.id)
    setReceipts(prev => prev.filter(x => x.id !== r.id))
    await loadCustomers()
  }

  const openPreview = (url: string) => {
    const isPdf = url.toLowerCase().endsWith(".pdf")
    setPreviewIsPdf(isPdf)
    setPreviewUrl(url.startsWith("http") ? url : `/files/${url.replace("/files/", "")}`)
  }

  const submitAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddLoading(true)
    try {
      const payload: CreateCustomerData = {
        display_name: addForm.display_name,
        company_name: addForm.company_name || undefined,
        company_id: addForm.company_id || undefined,
        phone_number: addForm.phone_number || undefined,
        default_currency: addForm.default_currency,
      }
      const created = await api.createCustomer(payload)
      setNewCustomerDriveLink(created.drive_share_link)
      await loadCustomers()
      setAddForm({ display_name: "", company_name: "", company_id: "", phone_number: "", default_currency: "USD" })
    } finally {
      setAddLoading(false)
    }
  }

  const closeAddCustomer = () => {
    setShowAddCustomer(false)
    setNewCustomerDriveLink(null)
    setAddForm({ display_name: "", company_name: "", company_id: "", phone_number: "", default_currency: "USD" })
  }

  const filteredCustomers = customers.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (c.display_name || "").toLowerCase().includes(q) ||
      c.phone_number.toLowerCase().includes(q) ||
      (c.company_name || "").toLowerCase().includes(q) ||
      (c.company_id || "").toLowerCase().includes(q)
    )
  })

  const totalIncome = receipts.filter(r => r.transaction_type === "income" && r.status === "confirmed").reduce((s, r) => s + (r.cost || 0), 0)
  const totalExpense = receipts.filter(r => r.transaction_type === "expense" && r.status === "confirmed").reduce((s, r) => s + (r.cost || 0), 0)

  // Derive unique filter options from current receipts
  const invoiceMonths = Array.from(new Set(receipts.map(r => r.date && r.date.length >= 7 ? r.date.slice(0, 7) : "Unknown"))).sort((a, b) => b.localeCompare(a))
  const uploadMonths = Array.from(new Set(receipts.map(r => r.upload_date && r.upload_date.length >= 7 ? r.upload_date.slice(0, 7) : "Unknown"))).sort((a, b) => b.localeCompare(a))
  const suppliers = Array.from(new Set(receipts.map(r => r.vendor || "Unknown"))).sort()

  const sourceLabel = (source: string) => {
    if (source === "whatsapp") return <span className="source-badge source-whatsapp" title="WhatsApp">📱</span>
    if (source === "drive") return <span className="source-badge source-drive" title="Google Drive">📁</span>
    return <><span className="source-badge source-whatsapp" title="WhatsApp">📱</span><span className="source-badge source-drive" title="Google Drive">📁</span></>
  }

  const formatTaxRate = (rate: number | null) => {
    if (rate == null) return "—"
    return `${(rate * 100).toFixed(0)}%`
  }

  return (
    <div className="layout">
      {/* File Preview Modal */}
      {previewUrl && (
        <div className="modal-overlay" onClick={() => setPreviewUrl(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setPreviewUrl(null)}>✕</button>
            {previewIsPdf ? (
              <iframe src={previewUrl} title="Invoice PDF" className="modal-iframe" />
            ) : (
              <img src={previewUrl} alt="Invoice" className="modal-img" />
            )}
          </div>
        </div>
      )}

      {/* Add Customer Modal */}
      {showAddCustomer && (
        <div className="modal-overlay" onClick={closeAddCustomer}>
          <div className="add-customer-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={closeAddCustomer}>✕</button>
            <h3>Add Customer</h3>
            {newCustomerDriveLink ? (
              <div className="drive-success">
                <p>Customer created! Share their Google Drive folder:</p>
                <a href={newCustomerDriveLink} target="_blank" rel="noreferrer" className="drive-link">
                  📁 Open Drive Folder
                </a>
                <p className="drive-hint">Ask the customer to upload their invoices to this folder.</p>
                <button className="btn-save" onClick={closeAddCustomer}>Done</button>
              </div>
            ) : (
              <form onSubmit={submitAddCustomer} className="add-customer-form">
                <label>Full Name *
                  <input
                    required
                    autoFocus
                    value={addForm.display_name}
                    onChange={e => setAddForm(p => ({ ...p, display_name: e.target.value }))}
                    placeholder="e.g. Wael Mashal"
                  />
                </label>
                <label>Company Name
                  <input
                    value={addForm.company_name}
                    onChange={e => setAddForm(p => ({ ...p, company_name: e.target.value }))}
                    placeholder="e.g. Mashal Ltd"
                  />
                </label>
                <label>Company ID / Registration No.
                  <input
                    value={addForm.company_id}
                    onChange={e => setAddForm(p => ({ ...p, company_id: e.target.value }))}
                    placeholder="e.g. 12345"
                  />
                </label>
                <label>WhatsApp Number (optional)
                  <input
                    value={addForm.phone_number}
                    onChange={e => setAddForm(p => ({ ...p, phone_number: e.target.value }))}
                    placeholder="+61400000000"
                  />
                </label>
                <label>Default Currency
                  <select
                    value={addForm.default_currency}
                    onChange={e => setAddForm(p => ({ ...p, default_currency: e.target.value }))}
                  >
                    <option value="USD">USD — US Dollar</option>
                    <option value="ILS">ILS — Israeli Shekel</option>
                  </select>
                </label>
                <div className="add-customer-btns">
                  <button type="submit" className="btn-save" disabled={addLoading}>
                    {addLoading ? "Creating…" : "Create Customer"}
                  </button>
                  <button type="button" className="btn-cancel" onClick={closeAddCustomer}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <aside className="sidebar">
        <div className="sidebar-header">
          {profile.logoUrl && (
            <img src={profile.logoUrl} alt="logo" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', marginBottom: '0.5rem' }} />
          )}
          <h1>{profile.companyName || profile.displayName || 'Accountant'}</h1>
          <p className="subtitle">Invoice Dashboard</p>
          <button onClick={onLogout} style={{ marginTop: "0.5rem", padding: "0.3rem 0.8rem", fontSize: "0.8rem", background: "transparent", border: "1px solid #ccc", borderRadius: "4px", cursor: "pointer", color: "#666" }}>
            Logout
          </button>
        </div>
        <div className="search-wrap">
          <input
            className="search-input"
            type="text"
            placeholder="Search name, phone, company..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch("")}>✕</button>
          )}
        </div>
        {loading ? (
          <p className="loading">Loading...</p>
        ) : filteredCustomers.length === 0 ? (
          <p className="empty">{search ? "No results" : "No customers yet"}</p>
        ) : (
          <ul className="customer-list">
            {filteredCustomers.map(c => (
              <li
                key={c.id}
                className={`customer-item ${selected && selected.id === c.id ? "active" : ""}`}
                onClick={() => selectCustomer(c)}
              >
                <div className="customer-item-top">
                  <div className="customer-name">
                    {c.display_name || c.phone_number}
                  </div>
                  <div className="customer-source">{sourceLabel(c.source)}</div>
                </div>
                {(c.company_name || c.company_id) && (
                  <div className="customer-company">
                    {c.company_name || ""}
                    {c.company_name && c.company_id ? ` · ${c.company_id}` : c.company_id || ""}
                  </div>
                )}
                <div className="customer-phone">{c.display_name && !c.phone_number.startsWith("drive_") ? c.phone_number : ""}</div>
                <div className="customer-stats">
                  <span className="income-badge">+{c.total_income.toFixed(0)}</span>
                  <span className="expense-badge">-{c.total_expense.toFixed(0)}</span>
                  <span className="count-badge">{c.total_receipts}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="sidebar-footer">
          <button className="add-customer-btn" onClick={() => setShowAddCustomer(true)}>
            + Add Customer
          </button>
        </div>
      </aside>

      <main className="main">
        {!selected ? (
          <div className="empty-state">
            <h2>Select a customer</h2>
            <p>Choose a customer from the sidebar to view their invoices</p>
          </div>
        ) : (
          <>
            <div className="customer-header">
              <div className="customer-title">
                {editingProfile ? (
                  <div className="profile-edit">
                    <label>Name
                      <input
                        value={profileForm.display_name}
                        onChange={e => setProfileForm(p => ({ ...p, display_name: e.target.value }))}
                        placeholder="Full name"
                        autoFocus
                      />
                    </label>
                    <label>Company
                      <input
                        value={profileForm.company_name}
                        onChange={e => setProfileForm(p => ({ ...p, company_name: e.target.value }))}
                        placeholder="Company name"
                      />
                    </label>
                    <label>ID / Reg No.
                      <input
                        value={profileForm.company_id}
                        onChange={e => setProfileForm(p => ({ ...p, company_id: e.target.value }))}
                        placeholder="Company ID or registration number"
                      />
                    </label>
                    <label>WhatsApp Number
                      <input
                        value={profileForm.phone_number}
                        onChange={e => setProfileForm(p => ({ ...p, phone_number: e.target.value }))}
                        placeholder="+61400000000"
                      />
                    </label>
                    <label>Default Currency
                      <select
                        value={profileForm.default_currency}
                        onChange={e => setProfileForm(p => ({ ...p, default_currency: e.target.value }))}
                      >
                        <option value="USD">USD — US Dollar</option>
                        <option value="ILS">ILS — Israeli Shekel</option>
                      </select>
                    </label>
                    <div className="profile-edit-btns">
                      <button className="btn-save" onClick={saveProfile}>Save</button>
                      <button className="btn-cancel" onClick={() => setEditingProfile(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div onClick={() => setEditingProfile(true)} className="customer-info-click" title="Click to edit">
                    <h2>
                      {selected.display_name || selected.phone_number}
                      <span className="edit-hint"> ✎</span>
                      <span className="header-source">{sourceLabel(selected.source)}</span>
                    </h2>
                    {(selected.company_name || selected.company_id) && (
                      <div className="header-company">
                        {selected.company_name || ""}
                        {selected.company_name && selected.company_id
                          ? <span className="header-company-id"> · {selected.company_id}</span>
                          : selected.company_id
                            ? <span className="header-company-id">{selected.company_id}</span>
                            : null}
                      </div>
                    )}
                    <p className="phone-sub">{selected.phone_number.startsWith("drive_") ? "No phone" : selected.phone_number}</p>
                    {selected.drive_share_link && (
                      <a
                        href={selected.drive_share_link}
                        target="_blank"
                        rel="noreferrer"
                        className="drive-folder-link"
                        onClick={e => e.stopPropagation()}
                      >
                        📁 Drive Folder
                      </a>
                    )}
                  </div>
                )}
              </div>
              <div className="summary-cards">
                <div className="card income">
                  <div className="card-label">Confirmed Income</div>
                  <div className="card-value">{totalIncome.toFixed(2)}</div>
                </div>
                <div className="card expense">
                  <div className="card-label">Confirmed Expenses</div>
                  <div className="card-value">{totalExpense.toFixed(2)}</div>
                </div>
                <div className="card net">
                  <div className="card-label">Net</div>
                  <div className="card-value">{(totalIncome - totalExpense).toFixed(2)}</div>
                </div>
                <button className="btn-refresh" onClick={refreshCustomer} title="Refresh invoices">↻ Refresh</button>
              </div>
            </div>

            <div className="receipts-table-wrap">
              {/* Filter bar */}
              <div className="filter-bar">
                {/* Type tabs */}
                <div className="type-filter-tabs">
                  {(["all", "income", "expense"] as const).map(tab => (
                    <button
                      key={tab}
                      className={`type-filter-tab ${typeFilter === tab ? "active" : ""} ${tab !== "all" ? tab : ""}`}
                      onClick={() => setTypeFilter(tab)}
                    >
                      {tab === "all" ? "All" : tab === "income" ? "↑ Income" : "↓ Expense"}
                      <span className="tab-count">
                        {receipts.filter(r => tab === "all" || r.transaction_type === tab).length}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Dropdown filters */}
                <div className="dropdown-filters">
                  <label className="filter-label">
                    Group by
                    <select
                      className="filter-select"
                      value={groupBy}
                      onChange={e => setGroupBy(e.target.value as "invoice" | "upload")}
                    >
                      <option value="upload">Upload Month</option>
                      <option value="invoice">Invoice Month</option>
                    </select>
                  </label>

                  <label className="filter-label">
                    Invoice Month
                    <select
                      className="filter-select"
                      value={invoiceMonthFilter}
                      onChange={e => setInvoiceMonthFilter(e.target.value)}
                    >
                      <option value="all">All</option>
                      {invoiceMonths.map(m => (
                        <option key={m} value={m}>{formatMonth(m)}</option>
                      ))}
                    </select>
                  </label>

                  <label className="filter-label">
                    Upload Month
                    <select
                      className="filter-select"
                      value={uploadMonthFilter}
                      onChange={e => setUploadMonthFilter(e.target.value)}
                    >
                      <option value="all">All</option>
                      {uploadMonths.map(m => (
                        <option key={m} value={m}>{formatMonth(m)}</option>
                      ))}
                    </select>
                  </label>

                  <label className="filter-label">
                    Supplier
                    <select
                      className="filter-select"
                      value={supplierFilter}
                      onChange={e => setSupplierFilter(e.target.value)}
                    >
                      <option value="all">All</option>
                      {suppliers.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {/* Invoices grouped by selected month dimension */}
              {(() => {
                // Apply all filters
                let filtered = receipts.filter(r => typeFilter === "all" || r.transaction_type === typeFilter)

                if (invoiceMonthFilter !== "all") {
                  filtered = filtered.filter(r => {
                    const m = r.date && r.date.length >= 7 ? r.date.slice(0, 7) : "Unknown"
                    return m === invoiceMonthFilter
                  })
                }

                if (uploadMonthFilter !== "all") {
                  filtered = filtered.filter(r => {
                    const m = r.upload_date && r.upload_date.length >= 7 ? r.upload_date.slice(0, 7) : "Unknown"
                    return m === uploadMonthFilter
                  })
                }

                if (supplierFilter !== "all") {
                  filtered = filtered.filter(r => (r.vendor || "Unknown") === supplierFilter)
                }

                if (filtered.length === 0) return <p className="no-data">No invoices</p>

                // Group by chosen dimension
                const groups: Record<string, typeof filtered> = {}
                filtered.forEach(r => {
                  let key: string
                  if (groupBy === "upload") {
                    key = r.upload_date && r.upload_date.length >= 7 ? r.upload_date.slice(0, 7) : "Unknown"
                  } else {
                    key = r.date && r.date.length >= 7 ? r.date.slice(0, 7) : "Unknown"
                  }
                  if (!groups[key]) groups[key] = []
                  groups[key].push(r)
                })
                const sortedMonths = Object.keys(groups).sort((a, b) => b.localeCompare(a))

                return sortedMonths.map(month => {
                  const collapsed = collapsedMonths.has(month)
                  const monthReceipts = groups[month]
                  const monthIncome = monthReceipts.filter(r => r.transaction_type === "income" && r.status === "confirmed").reduce((s, r) => s + (r.cost || 0), 0)
                  const monthExpense = monthReceipts.filter(r => r.transaction_type === "expense" && r.status === "confirmed").reduce((s, r) => s + (r.cost || 0), 0)
                  const monthTax = monthReceipts.filter(r => r.status === "confirmed" && r.tax != null).reduce((s, r) => s + (r.tax || 0), 0)
                  const ccy = monthReceipts[0]?.currency || ""

                  return (
                    <div key={month} className="month-group">
                      <div
                        className="month-group-header"
                        onClick={() => setCollapsedMonths(prev => {
                          const next = new Set(prev)
                          collapsed ? next.delete(month) : next.add(month)
                          return next
                        })}
                      >
                        <span className="month-toggle">{collapsed ? "▶" : "▼"}</span>
                        <span className="month-label">
                          {formatMonth(month)}
                          {groupBy === "upload" ? <span className="month-dim-badge"> upload</span> : <span className="month-dim-badge"> invoice date</span>}
                        </span>
                        <span className="month-stats">
                          <span className="month-count">{monthReceipts.length} invoices</span>
                          {monthIncome > 0 && <span className="income-badge">+{ccy} {monthIncome.toFixed(2)}</span>}
                          {monthExpense > 0 && <span className="expense-badge">-{ccy} {monthExpense.toFixed(2)}</span>}
                        </span>
                      </div>

                      {!collapsed && (
                        <table className="receipts-table">
                          <thead>
                            <tr>
                              <th>Invoice Date</th>
                              <th>Upload Date</th>
                              <th>Invoice #</th>
                              <th>Supplier</th>
                              <th>Amount</th>
                              <th>Tax</th>
                              <th>Type</th>
                              <th>Status</th>
                              <th>File</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {monthReceipts.map(r => (
                              editingReceiptId === r.id ? (
                                <tr key={r.id} className="edit-row">
                                  <td><input className="edit-input" value={editForm.date || ""} onChange={e => setEditForm(p => ({ ...p, date: e.target.value }))} placeholder="YYYY-MM-DD" /></td>
                                  <td>{r.upload_date ? r.upload_date.slice(0, 10) : "—"}</td>
                                  <td><input className="edit-input" value={editForm.receipt_number || ""} onChange={e => setEditForm(p => ({ ...p, receipt_number: e.target.value }))} placeholder="Invoice #" /></td>
                                  <td><input className="edit-input" value={editForm.vendor || ""} onChange={e => setEditForm(p => ({ ...p, vendor: e.target.value }))} placeholder="Supplier" /></td>
                                  <td>
                                    <input className="edit-input edit-input-sm" type="number" value={editForm.cost ?? ""} onChange={e => setEditForm(p => ({ ...p, cost: parseFloat(e.target.value) || undefined }))} placeholder="Amount" />
                                    <input className="edit-input edit-input-xs" value={editForm.currency || ""} onChange={e => setEditForm(p => ({ ...p, currency: e.target.value }))} placeholder="CCY" maxLength={3} />
                                  </td>
                                  <td>
                                    <select className="edit-select edit-select-xs" value={editForm.tax_rate != null ? String(editForm.tax_rate) : ""} onChange={e => setEditForm(p => ({ ...p, tax_rate: e.target.value ? parseFloat(e.target.value) : undefined }))}>
                                      <option value="">—%</option>
                                      <option value="0.17">17%</option>
                                      <option value="0.18">18%</option>
                                    </select>
                                    <input className="edit-input edit-input-sm" type="number" value={editForm.tax ?? ""} onChange={e => setEditForm(p => ({ ...p, tax: parseFloat(e.target.value) || undefined }))} placeholder="Tax amt" style={{ marginTop: 3 }} />
                                  </td>
                                  <td>
                                    <select className="edit-select" value={editForm.transaction_type} onChange={e => setEditForm(p => ({ ...p, transaction_type: e.target.value as "income" | "expense" }))}>
                                      <option value="income">Income</option>
                                      <option value="expense">Expense</option>
                                    </select>
                                  </td>
                                  <td>
                                    <select className="edit-select" value={editForm.status} onChange={e => setEditForm(p => ({ ...p, status: e.target.value }))}>
                                      <option value="pending_confirmation">Pending</option>
                                      <option value="confirmed">Confirmed</option>
                                      <option value="rejected">Rejected</option>
                                      <option value="error">Error</option>
                                    </select>
                                  </td>
                                  <td>
                                    {r.file_url ? (
                                      <button className="file-link-btn" onClick={() => openPreview(r.file_url!)}>View</button>
                                    ) : r.drive_file_id ? (
                                      <a href={`https://drive.google.com/file/d/${r.drive_file_id}/view`} target="_blank" rel="noreferrer" className="file-link-btn">Drive</a>
                                    ) : "—"}
                                  </td>
                                  <td className="action-cell">
                                    <button className="btn-save btn-sm" onClick={() => saveEdit(r)}>Save</button>
                                    <button className="btn-cancel btn-sm" onClick={() => setEditingReceiptId(null)}>Cancel</button>
                                  </td>
                                </tr>
                              ) : (
                                <tr key={r.id}>
                                  <td>{r.date || "—"}</td>
                                  <td>{r.upload_date ? r.upload_date.slice(0, 10) : "—"}</td>
                                  <td>{r.receipt_number || "—"}</td>
                                  <td>{r.vendor || "—"}</td>
                                  <td className="amount">{r.cost != null ? `${r.currency} ${r.cost.toFixed(2)}` : "—"}</td>
                                  <td className="tax-cell">
                                    {r.tax != null ? (
                                      <span>
                                        {r.tax_rate != null && <span className="tax-rate-chip">{formatTaxRate(r.tax_rate)}</span>}
                                        {r.currency} {r.tax.toFixed(2)}
                                      </span>
                                    ) : r.tax_rate != null ? (
                                      <span className="tax-rate-chip">{formatTaxRate(r.tax_rate)}</span>
                                    ) : "—"}
                                  </td>
                                  <td>
                                    <button className={`type-btn ${r.transaction_type}`} onClick={() => toggleType(r)} title="Click to toggle">
                                      {r.transaction_type === "income" ? "↑ Income" : "↓ Expense"}
                                    </button>
                                  </td>
                                  <td><span className={`status-badge status-${r.status}`}>{r.status.replace(/_/g, " ")}</span></td>
                                  <td>
                                    {r.file_url ? (
                                      <button className="file-link-btn" onClick={() => openPreview(r.file_url!)}>View</button>
                                    ) : r.drive_file_id ? (
                                      <a href={`https://drive.google.com/file/d/${r.drive_file_id}/view`} target="_blank" rel="noreferrer" className="file-link-btn">Drive</a>
                                    ) : "—"}
                                  </td>
                                  <td className="action-cell">
                                    <button className="btn-icon btn-icon-move" onClick={() => toggleType(r)} title={`Move to ${r.transaction_type === 'income' ? 'Expense' : 'Income'}`}>⇄</button>
                                    <button className="btn-icon btn-icon-edit" onClick={() => startEdit(r)} title="Edit">✎</button>
                                    <button className="btn-icon btn-icon-delete" onClick={() => deleteReceipt(r)} title="Delete">✕</button>
                                  </td>
                                </tr>
                              )
                            ))}
                            {/* Monthly totals row */}
                            <tr className="month-total-row">
                              <td colSpan={4}><strong>Total ({formatMonth(month)})</strong></td>
                              <td className="amount">
                                {monthIncome > 0 && <span className="income-total">+{ccy} {monthIncome.toFixed(2)}</span>}
                                {monthIncome > 0 && monthExpense > 0 && " / "}
                                {monthExpense > 0 && <span className="expense-total">-{ccy} {monthExpense.toFixed(2)}</span>}
                              </td>
                              <td>{monthTax > 0 ? `${ccy} ${monthTax.toFixed(2)}` : "—"}</td>
                              <td colSpan={4}></td>
                            </tr>
                          </tbody>
                        </table>
                      )}
                    </div>
                  )
                })
              })()}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
