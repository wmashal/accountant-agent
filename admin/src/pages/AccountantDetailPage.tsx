import { useEffect, useRef, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'
import { adminApi, AccountantOut, AccountantAnalytics } from '../api'

interface Props {
  accountantId: number
  onBack: () => void
}

function StatCard({ label, value, sub, color = '#4f46e5' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 12, padding: '20px 24px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.08)', borderLeft: `4px solid ${color}`,
      minWidth: 140, flex: 1,
    }}>
      <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 500, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#111827' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ margin: '28px 0 14px', fontSize: 15, fontWeight: 600, color: '#374151', letterSpacing: 0.3 }}>
      {children}
    </h3>
  )
}

export default function AccountantDetailPage({ accountantId, onBack }: Props) {
  const [acct, setAcct] = useState<AccountantOut | null>(null)
  const [analytics, setAnalytics] = useState<AccountantAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [form, setForm] = useState<Record<string, string | boolean>>({})
  const fileRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    adminApi.getAccountant(accountantId)
      .then(a => {
        setAcct(a)
        setForm({
          username: a.username ?? '',
          display_name: a.display_name ?? '',
          company_name: a.company_name ?? '',
          email: a.email ?? '',
          google_drive_root_folder_id: a.google_drive_root_folder_id ?? '',
          twilio_from_number: a.twilio_from_number ?? '',
          gemini_api_key: '',
          default_currency: a.default_currency,
          is_active: a.is_active,
          new_password: '',
        })
        setLoading(false)
        adminApi.getAnalytics(accountantId)
          .then(setAnalytics)
          .catch(console.error)
      })
      .catch(e => {
        console.error(e)
        setLoading(false)
      })
  }, [accountantId])

  async function handleSave() {
    if (!acct) return
    setSaving(true)
    try {
      const patch: Record<string, unknown> = {}
      const fields = ['username', 'display_name', 'company_name', 'email', 'google_drive_root_folder_id', 'twilio_from_number', 'default_currency']
      for (const f of fields) {
        const v = form[f]
        if (typeof v === 'string' && v !== (acct as unknown as Record<string, unknown>)[f]) patch[f] = v || undefined
      }
      if (form.is_active !== acct.is_active) patch.is_active = form.is_active
      if (form.new_password) patch.new_password = form.new_password
      if (form.gemini_api_key) patch.gemini_api_key = form.gemini_api_key
      const updated = await adminApi.updateAccountant(acct.id, patch)
      setAcct(updated)
      setForm(f => ({ ...f, new_password: '', gemini_api_key: '' }))
      setSaveMsg('Saved successfully')
    } catch (e: unknown) {
      setSaveMsg(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setSaving(false)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setSaveMsg(''), 4000)
    }
  }

  async function handleLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !acct) return
    try {
      const { logo_url } = await adminApi.uploadLogo(acct.id, file)
      setAcct(a => a ? { ...a, logo_url } : a)
    } catch (e) { console.error(e) }
  }

  if (loading) return <div style={{ padding: 40, color: '#6b7280' }}>Loading…</div>
  if (!acct) return <div style={{ padding: 40, color: '#ef4444' }}>Accountant not found</div>

  const chartData = (analytics?.monthly ?? []).map(m => {
    const [y, mo] = m.month.split('-')
    const label = new Date(Number(y), Number(mo) - 1, 1)
      .toLocaleString('default', { month: 'short', year: '2-digit' })
    return { ...m, label }
  })

  const hasAnyData = chartData.some(m => m.receipts > 0)

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '8px 0 40px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <button onClick={onBack} style={{
          background: 'none', border: '1px solid #e5e7eb', borderRadius: 8,
          padding: '7px 14px', cursor: 'pointer', color: '#374151', fontSize: 14,
        }}>← Back</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
          {acct.logo_url
            ? <img src={acct.logo_url} alt="logo" style={{ width: 42, height: 42, borderRadius: 8, objectFit: 'cover' }} />
            : (
              <div style={{
                width: 42, height: 42, borderRadius: 8, background: '#4f46e5',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontWeight: 700, fontSize: 18,
              }}>{(acct.display_name || acct.username).charAt(0).toUpperCase()}</div>
            )
          }
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>{acct.display_name || acct.username}</div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>{acct.username}</div>
          </div>
        </div>
        <span style={{
          padding: '4px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600,
          background: acct.is_active ? '#d1fae5' : '#fee2e2',
          color: acct.is_active ? '#065f46' : '#991b1b',
        }}>{acct.is_active ? 'Active' : 'Inactive'}</span>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 4 }}>
        <StatCard label="Customers" value={acct.customer_count} color="#4f46e5" />
        <StatCard label="Total Receipts" value={acct.receipt_count} color="#10b981" />
        <StatCard label="Confirmed" value={analytics?.confirmed_count ?? 0} color="#10b981" />
        <StatCard label="Pending" value={analytics?.pending_count ?? 0} color="#f59e0b" />
        <StatCard label="Errors" value={analytics?.error_count ?? 0} color="#ef4444" />
      </div>

      {/* Charts */}
      {analytics === null ? (
        <div style={{ background: '#fff', borderRadius: 12, padding: 32, textAlign: 'center', color: '#9ca3af', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', margin: '20px 0' }}>
          Loading analytics…
        </div>
      ) : !hasAnyData ? (
        <div style={{ background: '#fff', borderRadius: 12, padding: 32, textAlign: 'center', color: '#9ca3af', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', margin: '20px 0' }}>
          No receipt data yet
        </div>
      ) : (
        <>
          <SectionTitle>Monthly Receipts Processed — Last 12 Months</SectionTitle>
          <div style={{ background: '#fff', borderRadius: 12, padding: '20px 16px 8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 20 }}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} barSize={22}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#6b7280' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
                <Tooltip
                  formatter={(val, name) => [Number(val), name === 'receipts' ? 'Total' : name === 'confirmed' ? 'Confirmed' : 'Pending']}
                  labelFormatter={l => `Month: ${l}`}
                  contentStyle={{ borderRadius: 8, fontSize: 13 }}
                />
                <Legend iconType="circle" iconSize={10} wrapperStyle={{ fontSize: 13 }}
                  formatter={(value) => value === 'receipts' ? 'Total' : value === 'confirmed' ? 'Confirmed' : 'Pending'}
                />
                <Bar dataKey="receipts" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                <Bar dataKey="confirmed" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="pending" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* Edit form */}
      <SectionTitle>Profile Settings</SectionTitle>
      <div style={{ background: '#fff', borderRadius: 12, padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px' }}>
          {([
            { key: 'username', label: 'Username (login)' },
            { key: 'display_name', label: 'Display Name' },
            { key: 'company_name', label: 'Company Name' },
            { key: 'email', label: 'Email' },
            { key: 'twilio_from_number', label: 'Twilio Number' },
            { key: 'google_drive_root_folder_id', label: 'Drive Root Folder ID' },
            { key: 'gemini_api_key', label: 'Gemini API Key Override', placeholder: 'Leave blank to keep current' },
            { key: 'new_password', label: 'New Password', type: 'password', placeholder: 'Leave blank to keep current' },
          ] as { key: string; label: string; type?: string; placeholder?: string }[]).map(({ key, label, type, placeholder }) => (
            <div key={key}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>{label}</label>
              <input
                type={type ?? 'text'}
                value={String(form[key] ?? '')}
                placeholder={placeholder}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                style={{
                  width: '100%', padding: '9px 12px', border: '1px solid #e5e7eb',
                  borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
          ))}

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Default Currency</label>
            <select
              value={String(form.default_currency)}
              onChange={e => setForm(f => ({ ...f, default_currency: e.target.value }))}
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14 }}
            >
              <option value="USD">USD</option>
              <option value="ILS">ILS</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 24 }}>
            <input
              type="checkbox"
              id="is_active"
              checked={Boolean(form.is_active)}
              onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            <label htmlFor="is_active" style={{ fontSize: 14, color: '#374151', cursor: 'pointer' }}>Active</label>
          </div>
        </div>

        <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 16 }}>
          {acct.logo_url
            ? <img src={acct.logo_url} alt="logo" style={{ height: 48, borderRadius: 8, border: '1px solid #e5e7eb' }} />
            : <div style={{ fontSize: 13, color: '#9ca3af' }}>No logo</div>
          }
          <button onClick={() => fileRef.current?.click()} style={{
            padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: 8,
            background: '#f9fafb', cursor: 'pointer', fontSize: 13, color: '#374151',
          }}>Upload Logo</button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogo} />
        </div>

        <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '10px 28px', background: saving ? '#a5b4fc' : '#4f46e5',
              color: '#fff', border: 'none', borderRadius: 8, fontSize: 14,
              fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >{saving ? 'Saving…' : 'Save Changes'}</button>
          {saveMsg && (
            <span style={{ fontSize: 13, color: saveMsg.startsWith('Error') ? '#ef4444' : '#10b981', fontWeight: 500 }}>
              {saveMsg}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
