/**
 * CỬA ĐỌC CHO AGENT — phần CHẠY TRONG WORKER. Luật nằm ở `api-bao-cao.ts` (có bộ kiểm riêng).
 *
 * Nguyên tắc của tệp này: CHỈ ĐỌC, và đọc thứ RẺ. Worker gói Free có 2 giây CPU mỗi lượt, nên
 * không parse xlsx ở đây (đo 20/10/2026: riêng XLSX.read đã 1.027 ms). Năm phần dữ liệu lấy từ:
 *
 *   duan · canh-bao   KV `etl:v1:epmp`  — bản chụp do client đẩy lên, xem luuAnhChupEpmp
 *   san-luong         KV `perf:data`    — bản lưu file Sản lượng đầu người
 *   van-hanh          KV danh sách MTLĐ + bảng Tracking trong mã nguồn
 *   tuan-thu          CSV trên Google Sheet (1 lượt gọi mạng, parse CSV rẻ)
 *
 * MỖI CÂU TRẢ LỜI ĐỀU KÈM `luc` — lúc số được chụp, KHÔNG phải lúc gọi. Agent phải nói ra con số
 * đó khi báo cáo; thiếu nó thì người đọc tưởng là số thời gian thực.
 */
import type { AuthEnv } from "./auth";
import {
  demCanhBao, demTheo, locDong, tomTatTheoDuAn,
  type AnhChupEpmp, type BoLocApi, type DongEpmp,
} from "./api-bao-cao";

const COMPLIANCE_CSV =
  "https://docs.google.com/spreadsheets/d/15pcqb0ExFQ5uF9CuKSx6O6y9GN4kfiNf6IARN98pJbA/export?format=csv&gid=490936703";

type KvLike = { get(k: string): Promise<string | null> };
const kvCua = (env: AuthEnv): KvLike | null =>
  (env.PMO_EDITS as unknown as KvLike) ?? null;

/* Chạy ở MÁY thì không có KV — các hàm server khác trong app đều lùi về đọc tệp trong .data/,
   làm y vậy để thử cửa trên máy cũng ra số thật chứ không phải "chưa có dữ liệu" giả. */
const TEP_DEV: Record<string, string> = {
  "etl:v1:epmp": ".data/etl/epmp.json",
  "perfdata:v1": ".data/pmo-perfdata.json",
  "mtld:install:list:v2": ".data/pmo-install-list.json",
};

