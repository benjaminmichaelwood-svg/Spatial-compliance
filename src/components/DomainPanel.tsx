import { ConformanceDomain, DomainType } from '../compliance/types';

interface DomainPanelProps {
  domains: ConformanceDomain[];
  onToggle: (index: number) => void;
  onToggleAll: (visible: boolean) => void;
  inputSurfaces?: { name: string; visible: boolean }[];
  onToggleInput?: (index: number) => void;
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} Mm³`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)} km³`;
  return `${v.toFixed(1)} m³`;
}

function formatArea(a: number): string {
  if (a >= 1_000_000) return `${(a / 1_000_000).toFixed(2)} km²`;
  if (a >= 10_000) return `${(a / 10_000).toFixed(2)} ha`;
  return `${a.toFixed(1)} m²`;
}

export function DomainPanel({
  domains,
  onToggle,
  onToggleAll,
  inputSurfaces,
  onToggleInput,
}: DomainPanelProps) {
  const cutDomains = domains.filter(
    (d) => !d.type.startsWith('Dump')
  );
  const dumpDomains = domains.filter(
    (d) => d.type.startsWith('Dump')
  );

  return (
    <div className="domain-panel">
      <div className="panel-header">
        <h3>Conformance Domains</h3>
        <div className="toggle-all">
          <button className="btn-sm" onClick={() => onToggleAll(true)}>Show All</button>
          <button className="btn-sm" onClick={() => onToggleAll(false)}>Hide All</button>
        </div>
      </div>

      {inputSurfaces && inputSurfaces.length > 0 && (
        <div className="domain-section">
          <h4>Input Surfaces</h4>
          {inputSurfaces.map((s, i) => (
            <div
              key={`input-${i}`}
              className={`domain-item ${s.visible ? '' : 'hidden'}`}
              onClick={() => onToggleInput?.(i)}
            >
              <div className="domain-swatch" style={{ background: '#888', opacity: s.visible ? 1 : 0.3 }} />
              <div className="domain-info">
                <span className="domain-name">{s.name}</span>
              </div>
              <div className="domain-toggle">
                <div className={`toggle-switch ${s.visible ? 'on' : 'off'}`} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="domain-section">
        <h4>Cut Domains (Pit)</h4>
        {cutDomains.map((domain, i) => {
          const globalIndex = domains.indexOf(domain);
          return (
            <div
              key={domain.type}
              className={`domain-item ${domain.visible ? '' : 'hidden'}`}
              onClick={() => onToggle(globalIndex)}
            >
              <div
                className="domain-swatch"
                style={{ background: domain.color, opacity: domain.visible ? 1 : 0.3 }}
              />
              <div className="domain-info">
                <span className="domain-name">{domain.type}</span>
                <span className="domain-stats">
                  {formatVolume(domain.volume)} &middot; {formatArea(domain.area)}
                </span>
              </div>
              <div className="domain-toggle">
                <div className={`toggle-switch ${domain.visible ? 'on' : 'off'}`} />
              </div>
            </div>
          );
        })}
      </div>

      {dumpDomains.length > 0 && (
        <div className="domain-section">
          <h4>Dump Domains</h4>
          {dumpDomains.map((domain) => {
            const globalIndex = domains.indexOf(domain);
            return (
              <div
                key={domain.type}
                className={`domain-item ${domain.visible ? '' : 'hidden'}`}
                onClick={() => onToggle(globalIndex)}
              >
                <div
                  className="domain-swatch"
                  style={{ background: domain.color, opacity: domain.visible ? 1 : 0.3 }}
                />
                <div className="domain-info">
                  <span className="domain-name">{domain.type}</span>
                  <span className="domain-stats">
                    {formatVolume(domain.volume)} &middot; {formatArea(domain.area)}
                  </span>
                </div>
                <div className="domain-toggle">
                  <div className={`toggle-switch ${domain.visible ? 'on' : 'off'}`} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
