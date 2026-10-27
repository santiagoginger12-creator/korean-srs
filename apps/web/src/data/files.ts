// Browser file helpers. In a normal browser: a temporary object URL + <a download>.
// On a claude.ai page (isArtifact): the viewer's `downloads` capability, which asks them
// to confirm the save. Resolves true when the file was handed over, false when the viewer
// declined; rejects with a readable Error when saving isn't possible in this view.
import { hostDownloads, isArtifact } from '../host.ts';

export async function downloadBlob(blob: Blob, filename: string): Promise<boolean> {
  if (isArtifact) {
    const dl = await hostDownloads();
    if (!dl) throw new Error('Saving files is not available in this view.');
    try {
      await dl.save({ filename, data: blob });
      return true;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') return false;
      if (code === 'rate_limited') throw new Error('A save prompt is already open. Finish it, then try again.');
      throw new Error((e as { message?: string }).message || 'Saving failed.');
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}

export const downloadText = (text: string, filename: string, type = 'text/plain'): Promise<boolean> =>
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename).catch((e: unknown) => {
    console.warn(e);
    return false;
  });
