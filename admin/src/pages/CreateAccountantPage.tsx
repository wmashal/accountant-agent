import { useState } from 'react'
import { adminApi, CreateAccountantData } from '../api'

interface Props {
  onBack: () => void
  onCreated: (id: number) => void
}

export default function CreateAccountantPage({ onBack, onCreated }: Props) {
  const [form, setForm] = useState<CreateAccountantData>({
    username: '',
    password: '',
    display_name: '',
    company_name: '',
    email: '',
    google_drive_root_folder_id: '',
    twilio_from_number: '',
    gemini_api_key: '',
    default_currency: 'USD',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const set = (k: keyof CreateAccountantData, v: string) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const clean: CreateAccountantData = {
        ...form,
        display_name: form.display_name || undefined,
        company_name: form.company_name || undefined,
        email: form.email || undefined,
        google_drive_root_folder_id: form.google_drive_root_folder_id || undefined,
        twilio_from_number: form.twilio_from_number || undefined,
        gemini_api_key: form.gemini_api_key || undefined,
      }
      const acc = await adminApi.createAccountant(clean)
      onCreated(acc.id)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }

  const iStyle: React.CSSProperties = { padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '1rem', width: '100%' }
  const rowStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem' }

  return (
    <div style={{ maxWidth: '600px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <button onClick={onBack} style={{ padding: '0.3rem 0.7rem', background: 'transparent', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer' }}>\u2190 Back</button>
        <h2>New Accountant</h2>
      </div>
      {error && <div style={{ color: 'red', marginBottom: '1rem' }}>{error}</div>}
      <form onSubmit={submit} style={{ background: '#fff', borderRadius: '8px', padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={rowStyle}><label>Username *</label><input required value={form.username} onChange={e => set('username', e.target.value)} style={iStyle} /></div>
        <div style={rowStyle}><label>Password *</label><input type="password" required value={form.password} onChange={e => set('password', e.target.value)} style={iStyle} /></div>
        <div style={rowStyle}><label>Display Name</label><input value={form.display_name} onChange={e => set('display_name', e.target.value)} style={iStyle} /></div>
        <div style={rowStyle}><label>Company Name</label><input value={form.company_name} onChange={e => set('company_name', e.target.value)} style={iStyle} /></div>
        <div style={rowStyle}><label>Email</label><input type="email" value={form.email} onChange={e => set('email', e.target.value)} style={iStyle} /></div>
        <div style={rowStyle}><label>Google Drive Root Folder ID</label><input value={form.google_drive_root_folder_id} onChange={e => set('google_drive_root_folder_id', e.target.value)} style={iStyle} /></div>
        <div style={rowStyle}><label>Twilio From Number</label><input value={form.twilio_from_number} onChange={e => set('twilio_from_number', e.target.value)} placeholder="+14155238886" style={iStyle} /></div>
        <div style={rowStyle}><label>Gemini API Key (optional override)</label><input value={form.gemini_api_key} onChange={e => set('gemini_api_key', e.target.value)} style={iStyle} /></div>
        <div style={rowStyle}>
          <label>Default Currency</label>
          <select value={form.default_currency} onChange={e => set('default_currency', e.target.value)} style={iStyle}>
            <option value="USD">USD</option>
            <option value="ILS">ILS</option>
          </select>
        </div>
        <button type="submit" disabled={loading} style={{ padding: '0.6rem', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '1rem' }}>
          {loading ? 'Creating\u2026' : 'Create Accountant'}
        </button>
      </form>
    </div>
  )
}
