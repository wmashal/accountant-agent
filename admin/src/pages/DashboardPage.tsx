import { useState, useEffect } from 'react'
import { adminApi, GlobalStats } from '../api'

export default function DashboardPage() {
  const [stats, setStats] = useState<GlobalStats | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    adminApi.getStats()
      .then(setStats)
      .catch(e => setError(e.message))
  }, [])

  if (error) return <div style={{ color: 'red' }}>{error}</div>
  if (!stats) return <div>Loading\u2026</div>

  const cards = [
    { label: 'Total Accountants', value: stats.total_accountants },
    { label: 'Active Accountants', value: stats.active_accountants },
    { label: 'Total Customers', value: stats.total_customers },
    { label: 'Total Receipts', value: stats.total_receipts },
    { label: 'Receipts This Month', value: stats.receipts_this_month },
  ]

  return (
    <div>
      <h2 style={{ marginBottom: '1.5rem' }}>Overview</h2>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        {cards.map(c => (
          <div key={c.label} style={{ background: '#fff', borderRadius: '8px', padding: '1.5rem', minWidth: '160px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', flex: '1' }}>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: '#1a73e8' }}>{c.value}</div>
            <div style={{ color: '#666', marginTop: '0.25rem', fontSize: '0.9rem' }}>{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
