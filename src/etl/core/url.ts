/** ETL core · url — tách fileId + gid từ URL Google Sheet (nguồn duy nhất thay ~4 bản rải rác). */
export function parseSheetUrl(url: string): { fileId: string; gid?: string } | null {
  const m = /\/d\/([A-Za-z0-9_-]{10,})/.exec(url || "");
  if (!m) return null;
  const gm = /[?#&]gid=(\d+)/.exec(url || "");
  return { fileId: m[1], gid: gm ? gm[1] : undefined };
}
