/**
 * DỰNG LẠI LỊCH SỬ LẮP ĐẶT TỪ CÁC BẢN LƯU CŨ CỦA CHÍNH FILE MA TRẬN.
 *
 * Google Drive giữ lại từng lần file bị sửa. Mỗi bản lưu là ảnh chụp ma trận tại thời điểm đó —
 * tải về, đọc bằng đúng reader của app, là ra được "ngày ấy mỗi khu bao nhiêu phần trăm, mấy căn
 * đã xong". Nhờ vậy kho lịch sử không phải bắt đầu từ hôm nay mà có sẵn quá khứ.
 *
 * Chạy ở MÁY chứ không ở worker: mở .xlsx vài MB trên Cloudflare là dính Error 1102, còn ở máy thì
 * thoải mái. Đây là việc chạy MỘT LẦN cho mỗi dự án; từ đó về sau app tự chấm thêm mỗi ngày.
 *
 * Cách chạy:
 *   npx esbuild scripts/mtld-lichsu-backfill.ts --bundle --platform=node --format=cjs --outfile=<tmp>.cjs
 *   node <tmp>.cjs                     ← đọc .env để lấy quyền Drive
 * Biến môi trường tuỳ chọn:
 *   MTLD_FILE=<fileId>  MTLD_MACT=CT25-038  MTLD_DUAN="Mini Hotel PQ"   (thiếu thì chạy DANH SÁCH dưới)
 *   MTLD_GHI=1                                                          (mặc định chỉ xem trước, không ghi Drive)
 */
import * as fs from "node:fs";
import { parseMatrixWorkbook } from "../src/lib/matrix-reader";
import { meltToLongTable } from "../src/lib/mtld-longtable";
import { dungMocNgay, gopMoc, sangCsv, docCsv, tenFileLichSu, luyKeTheoNgay, type MocNgay } from "../src/lib/mtld-history";

/** Dự án đã gắn ma trận — lấy từ .data/pmo-sheetview.json của bản dev, hoặc khai thẳng ở đây. */
const MAC_DINH = [
  { fileId: "1le0CS6IxjGd5f3IsWpYKj_UOVCjNolgB", maCT: "CT25-038", duAn: "Mini Hotel PQ (B1-B5)" },
  { fileId: "1VeNo_Se_BX2GLlAk4o6rgjIEWnrfv2wG89ehazKmgUE", maCT: "CT25-070", duAn: "Nam Phương Hoàng Hậu Public" },
];