async function docJson<T>(env: AuthEnv, khoa: string): Promise<T | null> {
  const kv = kvCua(env);
  let raw: string | null = null;
  if (kv) raw = await kv.get(khoa);
  else {
    const tep = TEP_DEV[khoa];
    if (!tep) return null;
    try { const fs = await import("node:fs/promises"); raw = await fs.readFile(tep, "utf8"); }
    catch { return null; }
  }
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

/** Bản chụp ePMP. Chưa có = chưa ai mở app kể từ khi tính năng lên. */
const docAnhChup = (env: AuthEnv) => docJson<AnhChupEpmp>(env, "etl:v1:epmp");

const chuaCoAnh = {
  ok: false as const,
  loi: "Chưa có bản chụp dữ liệu ePMP trong kho.",
  cachSua: "Nhờ một người mở app ePMP một lần — client tự đẩy bản chụp lên. Sau đó gọi lại.",
};

function locTuUrl(url: URL): BoLocApi {
  const l = (k: string) => url.searchParams.get(k) || undefined;
  return {
    vung: l("vung"), pm: l("pm"), maCT: l("maCT"), hangMuc: l("hangMuc"),
    canhBao: (l("canhBao") as BoLocApi["canhBao"]) || undefined,
    chiTre: url.searchParams.get("chiTre") === "1",
  };
}

/* ── TỪNG PHẦN ─────────────────────────────────────────────────────────────────────────────── */

async function phanDuAn(url: URL, env: AuthEnv) {
  const anh = await docAnhChup(env);
  if (!anh) return chuaCoAnh;
  const dong = locDong(anh.dong, locTuUrl(url));
  /* `gon=1` chỉ trả phần gom theo dự án — agent làm báo cáo cấp quản lý thì không cần 600 dòng. */
  const gon = url.searchParams.get("gon") === "1";
  return {
    ok: true as const, luc: anh.luc, nguon: anh.nguon,
    soDong: dong.length,
    duAn: tomTatTheoDuAn(dong),
    ...(gon ? {} : { dong }),
    locDuoc: { vung: demTheo(anh.dong, "vung"), pm: demTheo(anh.dong, "pm"), hangMuc: demTheo(anh.dong, "hangMuc") },
  };
}

async function phanCanhBao(url: URL, env: AuthEnv) {
  const anh = await docAnhChup(env);
  if (!anh) return chuaCoAnh;
  const dong = locDong(anh.dong, locTuUrl(url));
  const nhom = demCanhBao(dong);
  return {
    ok: true as const, luc: anh.luc, nguon: anh.nguon,
    nhom,
    /* Kèm chính các dòng của từng nhóm — agent cần gọi tên dự án chứ không chỉ đếm số. */
    chiTiet: Object.fromEntries(nhom.map((n) => [n.ma, dong.filter((d) => d.canhBao === n.ma)])),
  };
}

async function phanSanLuong(env: AuthEnv) {
  const d = await docJson<{ projects?: unknown[]; block?: unknown; at?: number; src?: string }>(env, "perfdata:v1");
  if (!d) return { ok: false as const, loi: "Chưa có bản lưu Sản lượng đầu người." };
  return {
    ok: true as const,
    luc: d.at ? new Date(d.at).toISOString() : null,
    nguon: d.src ?? "",
    donVi: { sanLuong: "đồng", nhanSu: "người", dauNguoi: "sản lượng ÷ nhân sự" },
    duAn: d.projects ?? [],
    toanKhoi: d.block ?? null,
  };
}

async function phanVanHanh(env: AuthEnv) {
  const list = await docJson<{ name: string; maCT: string; region?: string; groupDA?: string }[]>(env, "mtld:install:list:v2");
  const { docTracking, traVH } = await import("./tracking-vanhanh");
  const { TRACKING_TSV, NGAY_CHUP } = await import("./tracking-vanhanh-data");
  const bang = docTracking(TRACKING_TSV);
  return {
    ok: true as const,
    luc: NGAY_CHUP,
    nguon: "Sheet Tracking tiến độ vận hành ma trận TCLĐ (PMO chấm tay)",
    /* Trả CẢ bảng tracking, không chỉ phần khớp danh sách ma trận: bảng gốc có 83 dự án, danh
       sách ma trận ít hơn, mà agent có thể cần cả những dự án chưa gắn ma trận. */
    tatCa: bang.dong,
    theoMaTran: (list ?? []).map((p) => {
      const r = traVH(bang, p.name);
      return { maCT: p.maCT, duAn: p.name, vung: p.region ?? "", cum: p.groupDA ?? "", trangThai: r?.tt ?? "chuaRo", ghiChu: r?.ghiChu ?? "" };
    }),
  };
}

async function phanTuanThu(url: URL) {
  const r = await fetch(COMPLIANCE_CSV, { redirect: "follow", cache: "no-store" });
  if (!r.ok) return { ok: false as const, loi: `Không tải được file tuân thủ (HTTP ${r.status}).` };
  const csv = await r.text();
  const { parseComplianceFile, pmAverages } = await import("./compliance-file");
  const thang = url.searchParams.get("thang") || undefined;   // "2026-10"
  const d = parseComplianceFile(csv, thang);
  return {
    ok: true as const,
    luc: new Date().toISOString(),
    nguon: "Google Sheet Đánh giá tuân thủ",
    thang: thang ?? "tháng hiện hành",
    cachCham: "100 − 25×(số ✕) − 10×(số o); dấu đọc thẳng từ file nguồn",
    duAn: d.rows,
    diemPm: [...pmAverages(d.rows).entries()].map(([pm, diem]) => ({ pm, diem })),
  };
}

/* ── ĐIỀU PHỐI ─────────────────────────────────────────────────────────────────────────────── */

const PHAN = ["duan", "canh-bao", "tuan-thu", "san-luong", "van-hanh"] as const;
type Phan = (typeof PHAN)[number];

export async function traPhan(url: URL, env: AuthEnv): Promise<unknown> {
  const xin = (url.searchParams.get("phan") || "").trim();

  /* Không ghi `phan` → trả BẢN ĐỒ cửa. Agent gọi phát đầu biết ngay có gì, lọc được gì, mà không
     phải đọc tài liệu rời — tài liệu rời thì sớm muộn cũng lệch với mã. */
  if (!xin) {
    return {
      ok: true,
      app: "ePMP · Project Master Plan · OCC",
      cua: "/may/bao-cao",
      cachGoi: "GET /may/bao-cao?phan=<tên phần>, kèm header x-epmp-agent: <token>",
      phan: {
        duan: "Dự án + đầu việc: % kế hoạch, % thực tế, số mã, mốc ngày, số ngày trễ, PM, vùng",
        "canh-bao": "Ba nhóm cảnh báo: trễ tiến độ · cần cắt đầu việc · cần tập trung",
        "tuan-thu": "Điểm tuân thủ báo cáo hằng ngày theo dự án và theo PM",
        "san-luong": "Sản lượng · nhân sự · doanh thu đầu người từng tháng",
        "van-hanh": "Tình trạng vận hành ma trận TCLĐ từng dự án",
      },
      boLoc: {
        "duan, canh-bao": ["vung", "pm", "maCT", "hangMuc", "canhBao", "chiTre=1", "gon=1"],
        "tuan-thu": ["thang=YYYY-MM"],
      },
      luuY: "Mọi câu trả lời có trường `luc` = lúc số được chụp, KHÔNG phải lúc gọi. Báo cáo phải nói rõ mốc này.",
    };
  }

  if (!(PHAN as readonly string[]).includes(xin)) {
    return { ok: false, loi: `Không có phần "${xin}".`, phanCo: PHAN };
  }
  switch (xin as Phan) {
    case "duan": return phanDuAn(url, env);
    case "canh-bao": return phanCanhBao(url, env);
    case "san-luong": return phanSanLuong(env);
    case "van-hanh": return phanVanHanh(env);
    case "tuan-thu": return phanTuanThu(url);
  }
}

export type { DongEpmp };
