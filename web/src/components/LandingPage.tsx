import { useState } from 'react';
import type { Mode } from '../types';

interface Props {
  onStart: (name: string, mode: Mode) => void;
}

export default function LandingPage({ onStart }: Props) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<Mode | null>(null);

  return (
    <div className="flex h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="w-full max-w-lg px-6">
        <div className="mb-10 text-center">
          <div className="mb-3 text-sm font-semibold uppercase tracking-widest text-indigo-600">
            Spatial Compliance
          </div>
          <h1 className="text-3xl font-bold text-slate-900">
            New Comparison
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Compare production surfaces against schedule to classify conformance domains.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Comparison Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Pit 4 — June 2026"
            className="input-field mb-6"
          />

          <label className="mb-2 block text-sm font-medium text-slate-700">
            Mode
          </label>
          <div className="mb-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMode('dig')}
              className={`group relative rounded-lg border-2 p-4 text-left transition-all ${
                mode === 'dig'
                  ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className="mb-1 flex items-center gap-2">
                <svg className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
                <span className="text-sm font-semibold text-slate-900">Dig</span>
              </div>
              <p className="text-xs text-slate-500">
                Material removal — surfaces move down
              </p>
            </button>

            <button
              type="button"
              onClick={() => setMode('dump')}
              className={`group relative rounded-lg border-2 p-4 text-left transition-all ${
                mode === 'dump'
                  ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className="mb-1 flex items-center gap-2">
                <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
                <span className="text-sm font-semibold text-slate-900">Dump</span>
              </div>
              <p className="text-xs text-slate-500">
                Material placement — surfaces move up
              </p>
            </button>
          </div>

          <button
            type="button"
            disabled={!name.trim() || !mode}
            onClick={() => onStart(name.trim(), mode!)}
            className="btn-primary w-full"
          >
            Create Comparison
          </button>
        </div>
      </div>
    </div>
  );
}
