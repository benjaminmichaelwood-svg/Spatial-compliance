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
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-slate-400">Grid Resolution</label>
            <span className="font-mono text-xs text-slate-300">
              {settings.resolution}
            </span>
          </div>
          <input
            type="range"
            min={5}
            max={100}
            step={5}
            value={settings.resolution}
            onChange={(e) => update({ resolution: +e.target.value })}
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-slate-700
                       accent-indigo-500 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                       [&::-webkit-slider-thumb]:bg-indigo-500"
          />
        </div>

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
