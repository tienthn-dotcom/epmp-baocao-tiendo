/**
 * TỰ CHẤM TUÂN THỦ MỖI NGÀY — PHẦN CHẠY THẬT (gom bằng chứng, ghi vào file nguồn).
 *
 * Luật nằm ở `cham-bcn.ts` (module thuần, có bộ kiểm). Đây chỉ là đường dây: hỏi Drive, hỏi nhật
 * ký, đọc bảng, ghi bảng. Tách vậy để sửa luật thì sửa một chỗ có test, còn chỗ này chỉ nối dây.
 *
 * AI GỌI: worker phụ (warmer) gọi lúc 18:00 và 20:00 giờ VN qua cửa máy `/may/cham-bcn` trong
 * auth-gate.ts. Không nằm luôn trong warmer vì gói free chỉ cho 50 lượt gọi mạng mỗi lần chạy, mà
 * lượt 18:00/20:00 của warmer đã tiêu gần hết; gọi sang app là app có ngân sách riêng của nó.
 *
 * NGÂN SÁCH LƯỢT GỌI của một lượt chấm: 1 token + ~24 lượt hỏi Drive + 1 D1 + 2-4 lượt Sheets
 * ≈ 30. Còn chỗ thở, nhưng thêm nguồn bằng chứng thì phải đếm lại.
 *
 * KHÔNG GHI GÌ KHI `thu` = true. Đây là cách xem trước robot sẽ làm gì trên file THẬT mà không
 * đụng vào file — dùng nó trước mỗi lần đổi luật.
 */
import { driveFileMetaImpl, driveTokenImpl } from "@/lib/drive.functions";
import {
  doKhung, lenKeHoach, lenKeHoachSangThang, lucVn, tachMaCT, tenTabLuu, thangCua, thanhRange,
  xetThang, type BangChung, type KeHoach,
} from "@/lib/cham-bcn";
import { BCN_FILE_ID, BCN_GID_BANG_CHAM } from "@/lib/bcn-tai";
import { khoaDuAn } from "@/lib/cham-theo-pdf";

/* ── AI KHÔNG TÍNH ───────────────────────────────────────────────────────────
   Token Drive của app CHÍNH LÀ tài khoản này, và chủ tài khoản mở file nguồn mỗi ngày để rà
   soát. Không loại ra thì mỗi lần anh rà là cả bảng tự tick. */
const KHONG_TINH = new Set(["tienthn@aacorporation.com"]);

const KV_SO = "cham:bcn:log:v1";          // sổ 30 lượt chạy gần nhất, để soi khi bảng ra lạ
const SO_LUOT_GIU = 30;
const SONG_SONG = 6;                      // hỏi Drive theo lô, y như warmer
const VN_MS = 7 * 3_600_000;

type Env = Record<string, unknown>;
type KvNhe = { get(k: string): Promise<string | null>; put(k: string, v: string): Promise<void> };
type D1Nhe = { prepare(q: string): { bind(...a: unknown[]): { all<T>(): Promise<{ results?: T[] }> } } };

async function getEnv(): Promise<Env | null> {
  try {
    const mod = (await import("@tanstack/react-start/server")) as Record<string, unknown>;
    const ev = (mod.getEvent as undefined | (() => unknown))?.() as
      { context?: { cloudflare?: { env?: Env } } } | undefined;
    const cf = ev?.context?.cloudflare?.env;
    if (cf) return cf;
  } catch { /* runtime khác */ }
  const g = globalThis as unknown as Record<string, unknown>;
  return ((g.__env__ as Env) ?? g) ?? null;
}

