import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Lock, Phone } from 'lucide-react';
import { errorMessage } from '../api/client';
import { useAuth } from '../auth/context';
import { LogoMark } from '../components/Logo';
import { Spinner } from '../components/ui';
import { normalizePhone } from '../lib/format';


export default function LoginPage() {
  const { status, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'authenticated') {
    const from = (loc.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const p = normalizePhone(phone);
    if (!p) {
      setError('Numéro invalide : 9 chiffres commençant par 6 ou 2 (ex. 690 00 00 01).');
      return;
    }
    if (!password) {
      setError('Saisissez votre mot de passe.');
      return;
    }
    setBusy(true);
    try {
      await login(p, password);
      nav('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        background: 'radial-gradient(1200px 600px at 10% -10%, #1a9a50 0%, #0b3d2e 55%, #072a20 100%)',
      }}
    >
      <form className="card" onSubmit={submit} style={{ width: 'min(420px, 100%)', padding: 32 }} noValidate>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <LogoMark size={56} />
          <h1 style={{ marginTop: 8, fontSize: 28, color: 'var(--green-900)' }}>Tasko</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Espace d'administration
          </p>
        </div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label htmlFor="phone">Téléphone</label>
          <div className="search">
            <Phone size={16} />
            <input
              id="phone"
              className="input"
              inputMode="tel"
              autoComplete="username"
              placeholder="6XX XX XX XX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 18 }}>
          <label htmlFor="password">Mot de passe</label>
          <div className="search">
            <Lock size={16} />
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        {error && (
          <div className="notice" style={{ marginBottom: 14, background: 'var(--red-100)', color: 'var(--red)' }} role="alert">
            {error}
          </div>
        )}
        <button className="btn btn-block" type="submit" disabled={busy} style={{ height: 44 }}>
          {busy ? <Spinner small /> : 'Se connecter'}
        </button>
        <p className="hint" style={{ textAlign: 'center', marginTop: 16 }}>
          Accès réservé aux administrateurs de la plateforme.
        </p>
      </form>
    </div>
  );
}
