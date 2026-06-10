import { useState, useEffect } from 'react'
import { adminApi, GlobalStats, AccountantOut } from '../api'

interface Props {
  onSelectAccountant: (id: number) => void
}

export default function DashboardPage({ onSelectAccountant }: Props) {
  const [stats, setStats] = useState<GlobalStats | null>(null)
  const [accountants, setAccountants] = useState<AccountantOut[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([adminApi.getStats(), adminApi.listAccountants()])
      .then(([s, a]) => { setStats(s); setAccountants(a) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ padding: 40, color: '#6b7280' }}>Loading…</div>
  if (error) return <div style={{ padding: 40, color: '#ef4444' }}>{error}</div>

  const statCards = stats ? [
    { label: 'Total Accountants', value: stats.total_accountants, color: '#4f46e5' },
    { label: 'Active Accountants', value: stats.active_accountants, color: '#10b981' },
    { label: 'Total Customers', value: stats.total_customers, color: '#06b6d4' },
    { label: 'Total Receipts', value: stats.total_receipts, color: '#8b5cf6' },
    { label: 'Receipts This Month', value: stats.receipts_this_month, color: '#f59e0b' },
  ] : []

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '8px 0 40px' }}>
      <h2 style={{ margin: '0 0 20px', fontSize: 22, fontWeight: 700, color: '#111827' }}>Overview</h2>

      {/* Global stats */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 36 }}>
        {statCards.map(c => (
          <div key={c.label} style={{
            background: '#fff', borderRadius: 12, padding: '20px 24px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)', borderLeft: `4px solid ${c.color}`,
            minWidth: 140, flex: 1,
          }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#111827' }}>{c.value}</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Accountants */}
      <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#374151' }}>Accountants</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {accountants.map(a => (
          <button
            key={a.id}
            onClick={() => onSelectAccountant(a.id)}
            style={{
              background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
              padding: '20px 22px', cursor: 'pointer', textAlign: 'left',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              transition: 'box-shadow 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 12px rgba(79,70,229,0.15)'
              ;(e.currentTarget as HTMLButtonElement).style.borderColor = '#4f46e5'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)'
              ;(e.currentTarget as HTMLButtonElement).style.borderColor = '#e5e7eb'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              {a.logo_url
                ? <img src={a.logo_url} alt="logo" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }} />
                : (
                  <div style={{
                    width: 40, height: 40, borderRadius: 8, background: '#4f46e5',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 700, fontSize: 17, flexShrink: 0,
                  }}>{(a.display_name || a.username).charAt(0).toUpperCase()}</div>
                )
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.display_name || a.username}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{a.username}</div>
              </div>
              <span style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, flexShrink: 0,
                background: a.is_active ? '#d1fae5' : '#fee2e2',
                color: a.is_active ? '#065f46' : '#991b1b',
              }}>{a.is_active ? 'Active' : 'Inactive'}</span>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, background: '#f9fafb', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>{a.customer_count}</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Customers</div>
              </div>
              <div style={{ flex: 1, background: '#f9fafb', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>{a.receipt_count}</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Receipts</div>
              </div>
              <div style={{ flex: 1, background: '#f9fafb', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{a.default_currency}</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Currency</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