const env = (() => {
  const o: Record<string, string> = { ...process.env } as Record<string, string>;
  try {
    for (const d of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
      const m = d.match(/^([A-Z_]+)=(.*)$/);
      if (m) o[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch { /* không có .env thì dùng biến môi trường sẵn có */ }
  return o;
})();

async function token(): Promise<string> {
  const b = new URLSearchParams({
    client_id: env.GDRIVE_OAUTH_CLIENT_ID, client_secret: env.GDRIVE_OAUTH_CLIENT_SECRET,
    refresh_token: env.GDRIVE_OAUTH_REFRESH, grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: b });
  const j = await r.json() as { access_token?: string };
  if (!j.access_token) throw new Error("Không lấy được quyền Drive — kiểm tra GDRIVE_OAUTH_* trong .env");
  return j.access_token;
}
const H = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Các bản lưu của một file, cũ → mới. `exportLinks` chỉ có ở file Google Sheet gốc. */
type BanLuu = { id: string; modifiedTime: string; size?: string; exportLinks?: Record<string, string> };
async function danhSachBanLuu(t: string, fileId: string): Promise<BanLuu[]> {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/revisions?fields=revisions(id,modifiedTime,size,exportLinks)&pageSize=200&supportsAllDrives=true`, { headers: H(t) });
  const j = await r.json() as { revisions?: BanLuu[] };
  return (j.revisions ?? []).sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime));
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Tải nội dung một bản lưu.
 *  · File Google Sheet GỐC: phải đi qua `exportLinks` (alt=media trả 404) — đổi sang .xlsx rồi đọc.
 *  · File .xlsx tải lên: đọc thẳng alt=media, nhưng Drive dọn nội dung bản cũ sau một thời gian
 *    (trả 403) nên chỉ còn vài bản gần đây. Không có cách lấy lại phần đã bị dọn. */
const nghi = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function taiBanLuu(t: string, fileId: string, rev: BanLuu): Promise<ArrayBuffer> {
  const link = rev.exportLinks?.[XLSX_MIME];
  const url = link || `https://www.googleapis.com/drive/v3/files/${fileId}/revisions/${rev.id}?alt=media&supportsAllDrives=true`;
  // Google chặn khi xuất liên tiếp (429). Nghỉ rồi thử lại, lâu dần — chạy một lần nên chờ được.
  for (let lan = 0; lan < 4; lan++) {
    const r = await fetch(url, { headers: H(t) });
    if (r.ok) return r.arrayBuffer();
    if (r.status !== 429 && r.status !== 403) throw new Error(link ? `xuất bản lưu lỗi ${r.status}` : `bản lưu không còn nội dung (${r.status})`);
    if (r.status === 403 && !link) throw new Error("bản lưu không còn nội dung (403)");
    await nghi(4000 * (lan + 1));
  }
  throw new Error("Google chặn vì gọi quá nhiều (429) — chạy lại sau ít phút");
}

/** Tìm-hoặc-tạo chuỗi thư mục dưới "Data Source". */
async function ensureFolder(t: string, ten: string, cha: string): Promise<string> {
  const q = `name='${ten.replace(/'/g, "\\'")}' and '${cha}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: H(t) });
  const j = await r.json() as { files?: { id: string }[] };
  if (j.files?.[0]) return j.files[0].id;
  const c = await fetch("https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true", {
    method: "POST", headers: { ...H(t), "Content-Type": "application/json" },
    body: JSON.stringify({ name: ten, mimeType: "application/vnd.google-apps.folder", parents: [cha] }),
  });
  const cj = await c.json() as { id?: string };
  if (!cj.id) throw new Error(`không tạo được thư mục ${ten}`);
  return cj.id;
}

async function ghiCsv(t: string, folder: string, ten: string, noiDung: string) {
  const q = `name='${ten}' and '${folder}' in parents and trashed=false`;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true`, { headers: H(t) });
  const j = await r.json() as { files?: { id: string }[] };
  const id = j.files?.[0]?.id;
  const body = new TextEncoder().encode(noiDung);
  if (id) {
    const u = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&supportsAllDrives=true`, {
      method: "PATCH", headers: { ...H(t), "Content-Type": "text/csv" }, body,
    });
    if (!u.ok) throw new Error(`ghi đè CSV lỗi ${u.status}`);
    return id;
  }
  const boundary = "bf" + Date.now();
  const meta = JSON.stringify({ name: ten, parents: [folder] });
  const pre = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: text/csv\r\n\r\n`);
  const post = new TextEncoder().encode(`\r\n--${boundary}--`);
  const all = new Uint8Array(pre.length + body.length + post.length);
  all.set(pre, 0); all.set(body, pre.length); all.set(post, pre.length + body.length);
  const u = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true", {
    method: "POST", headers: { ...H(t), "Content-Type": `multipart/related; boundary=${boundary}` }, body: all,
  });
  const uj = await u.json() as { id?: string };
  if (!uj.id) throw new Error("không tạo được CSV");
  return uj.id;
}

