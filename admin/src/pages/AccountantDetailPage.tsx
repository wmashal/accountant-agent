import { useState, useEffect, useRef } from 'react'
import { adminApi, AccountantOut, UpdateAccountantData } from '../api'

interface Props {
  id: number
  onBack: () => void
}

export default function AccountantDetailPage({ id, onBack }: Props) {
  const [accountant, setAccountant] = useState<AccountantOut | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [form, setForm] = useState<UpdateAccountantData & { new_password?: string }>({})
  const fileRef = useRef<HTMLInputElement>(null)
  const [logoUploading, setLogoUploading] = useState(false)

  useEffect(() => {
    adminApi.getAccountant(id)
      .then(a => {
        setAccountant(a)
        setForm({
          display_name: a.display_name || '',
          company_name: a.company_name || '',
          email: a.email || '',
          google_drive_root_folder_id: a.google_drive_root_folder_id || '',
          twilio_from_number: a.twilio_from_number || '',
          gemini_api_key: '',
          default_currency: a.default_currency,
          is_active: a.is_active,
          new_password: '',
        })
        setLoading(false)
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [id])

  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaveMsg('')
    try {
      const patch: UpdateAccountantData = {
        display_name: form.display_name || undefined,
        company_name: form.company_name || undefined,
        email: form.email || undefined,
        google_drive_root_folder_id: form.google_drive_root_folder_id || undefined,
        twilio_from_number: form.twilio_from_number || undefined,
        gemini_api_key: form.gemini_api_key || undefined,
        default_currency: form.default_currency,
        is_active: form.is_active,
        new_password: form.new_password || undefined,
      }
      const updated = await adminApi.updateAccountant(id, patch)
      setAccountant(updated)
      setForm(f => ({ ...f, new_password: '', gemini_api_key: '' }))
      setSaveMsg('Saved!')
    } catch (e: unknown) {
      setSaveMsg(e instanceof Error ? e.message : 'Error saving')
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg(''), 3000)
    }
  }

  const uploadLogo = async (file: File) => {
    setLogoUploading(true)
    try {
      const res = await adminApi.uploadLogo(id, file)
      setAccountant(a => a ? { ...a, logo_url: res.logo_url } : a)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setLogoUploading(false)
    }
  }

  if (loading) return <div>Loading\u2026</div>
  if (error) return <div style={{ color: 'red' }}>{error}</div>
  if (!accountant) return null

  const iStyle: React.CSSProperties = { padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '1rem', width: '100%' }
  const rowStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem' }

  return (
    <div style={{ maxWidth: '640px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <button onClick={onBack} style={{ padding: '0.3rem 0.7rem', background: 'transparent', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}>\u2190 Back</button>
        <h2>{accountant.username}</h2>
        <span style={{ marginLeft: 'auto', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.85rem', background: accountant.is_active ? '#d4edda' : '#f8d7da', color: accountant.is_active ? '#155724' : '#721c24' }}>
          {accountant.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
        {[['Customers', accountant.customer_count], ['Receipts', accountant.receipt_count]].map(([label, val]) => (
          <div key={String(label)} style={{ background: '#fff', borderRadius: '8px', padding: '1rem 1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', flex: 1 }}>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#1a73e8' }}>{val}</div>
            <div style={{ color: '#666', fontSize: '0.85rem' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Logo section */}
      <div style={{ background: '#fff', borderRadius: '8px', padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Logo</h3>
        {accountant.logo_url && (
          <img src={accountant.logo_url} alt="logo" style={{ maxHeight: '80px', marginBottom: '1rem', display: 'block' }} />
        )}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
        <button onClick={() => fileRef.current?.click()} disabled={logoUploading} style={{ padding: '0.4rem 0.8rem', background: '#f0f2f5', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}>
          {logoUploading ? 'Uploading\u2026' : 'Upload Logo'}
        </button>
      </div>

      {/* Edit form */}
      <form onSubmit={save} style={{ background: '#fff', borderRadius: '8px', padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h3>Edit Profile</h3>
        <div style={rowStyle}><label>Display Name</label><input value={form.display_name} onChange={e => set('display_name', e.target.value)} style={iStyle} /></div>
        <div style={rowStyle}><label>Company Name</label><input value={form.company_name} onChange={e => set('company_name', e.target.value)} style={iStyle} /></div>
        <div style={rowStyle}><label>Email</label><input type="email" value={form.email} onChange={e => set('email', e.target.value)} style={iStyle} /></div>
        <div style={rowStyle}><label>Google Drive Root Folder ID</label><input value={form.google_drive_root_folder_id} onChange={e => set('google_drive_root_folder_id', e.target.value)} style={iStyle} /></div>
        <div style={rowStyle}><label>Twilio From Number</label><input value={form.twilio_from_number} onChange={e => set('twilio_from_number', e.target.value)} placeholder="+14155238886" style={iStyle} /></div>
        <div style={rowStyle}><label>Gemini API Key (leave blank to keep current)</label><input value={form.gemini_api_key} onChange={e => set('gemini_api_key', e.target.value)} placeholder="sk-\u2026" style={iStyle} /></div>
        <div style={rowStyle}>
          <label>Default Currency</label>
          <select value={form.default_currency} onChange={e => set('default_currency', e.target.value)} style={iStyle}>
            <option value="USD">USD</option>
            <option value="ILS">ILS</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input type="checkbox" id="active" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} />
          <label htmlFor="active">Active</label>
        </div>
        <div style={rowStyle}><label>New Password (leave blank to keep current)</label><input type="password" value={form.new_password} onChange={e => set('new_password', e.target.value)} style={iStyle} /></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button type="submit" disabled={saving} style={{ padding: '0.6rem 1.5rem', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '1rem' }}>
            {saving ? 'Saving\u2026' : 'Save'}
          </button>
          {saveMsg && <span style={{ color: saveMsg === 'Saved!' ? 'green' : 'red' }}>{saveMsg}</span>}
        </div>
      </form>
    </div>
  )
}
