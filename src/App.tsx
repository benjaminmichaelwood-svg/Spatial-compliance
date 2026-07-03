import { useState, useCallback } from 'react';
import { TriangulatedSurface } from './engine/types';
import { parseSurfaceFile } from './parsers/vulcan-oot';
import { computeCompliance, ComplianceInputs } from './compliance/domains';
import { ComplianceResult, SurfaceRole, ConformanceDomain } from './compliance/types';
import { SceneViewer } from './viewer/SceneViewer';
import { FileUpload } from './components/FileUpload';
import { DomainPanel } from './components/DomainPanel';
import { ReportPanel } from './components/ReportPanel';

type ViewTab = 'upload' | '3d' | 'report';

interface ParsedSurfaceEntry {
  surface: TriangulatedSurface;
  role: SurfaceRole;
  name: string;
  color: string;
  visible: boolean;
}

const ROLE_COLORS: Record<SurfaceRole, string> = {
  'pre-mining': '#9E9E9E',
  'planned-eop': '#2196F3',
  'actual-eop': '#FF5722',
  'planned-start': '#00BCD4',
  'actual-start': '#FF9800',
  'planned-dump': '#8BC34A',
  'actual-dump': '#E91E63',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ViewTab>('upload');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComplianceResult | null>(null);
  const [domains, setDomains] = useState<ConformanceDomain[]>([]);
  const [inputSurfaces, setInputSurfaces] = useState<ParsedSurfaceEntry[]>([]);
  const [wireframe, setWireframe] = useState(false);
  const [resolution, setResolution] = useState(80);

  const handleFilesReady = useCallback(async (files: { file: File; role: SurfaceRole; name: string }[]) => {
    setIsProcessing(true);
    setError(null);

    try {
      const parsed: Map<SurfaceRole, TriangulatedSurface> = new Map();
      const allEntries: ParsedSurfaceEntry[] = [];

      for (const entry of files) {
        const buffer = await entry.file.arrayBuffer();
        const surfaces = parseSurfaceFile(buffer, entry.name);

        if (surfaces.length === 0) {
          throw new Error(`No surfaces found in ${entry.name}`);
        }

        const surface = surfaces[0];
        parsed.set(entry.role, surface);
        allEntries.push({
          surface,
          role: entry.role,
          name: `${entry.name} (${entry.role})`,
          color: ROLE_COLORS[entry.role],
          visible: false,
        });
      }

      const preMining = parsed.get('pre-mining');
      const plannedEOP = parsed.get('planned-eop');
      const actualEOP = parsed.get('actual-eop');

      if (!preMining || !plannedEOP || !actualEOP) {
        throw new Error('Missing required surfaces: Pre-Mining, Planned EOP, and Actual EOP');
      }

      const inputs: ComplianceInputs = {
        preMining,
        plannedEOP,
        actualEOP,
        plannedStart: parsed.get('planned-start'),
        actualStart: parsed.get('actual-start'),
        plannedDump: parsed.get('planned-dump'),
        actualDump: parsed.get('actual-dump'),
        resolution,
      };

      const complianceResult = computeCompliance(inputs);

      setResult(complianceResult);
      setDomains(complianceResult.domains);
      setInputSurfaces(allEntries);
      setActiveTab('3d');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error during processing');
    } finally {
      setIsProcessing(false);
    }
  }, [resolution]);

  const handleToggleDomain = useCallback((index: number) => {
    setDomains((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], visible: !updated[index].visible };
      return updated;
    });
  }, []);

  const handleToggleAll = useCallback((visible: boolean) => {
    setDomains((prev) => prev.map((d) => ({ ...d, visible })));
  }, []);

  const handleToggleInput = useCallback((index: number) => {
    setInputSurfaces((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], visible: !updated[index].visible };
      return updated;
    });
  }, []);

  const handleExportCSV = useCallback(() => {
    if (!result) return;

    const rows = [
      ['Domain', 'Volume (m³)', 'Area (m²)', 'Color'],
      ...result.domains.map((d) => [
        d.type,
        d.volume.toFixed(2),
        d.area.toFixed(2),
        d.color,
      ]),
      [],
      ['Overall Conformance (%)', result.conformancePercent.toFixed(2)],
      ['Total Planned Volume (m³)', result.totalPlannedVolume.toFixed(2)],
      ['Total Actual Volume (m³)', result.totalActualVolume.toFixed(2)],
      ['Generated', result.timestamp],
    ];

    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compliance_report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo">
          <span className="logo-icon">&#9650;</span>
          <h1>Mining Spatial Compliance</h1>
        </div>
        <nav className="tab-nav">
          <button
            className={`tab ${activeTab === 'upload' ? 'active' : ''}`}
            onClick={() => setActiveTab('upload')}
          >
            Upload
          </button>
          <button
            className={`tab ${activeTab === '3d' ? 'active' : ''}`}
            onClick={() => setActiveTab('3d')}
            disabled={!result}
          >
            3D Viewer
          </button>
          <button
            className={`tab ${activeTab === 'report' ? 'active' : ''}`}
            onClick={() => setActiveTab('report')}
            disabled={!result}
          >
            Report
          </button>
        </nav>
        {result && (
          <div className="header-stats">
            <span className={`conformance-badge ${result.conformancePercent >= 75 ? 'good' : 'poor'}`}>
              {result.conformancePercent.toFixed(1)}% Conformance
            </span>
          </div>
        )}
      </header>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => setError(null)}>&times;</button>
        </div>
      )}

      <main className="app-main">
        {activeTab === 'upload' && (
          <div className="upload-view">
            <FileUpload onFilesReady={handleFilesReady} isProcessing={isProcessing} />
            <div className="settings-panel">
              <h4>Analysis Settings</h4>
              <label>
                Grid Resolution
                <input
                  type="range"
                  min={20}
                  max={200}
                  value={resolution}
                  onChange={(e) => setResolution(parseInt(e.target.value))}
                />
                <span>{resolution}</span>
              </label>
              <p className="settings-hint">
                Higher resolution = more accurate volumes but slower processing.
                80 is a good default for most pit sizes.
              </p>
            </div>
          </div>
        )}

        {activeTab === '3d' && result && (
          <div className="viewer-layout">
            <div className="viewer-sidebar">
              <DomainPanel
                domains={domains}
                onToggle={handleToggleDomain}
                onToggleAll={handleToggleAll}
                inputSurfaces={inputSurfaces.map((s) => ({
                  name: s.name,
                  visible: s.visible,
                }))}
                onToggleInput={handleToggleInput}
              />
              <div className="viewer-controls">
                <label>
                  <input
                    type="checkbox"
                    checked={wireframe}
                    onChange={(e) => setWireframe(e.target.checked)}
                  />
                  Wireframe Overlay
                </label>
              </div>
            </div>
            <div className="viewer-canvas">
              <SceneViewer
                domains={domains}
                inputSurfaces={inputSurfaces}
                wireframe={wireframe}
              />
            </div>
          </div>
        )}

        {activeTab === 'report' && result && (
          <div className="report-view">
            <ReportPanel result={result} onExportCSV={handleExportCSV} />
          </div>
        )}
      </main>
    </div>
  );
}
