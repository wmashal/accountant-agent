import { useState, useEffect, useCallback, useRef } from "react"
import { api, authApi, getToken, setToken, clearToken, CustomerSummary, Receipt, CreateCustomerData } from "./api"
import "./App.css"
import { LangContext, useLang } from "./i18n/useLang"
import { translations, Lang } from "./i18n/index"

function LoginPage({ onLogin }: { onLogin: (res: { display_name: string | null; company_name: string | null; logo_url: string | null; language?: string | null }) => void }) {
  const { t } = useLang()
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
      setError(t.loginError)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", background: "#f5f5f5" }}>
      <form onSubmit={submit} style={{ background: "#fff", padding: "2rem", borderRadius: "8px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)", minWidth: "320px", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h2 style={{ margin: 0, textAlign: "center" }}>{t.loginTitle}</h2>
        {error && <div style={{ color: "red", fontSize: "0.9rem" }}>{error}</div>}
        <input
          type="text"
          placeholder={t.loginUsername}
          value={username}
          onChange={e => setUsername(e.target.value)}
          required
          style={{ padding: "0.5rem", borderRadius: "4px", border: "1px solid #ccc", fontSize: "1rem" }}
        />
        <input
          type="password"
          placeholder={t.loginPassword}
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          style={{ padding: "0.5rem", borderRadius: "4px", border: "1px solid #ccc", fontSize: "1rem" }}
        />
        <button type="submit" disabled={loading} style={{ padding: "0.6rem", background: "#007bff", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "1rem" }}>
          {loading ? "…" : t.loginButton}
        </button>
      </form>
    </div>
  )
}

// Format a YYYY-MM string to a human-readable month label
function formatMonth(ym: string, lang: Lang) {
  if (ym === "Unknown") return "Unknown Date"
  try {
    const [y, m] = ym.split("-")
    const monthIdx = Number(m) - 1
    const monthName = translations[lang].months[monthIdx]
    return `${monthName} ${y}`
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

  const [lang, setLangState] = useState<Lang>(() => {
    const stored = localStorage.getItem('lang') as Lang | null
    if (stored === 'ar' || stored === 'en') return stored
    try {
      const p = JSON.parse(localStorage.getItem('acct_profile') || 'null')
      if (p?.language === 'ar') return 'ar'
    } catch { /* ignore */ }
    return 'en'
  })

  const setLang = (l: Lang) => {
    setLangState(l)
    localStorage.setItem('lang', l)
    document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.lang = l
  }

  // Apply dir/lang on mount
  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.lang = lang
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogin = (res: { display_name: string | null; company_name: string | null; logo_url: string | null; language?: string | null }) => {
    setTokenState(getToken())
    const p = { displayName: res.display_name, companyName: res.company_name, logoUrl: res.logo_url }
    setProfile(p)
    localStorage.setItem('acct_profile', JSON.stringify(p))
    if (res.language === 'ar' || res.language === 'en') {
      setLang(res.language)
    }
  }

  const handleLogout = () => {
    clearToken()
    localStorage.removeItem('acct_profile')
    setTokenState(null)
  }

  const ctxValue = { lang, setLang, t: translations[lang] }

  return (
    <LangContext.Provider value={ctxValue}>
      {!token
        ? <LoginPage onLogin={handleLogin} />
        : <Dashboard onLogout={handleLogout} profile={profile} />
      }
    </LangContext.Provider>
  )
}

// Column resize hook — only first 9 cols are resizable; last col (Actions) is sticky/fixed
const DEFAULT_COL_WIDTHS = [105, 105, 90, 180, 115, 130, 100, 100, 46]
const ACTIONS_COL_WIDTH = 130

function useColResize(initial: number[]) {
  const [widths, setWidths] = useState(initial)
  const dragging = useRef<{ idx: number; startX: number; startW: number } | null>(null)

  const onMouseDown = useCallback((idx: number, e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = { idx, startX: e.clientX, startW: widths[idx] }

    const onMove = (me: MouseEvent) => {
      if (!dragging.current) return
      const delta = me.clientX - dragging.current.startX
      const newW = Math.max(50, dragging.current.startW + delta)
      setWidths(prev => prev.map((w, i) => i === dragging.current!.idx ? newW : w))
    }
    const onUp = () => {
      dragging.current = null
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }, [widths])

  return { widths, onMouseDown }
}

function Dashboard({ onLogout, profile }: { onLogout: () => void; profile: { displayName: string | null; companyName: string | null; logoUrl: string | null } }) {
  const { t, lang, setLang } = useLang()
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

  // Column resizing
  const { widths: colWidths, onMouseDown: onColResizeMouseDown } = useColResize(DEFAULT_COL_WIDTHS)

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
    if (!confirm(t.deleteConfirm(r.vendor || 'Unknown'))) return
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

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      processing: t.statusProcessing,
      pending_confirmation: t.statusPendingConfirmation,
      confirmed: t.statusConfirmed,
      rejected: t.statusRejected,
      error: t.statusError,
    }
    return map[status] ?? status.replace(/_/g, " ")
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
            <h3>{t.addCustomerTitle}</h3>
            {newCustomerDriveLink ? (
              <div className="drive-success">
                <p>{t.driveFolderCreated}</p>
                <a href={newCustomerDriveLink} target="_blank" rel="noreferrer" className="drive-link">
                  📁 {t.driveFolderOpenLink}
                </a>
                <p className="drive-hint">{t.driveFolderHint}</p>
                <button className="btn-save" onClick={closeAddCustomer}>{t.doneButton}</button>
              </div>
            ) : (
              <form onSubmit={submitAddCustomer} className="add-customer-form">
                <label>{t.addCustomerName}
                  <input
                    required
                    autoFocus
                    value={addForm.display_name}
                    onChange={e => setAddForm(p => ({ ...p, display_name: e.target.value }))}
                    placeholder="e.g. Wael Mashal"
                  />
                </label>
                <label>{t.addCustomerCompany}
                  <input
                    value={addForm.company_name}
                    onChange={e => setAddForm(p => ({ ...p, company_name: e.target.value }))}
                    placeholder="e.g. Mashal Ltd"
                  />
                </label>
                <label>{t.addCustomerCompanyId}
                  <input
                    value={addForm.company_id}
                    onChange={e => setAddForm(p => ({ ...p, company_id: e.target.value }))}
                    placeholder="e.g. 12345"
                  />
                </label>
                <label>{t.addCustomerPhone}
                  <input
                    value={addForm.phone_number}
                    onChange={e => setAddForm(p => ({ ...p, phone_number: e.target.value }))}
                    placeholder={t.addCustomerPhonePlaceholder}
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
                    {addLoading ? t.creatingButton : t.createButton}
                  </button>
                  <button type="button" className="btn-cancel" onClick={closeAddCustomer}>{t.cancelButton}</button>
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
          <p className="subtitle">{t.invoiceDashboard}</p>
          <button onClick={onLogout} style={{ marginTop: "0.5rem", padding: "0.3rem 0.8rem", fontSize: "0.8rem", background: "transparent", border: "1px solid #ccc", borderRadius: "4px", cursor: "pointer", color: "#666" }}>
            {t.logout}
          </button>
        </div>
        <div className="search-wrap">
          <input
            className="search-input"
            type="text"
            placeholder={t.searchPlaceholder}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch("")}>✕</button>
          )}
        </div>
        {loading ? (
          <p className="loading">{t.loading}</p>
        ) : filteredCustomers.length === 0 ? (
          <p className="empty">{search ? "—" : t.noCustomers}</p>
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
                  <span className="count-badge">{t.invoicesCount(c.total_receipts)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="sidebar-footer">
          <button className="add-customer-btn" onClick={() => setShowAddCustomer(true)}>
            {t.addCustomer}
          </button>
          {/* Language switcher */}
          <div className="lang-switcher">
            <button
              className={`lang-btn ${lang === 'en' ? 'active' : ''}`}
              onClick={() => setLang('en')}
            >EN</button>
            <button
              className={`lang-btn ${lang === 'ar' ? 'active' : ''}`}
              onClick={() => setLang('ar')}
            >عربي</button>
          </div>
        </div>
      </aside>

      <main className="main">
        {!selected ? (
          <div className="empty-state">
            <h2>{t.selectCustomer}</h2>
            <p>{t.selectCustomerSub}</p>
          </div>
        ) : (
          <>
            <div className="customer-header">
              <div className="customer-title">
                {editingProfile ? (
                  <div className="profile-edit">
                    <label>{t.profileName}
                      <input
                        value={profileForm.display_name}
                        onChange={e => setProfileForm(p => ({ ...p, display_name: e.target.value }))}
                        placeholder={t.profileName}
                        autoFocus
                      />
                    </label>
                    <label>{t.profileCompany}
                      <input
                        value={profileForm.company_name}
                        onChange={e => setProfileForm(p => ({ ...p, company_name: e.target.value }))}
                        placeholder={t.profileCompany}
                      />
                    </label>
                    <label>{t.profileCompanyId}
                      <input
                        value={profileForm.company_id}
                        onChange={e => setProfileForm(p => ({ ...p, company_id: e.target.value }))}
                        placeholder={t.profileCompanyId}
                      />
                    </label>
                    <label>{t.profilePhone}
                      <input
                        value={profileForm.phone_number}
                        onChange={e => setProfileForm(p => ({ ...p, phone_number: e.target.value }))}
                        placeholder="+61400000000"
                      />
                    </label>
                    <label>Currency
                      <select
                        value={profileForm.default_currency}
                        onChange={e => setProfileForm(p => ({ ...p, default_currency: e.target.value }))}
                      >
                        <option value="USD">USD — US Dollar</option>
                        <option value="ILS">ILS — Israeli Shekel</option>
                      </select>
                    </label>
                    <div className="profile-edit-btns">
                      <button className="btn-save" onClick={saveProfile}>{t.saveButton}</button>
                      <button className="btn-cancel" onClick={() => setEditingProfile(false)}>{t.cancelButton}</button>
                    </div>
                  </div>
                ) : (
                  <div onClick={() => setEditingProfile(true)} className="customer-info-click" title="Click to edit">
                    <h2>
                      {selected.display_name || selected.phone_number}
                      <span className="edit-hint"> {t.editHint}</span>
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
                    <p className="phone-sub">{selected.phone_number.startsWith("drive_") ? "—" : selected.phone_number}</p>
                    {selected.drive_share_link && (
                      <a
                        href={selected.drive_share_link}
                        target="_blank"
                        rel="noreferrer"
                        className="drive-folder-link"
                        onClick={e => e.stopPropagation()}
                      >
                        📁 {t.driveFolderLink}
                      </a>
                    )}
                  </div>
                )}
              </div>
              <div className="summary-cards">
                <div className="card income">
                  <div className="card-label">{t.confirmedIncome}</div>
                  <div className="card-value">{totalIncome.toFixed(2)}</div>
                </div>
                <div className="card expense">
                  <div className="card-label">{t.confirmedExpenses}</div>
                  <div className="card-value">{totalExpense.toFixed(2)}</div>
                </div>
                <div className="card net">
                  <div className="card-label">{t.net}</div>
                  <div className="card-value">{(totalIncome - totalExpense).toFixed(2)}</div>
                </div>
                <button className="btn-refresh" onClick={refreshCustomer} title={t.refreshButton}>↻ {t.refreshButton}</button>
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
                      {tab === "all" ? t.filterAll : tab === "income" ? `↑ ${t.filterIncome}` : `↓ ${t.filterExpense}`}
                      <span className="tab-count">
                        {receipts.filter(r => tab === "all" || r.transaction_type === tab).length}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Dropdown filters */}
                <div className="dropdown-filters">
                  <label className="filter-label">
                    {t.groupBy}
                    <select
                      className="filter-select"
                      value={groupBy}
                      onChange={e => setGroupBy(e.target.value as "invoice" | "upload")}
                    >
                      <option value="upload">{t.groupByUpload}</option>
                      <option value="invoice">{t.groupByInvoice}</option>
                    </select>
                  </label>

                  <label className="filter-label">
                    {t.colDate} (Invoice)
                    <select
                      className="filter-select"
                      value={invoiceMonthFilter}
                      onChange={e => setInvoiceMonthFilter(e.target.value)}
                    >
                      <option value="all">{t.filterAllMonths}</option>
                      {invoiceMonths.map(m => (
                        <option key={m} value={m}>{formatMonth(m, lang)}</option>
                      ))}
                    </select>
                  </label>

                  <label className="filter-label">
                    {t.colUploadDate}
                    <select
                      className="filter-select"
                      value={uploadMonthFilter}
                      onChange={e => setUploadMonthFilter(e.target.value)}
                    >
                      <option value="all">{t.filterAllMonths}</option>
                      {uploadMonths.map(m => (
                        <option key={m} value={m}>{formatMonth(m, lang)}</option>
                      ))}
                    </select>
                  </label>

                  <label className="filter-label">
                    {t.colSupplier}
                    <select
                      className="filter-select"
                      value={supplierFilter}
                      onChange={e => setSupplierFilter(e.target.value)}
                    >
                      <option value="all">{t.filterAll}</option>
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

                if (filtered.length === 0) return <p className="no-data">{t.noReceiptsInPeriod}</p>

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
                          {formatMonth(month, lang)}
                          {groupBy === "upload" ? <span className="month-dim-badge">{t.dimUpload}</span> : <span className="month-dim-badge">{t.dimInvoiceDate}</span>}
                        </span>
                        <span className="month-stats">
                          <span className="month-count">{t.invoicesCount(monthReceipts.length)}</span>
                          {monthIncome > 0 && <span className="income-badge">+{ccy} {monthIncome.toFixed(2)}</span>}
                          {monthExpense > 0 && <span className="expense-badge">-{ccy} {monthExpense.toFixed(2)}</span>}
                        </span>
                      </div>

                      {!collapsed && (
                        <table className="receipts-table" style={{ minWidth: colWidths.reduce((a, b) => a + b, 0) + ACTIONS_COL_WIDTH, width: '100%' }}>
                          <colgroup>
                            {colWidths.map((w, i) => <col key={i} style={{ width: i === 3 ? 'auto' : w }} />)}
                            <col style={{ width: ACTIONS_COL_WIDTH }} />
                          </colgroup>
                          <thead>
                            <tr>
                              {[t.colDate, t.colUploadDate, t.colReceiptNo, t.colSupplier, t.colAmount, t.colTax, t.colType, t.colStatus, t.colFile].map((label, i) => (
                                <th key={i} style={{ width: colWidths[i] }}>
                                  {label}
                                  <span className="col-resize-handle" onMouseDown={e => onColResizeMouseDown(i, e)} />
                                </th>
                              ))}
                              <th className="actions-th">{t.colActions}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {monthReceipts.map(r => (
                              editingReceiptId === r.id ? (
                                <tr key={r.id} className="edit-row">
                                  <td><input className="edit-input" value={editForm.date || ""} onChange={e => setEditForm(p => ({ ...p, date: e.target.value }))} placeholder={t.editDatePlaceholder} /></td>
                                  <td>{r.upload_date ? r.upload_date.slice(0, 10) : "—"}</td>
                                  <td><input className="edit-input" value={editForm.receipt_number || ""} onChange={e => setEditForm(p => ({ ...p, receipt_number: e.target.value }))} placeholder={t.editReceiptNoPlaceholder} /></td>
                                  <td><input className="edit-input" value={editForm.vendor || ""} onChange={e => setEditForm(p => ({ ...p, vendor: e.target.value }))} placeholder={t.editVendorPlaceholder} /></td>
                                  <td>
                                    <input className="edit-input edit-input-sm" type="number" value={editForm.cost ?? ""} onChange={e => setEditForm(p => ({ ...p, cost: parseFloat(e.target.value) || undefined }))} placeholder={t.editAmountPlaceholder} />
                                    <input className="edit-input edit-input-xs" value={editForm.currency || ""} onChange={e => setEditForm(p => ({ ...p, currency: e.target.value }))} placeholder="CCY" maxLength={3} />
                                  </td>
                                  <td>
                                    <select className="edit-select edit-select-xs" value={editForm.tax_rate != null ? String(editForm.tax_rate) : ""} onChange={e => setEditForm(p => ({ ...p, tax_rate: e.target.value ? parseFloat(e.target.value) : undefined }))}>
                                      <option value="">—%</option>
                                      <option value="0.17">17%</option>
                                      <option value="0.18">18%</option>
                                    </select>
                                    <input className="edit-input edit-input-sm" type="number" value={editForm.tax ?? ""} onChange={e => setEditForm(p => ({ ...p, tax: parseFloat(e.target.value) || undefined }))} placeholder={t.editTaxPlaceholder} style={{ marginTop: 3 }} />
                                  </td>
                                  <td>
                                    <select className="edit-select" value={editForm.transaction_type} onChange={e => setEditForm(p => ({ ...p, transaction_type: e.target.value as "income" | "expense" }))}>
                                      <option value="income">{t.typeIncome}</option>
                                      <option value="expense">{t.typeExpense}</option>
                                    </select>
                                  </td>
                                  <td>
                                    <select className="edit-select" value={editForm.status} onChange={e => setEditForm(p => ({ ...p, status: e.target.value }))}>
                                      <option value="pending_confirmation">{t.statusPendingConfirmation}</option>
                                      <option value="confirmed">{t.statusConfirmed}</option>
                                      <option value="rejected">{t.statusRejected}</option>
                                      <option value="error">{t.statusError}</option>
                                    </select>
                                  </td>
                                  <td>
                                    {r.file_url ? (
                                      <button className="btn-icon btn-icon-view" onClick={() => openPreview(r.file_url!)} title={t.viewFileTooltip}>
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                      </button>
                                    ) : r.drive_file_id ? (
                                      <a href={`https://drive.google.com/file/d/${r.drive_file_id}/view`} target="_blank" rel="noreferrer" className="btn-icon btn-icon-view" title={t.viewFileTooltip} style={{ textDecoration: 'none' }}>
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                      </a>
                                    ) : <span style={{ color: '#d1d5db' }}>—</span>}
                                  </td>
                                  <td className="action-cell actions-td">
                                    <button className="btn-save btn-sm" onClick={() => saveEdit(r)}>{t.saveButton}</button>
                                    <button className="btn-cancel btn-sm" onClick={() => setEditingReceiptId(null)}>{t.cancelButton}</button>
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
                                      {r.transaction_type === "income" ? `↑ ${t.typeIncome}` : `↓ ${t.typeExpense}`}
                                    </button>
                                  </td>
                                  <td><span className={`status-badge status-${r.status}`}>{statusLabel(r.status)}</span></td>
                                  <td>
                                    {r.file_url ? (
                                      <button className="btn-icon btn-icon-view" onClick={() => openPreview(r.file_url!)} title={t.viewFileTooltip}>
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                      </button>
                                    ) : r.drive_file_id ? (
                                      <a href={`https://drive.google.com/file/d/${r.drive_file_id}/view`} target="_blank" rel="noreferrer" className="btn-icon btn-icon-view" title={t.viewFileTooltip} style={{ textDecoration: 'none' }}>
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                      </a>
                                    ) : <span style={{ color: '#d1d5db' }}>—</span>}
                                  </td>
                                  <td className="action-cell actions-td">
                                    <button className="btn-icon btn-icon-move" onClick={() => toggleType(r)} title={t.moveTooltip}>
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>
                                    </button>
                                    <button className="btn-icon btn-icon-edit" onClick={() => startEdit(r)} title={t.editTooltip}>
                                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                    </button>
                                    <button className="btn-icon btn-icon-delete" onClick={() => deleteReceipt(r)} title={t.deleteTooltip}>
                                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                                    </button>
                                  </td>
                                </tr>
                              )
                            ))}
                            {/* Monthly totals row */}
                            <tr className="month-total-row">
                              <td colSpan={4}><strong>{t.monthTotal} ({formatMonth(month, lang)})</strong></td>
                              <td className="amount">
                                {monthIncome > 0 && <span className="income-total">+{ccy} {monthIncome.toFixed(2)}</span>}
                                {monthIncome > 0 && monthExpense > 0 && " / "}
                                {monthExpense > 0 && <span className="expense-total">-{ccy} {monthExpense.toFixed(2)}</span>}
                              </td>
                              <td>{monthTax > 0 ? `${ccy} ${monthTax.toFixed(2)}` : "—"}</td>
                              <td colSpan={3}></td>
                              <td className="actions-td"></td>
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