/** Ngày + phút theo giờ VN của lúc này. */
export function bayGioVn(now = Date.now()): { ngay: string; phut: number } {
  const d = new Date(now + VN_MS);
  return { ngay: d.toISOString().slice(0, 10), phut: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/* ── BẰNG CHỨNG 1: FILE MA TRẬN ĐƯỢC SỬA ───────────────────────────────────── */

type MucLapDat = { maCT?: string; fileId?: string; name?: string };

/** maCT → các fileId ma trận của nó (một dự án có thể nằm trong nhiều file, và ngược lại). */
export function fileTheoMa(ds: readonly MucLapDat[]): Map<string, Set<string>> {
  const ra = new Map<string, Set<string>>();
  for (const p of ds) {
    if (!p.fileId) continue;
    for (const m of tachMaCT(p.maCT)) {
      const s = ra.get(m) ?? new Set<string>();
      s.add(p.fileId);
      ra.set(m, s);
    }
  }
  return ra;
}

/* ── CHẠY MỘT LƯỢT ─────────────────────────────────────────────────────────── */

export type KetQuaCham = {
  ok: boolean;
  ngay: string;
  luc: string;
  chot: boolean;
  thu: boolean;
  /** Vì sao không làm gì (nếu có). */
  dung?: string;
  thangBang?: string;
  sangThang?: { tuThang: string; tabLuu: string } | null;
  ghi: { diaChi: string; giaTri: string; duAn: string }[];
  boQua: KeHoach["boQua"];
  bangChung: { maCT: string; phut: number; nguon: string; ai: string }[];
  khongDoDuoc: string[];
};

export async function chayChamBcn(opts: { chot: boolean; thu: boolean; now?: number }): Promise<KetQuaCham> {
  const { chot, thu } = opts;
  const now = opts.now ?? Date.now();
  const { ngay } = bayGioVn(now);
  const kq: KetQuaCham = {
    ok: false, ngay, luc: new Date(now).toISOString(), chot, thu,
    ghi: [], boQua: [], bangChung: [], khongDoDuoc: [], sangThang: null,
  };

  const env = await getEnv();
  const kv = env?.PMO_EDITS as KvNhe | undefined;
  const token = await driveTokenImpl();
  if (!token) { kq.dung = "chưa cấu hình GDRIVE_OAUTH_* nên không vào được Drive"; return kq; }

  /* 1. DANH SÁCH MA TRẬN — nguồn của bằng chứng "file nguồn bị sửa". */
  let ds: MucLapDat[] = [];
  try { ds = JSON.parse((await kv?.get("mtld:install:list:v2")) || "[]") as MucLapDat[]; } catch { ds = []; }
  /* CHẠY Ở MÁY thì không có KV → đọc tệp dev, y như mtld-install.functions.ts. Thiếu nhánh này là
     ở máy không bao giờ thử được vòng khép kín "sửa file nguồn → thấy dấu", mà đó đúng là thứ
     phải xem tận mắt TRƯỚC khi cho robot ghi vào file thật của phòng OCC. */
  if (!ds.length) ds = await docDanhSachDev();
  const theoFile = fileTheoMa(ds);

  /* 2. HỎI DRIVE từng file một lần (nhiều dự án chung một file thì chỉ hỏi một lượt). */
  const maCuaFile = new Map<string, string[]>();
  for (const [ma, fs] of theoFile) for (const f of fs) maCuaFile.set(f, [...(maCuaFile.get(f) ?? []), ma]);
  const files = [...maCuaFile.keys()];
  const theoMa = new Map<string, BangChung[]>();
  const them = (ma: string, b: BangChung) => theoMa.set(ma, [...(theoMa.get(ma) ?? []), b]);

  for (let i = 0; i < files.length; i += SONG_SONG) {
    await Promise.all(files.slice(i, i + SONG_SONG).map(async (id) => {
      const m = await driveFileMetaImpl(id);
      if (!m) return;
      const v = lucVn(m.modifiedTime);
      if (!v || v.ngay !== ngay) return;                       // không phải sửa hôm nay
      if (KHONG_TINH.has(m.email)) return;                     // anh Tiến rà soát, không tính
      for (const ma of maCuaFile.get(id) ?? []) them(ma, { phut: v.phut, nguon: "file", ai: m.nguoiSua || m.email });
    }));
  }

  /* 3. HỎI NHẬT KÝ: lượt xuất PDF dự án trong ngày. Nới khoảng lấy mỗi đầu một ngày vì nhật ký
     ghi UTC còn ngày chấm tính theo giờ VN (xem cham-pdf.functions.ts). */
  const d1 = env?.PMO_LOG as D1Nhe | undefined;
  if (d1) {
    const tu = new Date(Date.parse(`${ngay}T00:00:00Z`) - 86_400_000).toISOString();
    const den = new Date(Date.parse(`${ngay}T00:00:00Z`) + 2 * 86_400_000).toISOString();
    try {
      const rows = (await d1
        .prepare("SELECT ts, email, detail FROM access_log WHERE action = ? AND ts >= ? AND ts < ?")
        .bind("export_pdf_duan", tu, den)
        .all<{ ts: string; email: string; detail: string | null }>()).results ?? [];
      for (const r of rows) {
        const v = lucVn(r.ts);
        const ma = khoaDuAn(r.detail);
        if (!v || v.ngay !== ngay || !ma) continue;
        if (KHONG_TINH.has((r.email || "").toLowerCase())) continue;
        them(ma, { phut: v.phut, nguon: "pdf", ai: r.email });
      }
    } catch { /* bảng chưa có → coi như chưa có lượt nào */ }
  }
  for (const [ma, bs] of theoMa) for (const b of bs) kq.bangChung.push({ maCT: ma, ...b });
  kq.bangChung.sort((a, b) => a.phut - b.phut);

  /* 4. ĐỌC BẢNG. Lấy tab theo gid chứ không theo tên — đổi tên tab là chuyện người ta làm. */
  const sheets = taoSheets(token);
  const tab = await tenTabTheoGid(sheets, BCN_FILE_ID, BCN_GID_BANG_CHAM);
  if (!tab) { kq.dung = "không tìm thấy tab bảng chấm trong file nguồn"; return kq; }
  let grid = await docLuoi(sheets, BCN_FILE_ID, tab);
  let khung = doKhung(grid);
  if (!khung) { kq.dung = "không nhận ra khung bảng chấm (file đổi bố cục?)"; return kq; }
  kq.thangBang = khung.thangLabel;

  /* 5. THÁNG. Bảng chỉ giữ MỘT tháng; sang tháng thì chụp tháng cũ sang tab riêng rồi dọn. */
  const xet = xetThang(khung, ngay);
  if (xet === null) { kq.dung = "không đọc được nhãn tháng trên vùng ngày — đứng im cho chắc"; return kq; }
  if (xet === "la") { kq.dung = `bảng đang ở tháng ${khung.thangLabel}, sau tháng hiện tại — có người sửa tay, robot đứng im`; return kq; }
  if (xet === "cu") {
    kq.sangThang = { tuThang: khung.thangLabel, tabLuu: tenTabLuu(khung.thangLabel) };
    /* XEM TRƯỚC thì DỪNG Ở ĐÂY. Lượt chạy thật sẽ dọn bảng rồi mới chấm; còn xem trước mà cứ chấm
       tiếp trên lưới THÁNG CŨ thì mấy ô nó khoe sẽ là ô của tháng trước — xem trước kiểu đó còn
       hại hơn không xem. */
    if (thu) {
      kq.ok = true;
      kq.dung = `bảng đang ở tháng ${khung.thangLabel}; lượt chạy thật sẽ lưu sang tab "${tenTabLuu(khung.thangLabel)}" rồi dọn sang ${thangCua(ngay)}`;
      return kq;
    }
    {
      await sangThangMoi(sheets, tab, khung, ngay);
      grid = await docLuoi(sheets, BCN_FILE_ID, tab);
      const lai = doKhung(grid);
      if (!lai) { kq.dung = "dọn bảng xong nhưng đọc lại không ra khung — dừng, không ghi tiếp"; return kq; }
      khung = lai;
      kq.thangBang = khung.thangLabel;
    }
  }

  /* 6. LÊN KẾ HOẠCH rồi ghi. */
  const khongDo = new Set<string>();
  for (const d of khung.dong) for (const m of d.ma) if (!theoFile.has(m)) khongDo.add(m);
  kq.khongDoDuoc = [...khongDo].sort();

  const kh = lenKeHoach({ khung, grid, theoMa, ngay, chot, khongDoDuoc: khongDo });
  kq.boQua = kh.boQua;
  const tenDong = new Map(khung.dong.map((d) => [d.r, d.ten || d.ma.join(", ")]));
  kq.ghi = kh.o.map((o) => ({ diaChi: `${tab}!${o.r + 1}/${o.c + 1}`, giaTri: o.giaTri, duAn: tenDong.get(o.r) ?? "" }));

  if (kh.o.length && !thu) await ghiO(sheets, BCN_FILE_ID, tab, kh.o);
  kq.ok = true;

  /* 7. SỔ CHẠY — để lần sau bảng ra số lạ thì có chỗ soi, khỏi phải đoán. */
  if (kv && !thu) {
    try {
      const cu = JSON.parse((await kv.get(KV_SO)) || "[]") as unknown[];
      const gon = { luc: kq.luc, ngay, chot, soGhi: kq.ghi.length, thang: kq.thangBang, sangThang: kq.sangThang, bangChung: kq.bangChung.length };
      await kv.put(KV_SO, JSON.stringify([gon, ...cu].slice(0, SO_LUOT_GIU)));
    } catch { /* sổ hỏng thì thôi, không vì thế mà hỏng lượt chấm */ }
  }
  return kq;
}

/* ── SHEETS API ────────────────────────────────────────────────────────────── */

function taoSheets(token: string) {
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const goc = "https://sheets.googleapis.com/v4/spreadsheets";
  return {
    async get(id: string, q: string) {
      const r = await fetch(`${goc}/${id}?${q}`, { headers: H });
      if (!r.ok) throw new Error(`Sheets GET ${r.status}`);
      return r.json() as Promise<Record<string, unknown>>;
    },
    async values(id: string, range: string) {
      const r = await fetch(`${goc}/${id}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`, { headers: H });
      if (!r.ok) throw new Error(`Sheets values ${r.status}`);
      return r.json() as Promise<{ values?: unknown[][] }>;
    },
    async post(id: string, duoi: string, body: unknown) {
      const r = await fetch(`${goc}/${id}${duoi}`, { method: "POST", headers: H, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`Sheets POST ${duoi} ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return r.json() as Promise<Record<string, unknown>>;
    },
  };
}
type Sheets = ReturnType<typeof taoSheets>;

async function tenTabTheoGid(sheets: Sheets, id: string, gid: string): Promise<string | null> {
  const j = await sheets.get(id, "fields=sheets.properties(sheetId,title)");
  const ds = (j.sheets ?? []) as { properties?: { sheetId?: number; title?: string } }[];
  return ds.find((s) => String(s.properties?.sheetId ?? "") === String(gid))?.properties?.title ?? null;
}

const docLuoi = async (sheets: Sheets, id: string, tab: string): Promise<unknown[][]> =>
  ((await sheets.values(id, `'${tab.replace(/'/g, "''")}'`)).values ?? []) as unknown[][];

const ghiO = (sheets: Sheets, id: string, tab: string, o: Parameters<typeof thanhRange>[1]) =>
  sheets.post(id, "/values:batchUpdate", { valueInputOption: "USER_ENTERED", data: thanhRange(tab, o) });

/**
 * DỌN BẢNG SANG THÁNG MỚI — chụp tháng cũ trước, xoá sau. Thứ tự này không đảo được: file chỉ giữ
 * một tháng, xoá trước mà bước chụp hỏng là mất trắng.
 */
async function sangThangMoi(sheets: Sheets, tab: string, khung: ReturnType<typeof doKhung> & object, ngay: string) {
  const cu = khung.thangLabel;
  const j = await sheets.get(BCN_FILE_ID, "fields=sheets.properties(sheetId,title)");
  const ds = (j.sheets ?? []) as { properties?: { sheetId?: number; title?: string } }[];
  const sheetId = ds.find((s) => s.properties?.title === tab)?.properties?.sheetId;
  if (sheetId == null) throw new Error("không tìm thấy sheetId của tab bảng chấm");

  const ban = await sheets.post(BCN_FILE_ID, `/sheets/${sheetId}:copyTo`, { destinationSpreadsheetId: BCN_FILE_ID });
  const idBan = (ban as { sheetId?: number }).sheetId;
  const tenBan = tenTabLuu(cu);
  if (idBan != null) {
    await sheets.post(BCN_FILE_ID, ":batchUpdate", {
      requests: [{ updateSheetProperties: { properties: { sheetId: idBan, title: tenBan, hidden: true }, fields: "title,hidden" } }],
    });
    /* Ô tiêu đề của file là công thức neo TODAY() nên bản lưu sẽ hiện tháng HIỆN TẠI chứ không
       phải tháng nó đang giữ. Đè lại bằng chữ chết cho khỏi đọc nhầm kỳ. */
    await sheets.post(BCN_FILE_ID, "/values:batchUpdate", {
      valueInputOption: "RAW",
      data: [{ range: `'${tenBan}'!A1`, values: [[`ĐÁNH GIÁ TUÂN THỦ BÁO CÁO HẰNG NGÀY - THÁNG ${cu}`]] }],
    });
  }

  const kh = lenKeHoachSangThang(khung, ngay);
  if (kh.xoa) {
    const { r1, c1, r2, c2 } = kh.xoa;
    const { chuCot } = await import("@/lib/cham-bcn");
    await sheets.post(BCN_FILE_ID, `/values/${encodeURIComponent(`'${tab}'!${chuCot(c1)}${r1 + 1}:${chuCot(c2)}${r2 + 1}`)}:clear`, {});
  }
  if (kh.o.length) await ghiO(sheets, BCN_FILE_ID, tab, kh.o);
}

export { thangCua };

/** Danh sách ma trận khi chạy ở máy (không có KV). Đường dẫn khớp bản chụp .data của app. */
async function docDanhSachDev(): Promise<MucLapDat[]> {
  try {
    const fs = await import("node:fs/promises");
    return JSON.parse(await fs.readFile(".data/pmo-install-list.json", "utf8")) as MucLapDat[];
  } catch { return []; }
}
