import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PasswordGate from './components/PasswordGate';
import { AUTH_SESSION_KEY } from './constants';
import './index.css';

function Root() {
  const [authed, setAuthed] = useState(
    () => sessionStorage.getItem(AUTH_SESSION_KEY) === '1',
  );

  if (!authed) {
    return <PasswordGate onAuthenticated={() => setAuthed(true)} />;
  }

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
