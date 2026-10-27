// Browser file helpers (download via a temporary object URL).
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const downloadText = (text: string, filename: string, type = 'text/plain'): void =>
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename);
