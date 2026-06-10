import { useState, useEffect } from 'react'
import { adminApi, AccountantOut } from '../api'

interface Props {
  onSelect: (id: number) => void
  onCreate: () => void
}

export default function AccountantsListPage({ onSelect, onCreate }: Props) {
  const [accountants, setAccountants] = useState<AccountantOut[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    adminApi.listAccountants()
      .then(data => { setAccountants(data); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return <div>Loading\u2026</div>
  if (error) return <div style={{ color: 'red' }}>{error}</div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2>Accountants</h2>
        <button onClick={onCreate} style={{ padding: '0.5rem 1rem', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          + New Accountant
        </button>
      </div>
      <div style={{ background: '#fff', borderRadius: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ background: '#f8f9fa', borderBottom: '1px solid #eee' }}>
              {['Username', 'Name', 'Company', 'Twilio #', 'Currency', 'Status', 'Customers', 'Receipts', ''].map(h => (
                <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, color: '#555' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {accountants.map(a => (
              <tr key={a.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '0.75rem 1rem' }}>{a.username}</td>
                <td style={{ padding: '0.75rem 1rem' }}>{a.display_name || '\u2014'}</td>
                <td style={{ padding: '0.75rem 1rem' }}>{a.company_name || '\u2014'}</td>
                <td style={{ padding: '0.75rem 1rem' }}>{a.twilio_from_number || '\u2014'}</td>
                <td style={{ padding: '0.75rem 1rem' }}>{a.default_currency}</td>
                <td style={{ padding: '0.75rem 1rem' }}>
                  <span style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', background: a.is_active ? '#d4edda' : '#f8d7da', color: a.is_active ? '#155724' : '#721c24' }}>
                    {a.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>{a.customer_count}</td>
                <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>{a.receipt_count}</td>
                <td style={{ padding: '0.75rem 1rem' }}>
                  <button onClick={() => onSelect(a.id)} style={{ padding: '0.3rem 0.7rem', background: 'transparent', border: '1px solid #1a73e8', borderRadius: '4px', color: '#1a73e8', cursor: 'pointer', fontSize: '0.85rem' }}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
