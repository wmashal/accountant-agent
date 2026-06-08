import { useState, useEffect, useCallback } from "react"
import { api, CustomerSummary, Receipt, CreateCustomerData } from "./api"
import "./App.css"

export default function App() {
  const [customers, setCustomers] = useState<CustomerSummary[]>([])
  const [selected, setSelected] = useState<CustomerSummary | null>(null)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  // Header edit state
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileForm, setProfileForm] = useState({ display_name: "", company_name: "", company_id: "" })

  // Inline receipt edit state
  const [editingReceiptId, setEditingReceiptId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<Partial<Receipt>>({})

  // File preview modal
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewIsPdf, setPreviewIsPdf] = useState(false)

  // Add Customer modal
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [addForm, setAddForm] = useState<CreateCustomerData>({ display_name: "", company_name: "", company_id: "", phone_number: "" })
  const [addLoading, setAddLoading] = useState(false)
  const [newCustomerDriveLink, setNewCustomerDriveLink] = useState<string | null>(null)

  const loadCustomers = useCallback(async () => {
    setLoading(true)
    const data = await api.getCustomers()
    setCustomers(data)
    setLoading(false)
  }, [])

  useEffect(() => { loadCustomers() }, [loadCustomers])

  const selectCustomer = async (c: CustomerSummary) => {
    setSelected(c)
    setEditingProfile(false)
    setEditingReceiptId(null)
    setProfileForm({
      display_name: c.display_name || "",
      company_name: c.company_name || "",
      company_id: c.company_id || "",
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
      currency: r.currency,
      date: r.date || "",
      abn: r.abn || "",
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

  const openPreview = (url: string) => {
    const isPdf = url.toLowerCase().endsWith(".pdf")
    setPreviewIsPdf(isPdf)
    setPreviewUrl(`/files/${url.replace("/files/", "")}`)
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
      }
      const created = await api.createCustomer(payload)
      setNewCustomerDriveLink(created.drive_share_link)
      await loadCustomers()
      setAddForm({ display_name: "", company_name: "", company_id: "", phone_number: "" })
    } finally {
      setAddLoading(false)
    }
  }

  const closeAddCustomer = () => {
    setShowAddCustomer(false)
    setNewCustomerDriveLink(null)
    setAddForm({ display_name: "", company_name: "", company_id: "", phone_number: "" })
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

  const sourceLabel = (source: string) => {
    if (source === "whatsapp") return <span className="source-badge source-whatsapp" title="WhatsApp">📱</span>
    if (source === "drive") return <span className="source-badge source-drive" title="Google Drive">📁</span>
    return <><span className="source-badge source-whatsapp" title="WhatsApp">📱</span><span className="source-badge source-drive" title="Google Drive">📁</span></>
  }

  return (
    <div className="layout">
      {/* File Preview Modal */}
      {previewUrl && (
        <div className="modal-overlay" onClick={() => setPreviewUrl(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setPreviewUrl(null)}>✕</button>
            {previewIsPdf ? (
              <iframe src={previewUrl} title="Receipt PDF" className="modal-iframe" />
            ) : (
              <img src={previewUrl} alt="Receipt" className="modal-img" />
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
                <p className="drive-hint">Ask the customer to upload their receipts to this folder.</p>
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
          <h1>Accountant</h1>
          <p className="subtitle">Receipt Dashboard</p>
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
                {c.company_name && (
                  <div className="customer-company">{c.company_name}{c.company_id ? ` · ${c.company_id}` : ""}</div>
                )}
                <div className="customer-phone">{c.display_name ? c.phone_number : ""}</div>
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
            <p>Choose a customer from the sidebar to view their receipts</p>
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
                    {selected.company_name && (
                      <div className="header-company">
                        {selected.company_name}
                        {selected.company_id && <span className="header-company-id"> · {selected.company_id}</span>}
                      </div>
                    )}
                    <p className="phone-sub">{selected.phone_number}</p>
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
              </div>
            </div>

            <div className="receipts-table-wrap">
              <table className="receipts-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Vendor</th>
                    <th>Amount</th>
                    <th>Tax</th>
                    <th>ABN</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>File</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.length === 0 ? (
                    <tr><td colSpan={9} className="no-data">No receipts</td></tr>
                  ) : receipts.map(r => (
                    editingReceiptId === r.id ? (
                      <tr key={r.id} className="edit-row">
                        <td>
                          <input className="edit-input" value={editForm.date || ""} onChange={e => setEditForm(p => ({ ...p, date: e.target.value }))} placeholder="YYYY-MM-DD" />
                        </td>
                        <td>
                          <input className="edit-input" value={editForm.vendor || ""} onChange={e => setEditForm(p => ({ ...p, vendor: e.target.value }))} placeholder="Vendor" />
                        </td>
                        <td>
                          <input className="edit-input edit-input-sm" type="number" value={editForm.cost ?? ""} onChange={e => setEditForm(p => ({ ...p, cost: parseFloat(e.target.value) || undefined }))} placeholder="Amount" />
                          <input className="edit-input edit-input-xs" value={editForm.currency || ""} onChange={e => setEditForm(p => ({ ...p, currency: e.target.value }))} placeholder="CCY" maxLength={3} />
                        </td>
                        <td>
                          <input className="edit-input edit-input-sm" type="number" value={editForm.tax ?? ""} onChange={e => setEditForm(p => ({ ...p, tax: parseFloat(e.target.value) || undefined }))} placeholder="Tax" />
                        </td>
                        <td>
                          <input className="edit-input" value={editForm.abn || ""} onChange={e => setEditForm(p => ({ ...p, abn: e.target.value }))} placeholder="ABN" />
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
                        <td>{r.vendor || "—"}</td>
                        <td className="amount">
                          {r.cost != null ? `${r.currency} ${r.cost.toFixed(2)}` : "—"}
                        </td>
                        <td>{r.tax != null ? `${r.currency} ${r.tax.toFixed(2)}` : "—"}</td>
                        <td>{r.abn || "—"}</td>
                        <td>
                          <button
                            className={`type-btn ${r.transaction_type}`}
                            onClick={() => toggleType(r)}
                            title="Click to toggle"
                          >
                            {r.transaction_type === "income" ? "↑ Income" : "↓ Expense"}
                          </button>
                        </td>
                        <td>
                          <span className={`status-badge status-${r.status}`}>
                            {r.status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td>
                          {r.file_url ? (
                            <button className="file-link-btn" onClick={() => openPreview(r.file_url!)}>
                              View
                            </button>
                          ) : r.drive_file_id ? (
                            <a href={`https://drive.google.com/file/d/${r.drive_file_id}/view`} target="_blank" rel="noreferrer" className="file-link-btn">Drive</a>
                          ) : "—"}
                        </td>
                        <td className="action-cell">
                          <button className="btn-edit" onClick={() => startEdit(r)}>Edit</button>
                        </td>
                      </tr>
                    )
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
