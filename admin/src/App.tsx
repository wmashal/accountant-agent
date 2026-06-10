import { useState } from 'react'
import { getToken, setToken, clearToken, adminApi } from './api'
import DashboardPage from './pages/DashboardPage'
import AccountantsListPage from './pages/AccountantsListPage'
import CreateAccountantPage from './pages/CreateAccountantPage'
import AccountantDetailPage from './pages/AccountantDetailPage'

type Page =
  | { name: 'dashboard' }
  | { name: 'accountants' }
  | { name: 'create' }
  | { name: 'detail'; id: number }

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await adminApi.login(username, password)
      setToken(res.access_token)
      onLogin()
    } catch {
      setError('Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <form onSubmit={submit} style={{ background: '#fff', padding: '2rem', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', minWidth: '320px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h2 style={{ textAlign: 'center' }}>Admin Login</h2>
        {error && <div style={{ color: 'red', fontSize: '0.9rem' }}>{error}</div>}
        <input type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} required style={inputStyle} />
        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required style={inputStyle} />
        <button type="submit" disabled={loading} style={btnStyle}>{loading ? 'Logging in\u2026' : 'Login'}</button>
      </form>
    </div>
  )
}

const inputStyle: React.CSSProperties = { padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '1rem' }
const btnStyle: React.CSSProperties = { padding: '0.6rem', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '1rem' }

export default function App() {
  const [token, setTokenState] = useState<string | null>(() => getToken())

  const handleLogin = () => setTokenState(getToken())
  const handleLogout = () => { clearToken(); setTokenState(null) }

  if (!token) return <LoginPage onLogin={handleLogin} />
  return <AdminShell onLogout={handleLogout} />
}

function AdminShell({ onLogout }: { onLogout: () => void }) {
  const [page, setPage] = useState<Page>({ name: 'dashboard' })

  const nav = (p: Page) => setPage(p)

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <nav style={{ width: '200px', background: '#1a1a2e', color: '#fff', display: 'flex', flexDirection: 'column', padding: '1.5rem 1rem', gap: '0.5rem', flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '1rem' }}>Admin Panel</div>
        <NavLink label="Dashboard" active={page.name === 'dashboard'} onClick={() => nav({ name: 'dashboard' })} />
        <NavLink label="Accountants" active={page.name === 'accountants' || page.name === 'detail' || page.name === 'create'} onClick={() => nav({ name: 'accountants' })} />
        <div style={{ marginTop: 'auto' }}>
          <button onClick={onLogout} style={{ width: '100%', padding: '0.4rem', background: 'transparent', border: '1px solid #555', borderRadius: '4px', color: '#aaa', cursor: 'pointer', fontSize: '0.85rem' }}>
            Logout
          </button>
        </div>
      </nav>

      {/* Main */}
      <main style={{ flex: 1, padding: '2rem', overflow: 'auto' }}>
        {page.name === 'dashboard' && <DashboardPage />}
        {page.name === 'accountants' && <AccountantsListPage onSelect={id => nav({ name: 'detail', id })} onCreate={() => nav({ name: 'create' })} />}
        {page.name === 'create' && <CreateAccountantPage onBack={() => nav({ name: 'accountants' })} onCreated={id => nav({ name: 'detail', id })} />}
        {page.name === 'detail' && <AccountantDetailPage accountantId={page.id} onBack={() => nav({ name: 'accountants' })} />}
      </main>
    </div>
  )
}

function NavLink({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ padding: '0.5rem 0.75rem', background: active ? '#16213e' : 'transparent', border: 'none', borderRadius: '4px', color: active ? '#fff' : '#aaa', cursor: 'pointer', textAlign: 'left', fontSize: '0.95rem' }}>
      {label}
    </button>
  )
}
