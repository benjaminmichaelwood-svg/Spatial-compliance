import type { Settings } from '../types';

interface Props {
  settings: Settings;
  onChange: (settings: Settings) => void;
}

export default function SettingsPanel({ settings, onChange }: Props) {
  const update = (patch: Partial<Settings>) =>
    onChange({ ...settings, ...patch });

  return (
    <div className="sidebar-section">
      <div className="sidebar-heading">Parameters</div>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-slate-400">
            Min Volume (m³)
          </label>
          <input
            type="number"
            min={0}
            step={0.1}
            value={settings.minVolume}
            onChange={(e) => update({ minVolume: +e.target.value })}
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5
                       font-mono text-xs text-slate-200 focus:border-indigo-500 focus:outline-none
                       focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-400">
            Min Thickness (m)
          </label>
          <input
            type="number"
            min={0}
            step={0.01}
            value={settings.minThickness}
            onChange={(e) => update({ minThickness: +e.target.value })}
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5
                       font-mono text-xs text-slate-200 focus:border-indigo-500 focus:outline-none
                       focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>
    </div>
  );
}
