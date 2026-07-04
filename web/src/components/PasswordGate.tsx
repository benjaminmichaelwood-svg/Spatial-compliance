import { useState, useCallback } from 'react';
import { APP_PASSWORD, AUTH_SESSION_KEY } from '../constants';

interface Props {
  onAuthenticated: () => void;
}

export default function PasswordGate({ onAuthenticated }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (password === APP_PASSWORD) {
        sessionStorage.setItem(AUTH_SESSION_KEY, '1');
        onAuthenticated();
      } else {
        setError(true);
      }
    },
    [password, onAuthenticated],
  );

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-sidebar">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-800/80 p-8 shadow-2xl"
      >
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold text-white">Spatial Compliance</h1>
          <p className="mt-1 text-xs text-slate-400">Enter password to continue</p>
        </div>

        <input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(false);
          }}
          placeholder="Password"
          autoFocus
          className="w-full rounded-lg border border-slate-600 bg-slate-900 px-4 py-2.5 text-sm
                     text-white placeholder-slate-500 outline-none transition-colors
                     focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />

        {error && (
          <p className="mt-2 text-xs text-red-400">Incorrect password</p>
        )}

        <button
          type="submit"
          className="mt-4 w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white
                     transition-colors hover:bg-indigo-700"
        >
          Login
        </button>
      </form>
    </div>
  );
}