async function chay() {
  const t = await token();
  const ds = env.MTLD_FILE
    ? [{ fileId: env.MTLD_FILE, maCT: env.MTLD_MACT || "", duAn: env.MTLD_DUAN || "" }]
    : MAC_DINH;
  const ghi = env.MTLD_GHI === "1";

  for (const p of ds) {
    console.log("\n" + "=".repeat(74));
    console.log(`DỰ ÁN: ${p.duAn} (${p.maCT})`);
    const revs = await danhSachBanLuu(t, p.fileId);
    console.log(`  bản lưu Drive giữ được: ${revs.length}` + (revs.length ? ` · từ ${revs[0].modifiedTime.slice(0, 10)} tới ${revs[revs.length - 1].modifiedTime.slice(0, 10)}` : ""));
    // Một ngày người ta bấm lưu chục lần; chỉ cần BẢN CUỐI trong ngày, coi như số chốt ngày hôm đó.
    const cuoiNgay = new Map<string, typeof revs[number]>();
    for (const r of revs) cuoiNgay.set(r.modifiedTime.slice(0, 10), r);
    const revsNgay = [...cuoiNgay.values()];
    console.log(`  sau khi gom theo ngày: ${revsNgay.length} mốc`);
    let kho: MocNgay[] = [];
    for (const rev of revsNgay) {
      const ngay = rev.modifiedTime.slice(0, 10);
      try {
        const buf = await taiBanLuu(t, p.fileId, rev);
        const sheets = parseMatrixWorkbook(buf);
        if (!sheets.length) { console.log(`  ${ngay}  — không thấy sheet ma trận, bỏ qua`); continue; }
        const rows = meltToLongTable(sheets, p.duAn);
        const moc = dungMocNgay(rows, { ngay, maCT: p.maCT, duAn: p.duAn, sheet: sheets.map((s) => s.sheet).join("+") });
        kho = gopMoc(kho, moc);
        const tong = moc.reduce((n, m) => n + m.canTong, 0);
        const xong = moc.reduce((n, m) => n + m.canXong, 0);
        console.log(`  ${ngay}  ${String(moc.length).padStart(2)} khu · căn xong ${String(xong).padStart(4)}/${tong}`);
        await nghi(1500);   // giãn nhịp cho Google khỏi chặn
      } catch (e) {
        console.log(`  ${ngay}  — lỗi: ${(e as Error).message}`);
      }
    }
    if (!kho.length) { console.log("  → không dựng được mốc nào"); continue; }

    const lk = luyKeTheoNgay(kho);
    console.log("  LUỸ KẾ THEO NGÀY:");
    for (const d of lk) console.log(`     ${d.ngay}  ${String(d.canXong).padStart(4)}/${d.canTong} căn  ·  ${d.pct == null ? "—" : d.pct + "%"}`);

    if (!ghi) { console.log("  (xem trước — thêm MTLD_GHI=1 để ghi lên Drive)"); continue; }
    let folder = env.GDRIVE_ROOT || "1O9VktCpBENaZB1xgABr8MfIbl3YW8hFO";
    for (const seg of ["DATABASE", "ePMP", "MTLĐ", "Lịch sử"]) folder = await ensureFolder(t, seg, folder);
    const ten = tenFileLichSu(p.maCT, p.duAn);
    // Có file cũ thì gộp vào, không đè mất phần đã chấm trước đó.
    const cu = await (async () => {
      const q = `name='${ten}' and '${folder}' in parents and trashed=false`;
      const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true`, { headers: H(t) });
      const j = await r.json() as { files?: { id: string }[] };
      if (!j.files?.[0]) return [] as MocNgay[];
      const g = await fetch(`https://www.googleapis.com/drive/v3/files/${j.files[0].id}?alt=media&supportsAllDrives=true`, { headers: H(t) });
      return g.ok ? docCsv(await g.text()) : [];
    })();
    await ghiCsv(t, folder, ten, sangCsv(gopMoc(cu, kho)));
    console.log(`  → đã ghi: DATABASE › ePMP › MTLĐ › Lịch sử › ${ten} (${gopMoc(cu, kho).length} dòng)`);
  }
}

chay().catch((e) => { console.error("LỖI:", e); process.exit(1); });
