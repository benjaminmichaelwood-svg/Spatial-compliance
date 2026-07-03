import { useCallback, useState } from 'react';
import { SurfaceRole } from '../compliance/types';

interface SurfaceFileEntry {
  file: File;
  role: SurfaceRole;
  name: string;
}

interface FileUploadProps {
  onFilesReady: (files: SurfaceFileEntry[]) => void;
  isProcessing: boolean;
}

const ROLE_OPTIONS: { value: SurfaceRole; label: string; description: string; required?: boolean }[] = [
  { value: 'pre-mining', label: 'Pre-Mining Surface', description: 'Original topography before mining', required: true },
  { value: 'planned-eop', label: 'Planned End-of-Period', description: 'Planned pit design for the period', required: true },
  { value: 'actual-eop', label: 'Actual End-of-Period', description: 'As-mined survey surface', required: true },
  { value: 'planned-start', label: 'Planned Start-of-Period', description: 'Planned surface at period start (optional)' },
  { value: 'actual-start', label: 'Actual Start-of-Period', description: 'Surveyed surface at period start (optional)' },
  { value: 'planned-dump', label: 'Planned Dump Surface', description: 'Planned waste dump design (optional)' },
  { value: 'actual-dump', label: 'Actual Dump Surface', description: 'As-built dump survey (optional)' },
];

export function FileUpload({ onFilesReady, isProcessing }: FileUploadProps) {
  const [entries, setEntries] = useState<SurfaceFileEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const handleFileAdd = useCallback((files: FileList | null, role?: SurfaceRole) => {
    if (!files) return;
    const newEntries: SurfaceFileEntry[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      newEntries.push({
        file,
        role: role ?? 'pre-mining',
        name: file.name,
      });
    }
    setEntries((prev) => [...prev, ...newEntries]);
  }, []);

  const handleRoleChange = useCallback((index: number, role: SurfaceRole) => {
    setEntries((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], role };
      return updated;
    });
  }, []);

  const handleRemove = useCallback((index: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFileAdd(e.dataTransfer.files);
  }, [handleFileAdd]);

  const requiredRoles: SurfaceRole[] = ['pre-mining', 'planned-eop', 'actual-eop'];
  const hasRequired = requiredRoles.every((role) =>
    entries.some((e) => e.role === role)
  );

  return (
    <div className="file-upload">
      <h3>Surface Files</h3>
      <p className="upload-hint">
        Upload Vulcan .00t triangulation files, OBJ, or CSV/XYZ point data.
        Assign each file a role for compliance analysis.
      </p>

      <div
        className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.multiple = true;
          input.accept = '.00t,.oot,.obj,.csv,.xyz,.txt';
          input.onchange = (e) => handleFileAdd((e.target as HTMLInputElement).files);
          input.click();
        }}
      >
        <div className="drop-icon">&#9651;</div>
        <p>Drop surface files here or click to browse</p>
        <p className="formats">.00t &middot; .obj &middot; .csv &middot; .xyz</p>
      </div>

      {entries.length > 0 && (
        <div className="file-list">
          {entries.map((entry, i) => (
            <div key={i} className="file-entry">
              <div className="file-info">
                <span className="file-name">{entry.name}</span>
                <select
                  value={entry.role}
                  onChange={(e) => handleRoleChange(i, e.target.value as SurfaceRole)}
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <button className="remove-btn" onClick={() => handleRemove(i)} title="Remove">
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {entries.length > 0 && (
        <div className="upload-actions">
          {!hasRequired && (
            <p className="warning">
              Required: Pre-Mining, Planned EOP, and Actual EOP surfaces
            </p>
          )}
          <button
            className="btn-primary"
            disabled={!hasRequired || isProcessing}
            onClick={() => onFilesReady(entries)}
          >
            {isProcessing ? 'Processing...' : 'Run Compliance Analysis'}
          </button>
        </div>
      )}

      <div className="role-guide">
        <h4>Surface Role Guide</h4>
        <div className="role-list">
          {ROLE_OPTIONS.map((opt) => (
            <div key={opt.value} className="role-item">
              <span className={`role-label ${opt.required ? 'required' : ''}`}>
                {opt.label}
                {opt.required && <span className="req-badge">Required</span>}
              </span>
              <span className="role-desc">{opt.description}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
