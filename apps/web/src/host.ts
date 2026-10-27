// Where the app is running. The "artifact" target is a private claude.ai page: a sandboxed
// frame with no service worker and no plain <a download>, where files are offered to the
// viewer through the page's `downloads` capability instead (D59).
declare const __ARTIFACT__: boolean;

export const isArtifact: boolean = typeof __ARTIFACT__ !== 'undefined' && __ARTIFACT__;

interface DownloadsNs { save(req: { filename: string; data: Blob | string }): Promise<{ status: string }> }
interface ClaudeHost { use(name: string): Promise<unknown> }

let downloads: Promise<DownloadsNs | null> | null = null;

/** The viewer's save capability, or null when this view can't offer files. */
export function hostDownloads(): Promise<DownloadsNs | null> {
  if (!isArtifact) return Promise.resolve(null);
  if (!downloads) {
    const c = (window as unknown as { claude?: ClaudeHost }).claude;
    downloads = c?.use ? (c.use('downloads') as Promise<DownloadsNs | null>).catch(() => null) : Promise.resolve(null);
  }
  return downloads;
}
