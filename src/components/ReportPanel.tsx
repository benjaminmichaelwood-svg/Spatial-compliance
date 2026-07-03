import { ComplianceResult, DomainType } from '../compliance/types';

interface ReportPanelProps {
  result: ComplianceResult;
  onExportCSV: () => void;
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

function getConformanceClass(pct: number): string {
  if (pct >= 90) return 'excellent';
  if (pct >= 75) return 'good';
  if (pct >= 50) return 'fair';
  return 'poor';
}

export function ReportPanel({ result, onExportCSV }: ReportPanelProps) {
  const cutDomains = result.domains.filter((d) => !d.type.startsWith('Dump'));
  const dumpDomains = result.domains.filter((d) => d.type.startsWith('Dump'));

  return (
    <div className="report-panel">
      <div className="report-header">
        <h3>Compliance Report</h3>
        <button className="btn-sm" onClick={onExportCSV}>Export CSV</button>
      </div>

      <div className="summary-cards">
        <div className={`summary-card conformance ${getConformanceClass(result.conformancePercent)}`}>
          <div className="card-value">{result.conformancePercent.toFixed(1)}%</div>
          <div className="card-label">Overall Conformance</div>
        </div>
        <div className="summary-card">
          <div className="card-value">{formatVolume(result.totalPlannedVolume)}</div>
          <div className="card-label">Planned Volume</div>
        </div>
        <div className="summary-card">
          <div className="card-value">{formatVolume(result.totalActualVolume)}</div>
          <div className="card-label">Actual Volume</div>
        </div>
      </div>

      <div className="report-table">
        <h4>Cut Domain Summary</h4>
        <table>
          <thead>
            <tr>
              <th>Domain</th>
              <th>Volume</th>
              <th>Area</th>
              <th>% of Total</th>
            </tr>
          </thead>
          <tbody>
            {cutDomains.map((d) => {
              const totalCutVol = cutDomains.reduce((s, dd) => s + dd.volume, 0);
              const pct = totalCutVol > 0 ? (d.volume / totalCutVol) * 100 : 0;
              return (
                <tr key={d.type}>
                  <td>
                    <span className="color-dot" style={{ background: d.color }} />
                    {d.type}
                  </td>
                  <td>{formatVolume(d.volume)}</td>
                  <td>{formatArea(d.area)}</td>
                  <td>{pct.toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {dumpDomains.length > 0 && (
        <div className="report-table">
          <h4>Dump Domain Summary</h4>
          <table>
            <thead>
              <tr>
                <th>Domain</th>
                <th>Volume</th>
                <th>Area</th>
                <th>% of Total</th>
              </tr>
            </thead>
            <tbody>
              {dumpDomains.map((d) => {
                const totalDumpVol = dumpDomains.reduce((s, dd) => s + dd.volume, 0);
                const pct = totalDumpVol > 0 ? (d.volume / totalDumpVol) * 100 : 0;
                return (
                  <tr key={d.type}>
                    <td>
                      <span className="color-dot" style={{ background: d.color }} />
                      {d.type}
                    </td>
                    <td>{formatVolume(d.volume)}</td>
                    <td>{formatArea(d.area)}</td>
                    <td>{pct.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="report-footer">
        <p>Generated: {new Date(result.timestamp).toLocaleString()}</p>
      </div>
    </div>
  );
}
