/* WARM MA TRẬN MỖI NGÀY 18:00 — anh Tiến 07/10/2026: *"mỗi ngày cứ cập nhật lại các ma trận vào
 * lúc 18 giờ tối đi, để có số mới, chứ đừng có để xem tới đâu phải tự bấm reload chart ở đó, rất
 * mất thời gian"*.
 *
 * Test này gác HAI điều, và cả hai đều đã từng sai thật trên production:
 *
 * 1. HAI BÊN PHẢI ĐO BẰNG MỘT THƯỚC. App coi cache ghi trước mốc làm mới gần nhất là cũ
 *    (lastRefreshBoundary). Warmer có thước riêng (mocGanNhat). Bản đang chạy warm lúc 09:00 ·
 *    14:30 · 17:30 trong khi app lấy mốc 18:00 và 20:00 — nên MỌI lượt warm xong TRƯỚC mốc, rồi
 *    tới 18:00 app coi chính bản vừa warm là cũ. Đó là lý do thật khiến vẫn phải bấm "Làm mới".
 *    Lệch kiểu này KHÔNG có thông báo lỗi nào: app vẫn chạy, chỉ là số đứng im và hao lượt ghi.
 *
 * 2. NỘI DUNG Y NGUYÊN KHÔNG ĐƯỢC TỐN LƯỢT GHI. Gói KV free cho 1.000 lượt ghi/ngày và app đã
 *    tràn thật 1.228 lượt ngày 03/10/2026. Warm cả danh sách mỗi ngày mà ô nào cũng ghi thì tự
 *    mình đốt hạn mức; đo bảng kv_write 14 ngày: kho `spdf2` ghi 253 lượt mà chỉ 142 nội dung khác
 *    nhau, 111 lượt ghi lại đúng byte cũ.
 *
 * ĐỌC THẲNG MÃ NGUỒN warmer/src/index.mjs rồi chạy, KHÔNG viết lại một bản sao: warmer là worker
 * riêng, không import được vào test (nó nạp @cloudflare/puppeteer). Test một bản sao thì chỉ chứng
 * minh bản sao đúng, trong khi thứ chạy trên Cloudflare là file kia.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { khoaPdf, khoaSummary, lastRefreshBoundary } from "@/lib/mtld-install.functions";

type O = Record<string, unknown>;
type SoMoc = Record<string, { ts?: number; bam?: string }>;
type KhoWarm = {
  mocGanNhat(now: number): number;
  pdfArgs(p: O): { gid?: string; range?: string };
  ghiNeuKhac(kv: KvGia, so: SoMoc, key: string, bytes: Uint8Array, hanHet?: number): Promise<boolean>;
  warmMaTran(env: { PMO_EDITS: KvGia }): Promise<O>;
  warmOne(kv: KvGia, id: string, so: SoMoc, han: Map<string, number>): Promise<boolean>;
  toB64(bytes: Uint8Array): string;
  WARM_TTL_S: number;
  WARM_MOI_LUOT: number;
  MATRAN_GHI_MOI_LUOT: number;
};

/* ── KV GIẢ: đếm ĐÚNG số lượt ghi, vì đó là con số cả bài này nói về ───────────── */
class KvGia {
  kho = new Map<string, { v: string; han?: number }>();
  soLuotGhi = 0;
  khoaDaGhi: string[] = [];
  async get(k: string) { return this.kho.get(k)?.v ?? null; }
  async put(k: string, v: string, o?: { expirationTtl?: number }) {
    this.soLuotGhi++; this.khoaDaGhi.push(k);
    this.kho.set(k, { v, han: o?.expirationTtl ? Math.floor(Date.now() / 1000) + o.expirationTtl : undefined });
  }
  async list({ prefix }: { prefix: string }) {
    const keys = [...this.kho.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, x]) => ({ name: k, expiration: x.han }));
    return { keys, list_complete: true, cursor: undefined };
  }
}

/* ── NẠP MÃ NGUỒN THẬT CỦA WARMER ─────────────────────────────────────────────
   Bỏ dòng `import` (fflate + puppeteer không chạy trong test) và đổi `export default` thành biến
   thường, rồi chạy nguyên phần còn lại. `fetch` được thay bằng bản giả để không gọi ra Google. */
let kho: KhoWarm;
let soLuotTai = 0;
let noiDungPdf = "PDF-A";
let noiDungTab = "T1";
let demB64 = 0;             // số lần base64 THẬT SỰ chạy — phần đắt nhất của một lượt warm
let htmlTraRong = false;    // giả lập file .xlsx — không có trang /htmlview nên tra gid ra rỗng
let urlDaGoi: string[] = [];
/* KHUÔN THẬT của trang /htmlview: khoá KHÔNG ngoặc kép, gid nằm sau pageUrl. Lấy nguyên dạng từ
   ghi chú của listTabGids — mẫu bịa cho khớp regex của mình thì test chỉ chứng minh mình đúng. */
const htmlGia = 'x={name: "Summary", pageUrl: "https://d/?gid=1150967611", gid: "1150967611", i:0},{name: "Public Summary", pageUrl: "u", gid: "77", i:1}';

beforeAll(() => {
  const src = readFileSync(resolve(__dirname, "../warmer/src/index.mjs"), "utf8")
    .split(/\r?\n/).filter((l) => !/^import\s/.test(l)).join("\n")
    .replace("export default {", "const _handler = {");

  /* `btoa` nhận vào qua THAM SỐ nên nó che hẳn bản toàn cục bên trong mã warmer. Nhờ vậy đếm được
     số lần base64 thật sự chạy — không gán đè được từ ngoài, vì ghiNeuKhac gọi `toB64` trong
     closure của chính nó chứ không qua object trả về. */
  const taoKho = new Function("fetch", "btoa", "unzipSync", "zipSync", "strFromU8", "puppeteer", `
    ${src}
    return { mocGanNhat, pdfArgs, ghiNeuKhac, warmMaTran, warmOne, docSoMoc, toB64, WARM_TTL_S, WARM_MOI_LUOT, MATRAN_GHI_MOI_LUOT };
  `) as (...a: unknown[]) => KhoWarm;

  /* fetch giả — phục vụ ba đường mà warmer gọi ra ngoài:
       · /htmlview            → trang liệt kê tab, để tra gid
       · export…&gid=…        → ĐƯỜNG NHẸ, trả đúng một tab
       · export… (không gid)  → đường cũ, trả cả file
     Bản "PDF" phải mở đầu bằng %PDF để qua cửa kiểm của taiPdf. */
  const fetchGia = async (url: string) => {
    soLuotTai++; urlDaGoi.push(String(url));
    const tra = (t: string) => {
      const b = new TextEncoder().encode(t);
      return { ok: true, status: 200, text: async () => t, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
    };
    const u = String(url);
    if (u.includes("/htmlview")) return tra(htmlTraRong ? "" : htmlGia);
    if (u.includes("format=pdf")) return tra("%PDF-1.4 " + noiDungPdf);
    return tra(u.includes("&gid=") ? "XLSX-MOT-TAB " + noiDungTab : "XLSX-CA-FILE " + noiDungTab);
  };
  const btoaDem = (s: string) => { demB64++; return Buffer.from(s, "binary").toString("base64"); };
  kho = taoKho(fetchGia, btoaDem, () => ({}), () => new Uint8Array(), () => "", {});
});

/* Dựng mốc từ giờ VN → UTC ms (VN = UTC+7). */
const vn = (ngay: string, gio: number, phut = 0) =>
  Date.parse(`${ngay}T00:00:00Z`) - 7 * 3600_000 + gio * 3600_000 + phut * 60_000;

describe("warmer và app đo bằng CÙNG một thước", () => {
  it("khớp từng phút suốt 24 giờ", () => {
    const lech: string[] = [];
    for (let p = 0; p < 24 * 60; p++) {
      const now = vn("2026-10-07", 0, p);
      const a = lastRefreshBoundary(now), b = kho.mocGanNhat(now);
      if (a !== b) lech.push(`phút ${p}: app=${a} warmer=${b}`);
    }
    expect(lech.slice(0, 5)).toEqual([]);
  });

  it("khớp cả khi qua nửa đêm và qua tháng", () => {
    for (const t of [vn("2026-10-07", 0, 1), vn("2026-10-07", 17, 59), vn("2026-10-07", 18), vn("2026-11-01", 0, 30), vn("2026-12-31", 23, 59)]) {
      expect(kho.mocGanNhat(t)).toBe(lastRefreshBoundary(t));
    }
  });

  /* Hàng rào cho chính cái bug cũ: warm xong lúc 17:30 thì tới 18:00 app coi là cũ. */
  it("bản warm lúc 17:30 bị app coi là CŨ ngay sau 18:00 — nên warm phải chạy TỪ 18:00", () => {
    const tsWarm = vn("2026-10-07", 17, 30);
    expect(tsWarm).toBeLessThan(lastRefreshBoundary(vn("2026-10-07", 18, 1)));
    const tsWarmMoi = vn("2026-10-07", 18, 2);
    expect(tsWarmMoi).toBeGreaterThanOrEqual(lastRefreshBoundary(vn("2026-10-07", 19, 0)));
  });
});

describe("vùng PDF tính y như app", () => {
  /* KHỚP pdfArgsOf trong src/lib/app-shell.tsx. Lệch một tham số là ra PDF khác mà khoá cache vẫn
     một → app bày bản warm chứ không phải bản nó tự tải, lệch âm thầm không ai thấy. */
  const pdfArgsOf = (p: O): { gid?: string; range?: string } => {
    const r = (String(p.range ?? "")).trim();
    if (p.gid) return { gid: p.gid as string, range: r || undefined };
    const s = (String(p.sheet ?? "")).trim();
    return { range: s && r ? `${s}!${r}` : (s || r || undefined) };
  };
  const ca: O[] = [
    { gid: "123", range: "A1:H30" }, { gid: "123" }, { gid: "123", range: "  " },
    { sheet: "Summary", range: "B3:AK45" }, { sheet: "Summary" }, { range: "B3:AK45" }, {},
    { sheet: "PUBLIC 4S", range: "A1:AQ12" },
  ];
  for (const p of ca) {
    it(`${JSON.stringify(p)}`, () => expect(kho.pdfArgs(p)).toEqual(pdfArgsOf(p)));
  }
});

/** Chuỗi → byte. ghiNeuKhac nhận BYTE THÔ: nó băm byte rồi mới base64, và chỉ base64 ở nhánh
 *  thật sự ghi — xem bamByte trong warmer. */
const by = (t: string) => new TextEncoder().encode(t);

describe("nội dung y nguyên thì KHÔNG tốn lượt ghi", () => {
  it("lần đầu ghi, lần hai y nguyên thì bỏ qua", async () => {
    const kv = new KvGia(); const so: SoMoc = {};
    const han = Math.floor(Date.now() / 1000) + kho.WARM_TTL_S;      // còn hạn dài, không phải gia hạn
    expect(await kho.ghiNeuKhac(kv, so, "spdf2:x::", by("AAA"), han)).toBe(true);
    expect(kv.soLuotGhi).toBe(1);
    expect(await kho.ghiNeuKhac(kv, so, "spdf2:x::", by("AAA"), han)).toBe(false);
    expect(kv.soLuotGhi).toBe(1);                                     // vẫn 1 — đây là cả mục đích
  });

  it("nội dung ĐỔI thì ghi", async () => {
    const kv = new KvGia(); const so: SoMoc = {};
    const han = Math.floor(Date.now() / 1000) + kho.WARM_TTL_S;
    await kho.ghiNeuKhac(kv, so, "k", by("AAA"), han);
    expect(await kho.ghiNeuKhac(kv, so, "k", by("BBB"), han)).toBe(true);
    expect(kv.soLuotGhi).toBe(2);
  });

  it("mốc vào sổ KỂ CẢ khi không ghi giá trị — nếu không app lại coi là cũ rồi tự tải lại", async () => {
    const kv = new KvGia(); const so: SoMoc = {};
    const han = Math.floor(Date.now() / 1000) + kho.WARM_TTL_S;
    await kho.ghiNeuKhac(kv, so, "k", by("AAA"), han);
    const truoc = so["k"].ts!;
    await new Promise((r) => setTimeout(r, 5));
    await kho.ghiNeuKhac(kv, so, "k", by("AAA"), han);
    expect(so["k"].ts!).toBeGreaterThan(truoc);
  });

  /* Không ghi lại thì TTL cũng không được gia hạn — để vậy mãi là cache tự biến mất, người mở phải
     chờ tải nguội. Nên sắp hết hạn thì ghi dù y nguyên. */
  it("sắp hết hạn thì ghi dù y nguyên — cache không được phép biến mất", async () => {
    const kv = new KvGia(); const so: SoMoc = {};
    const conDai = Math.floor(Date.now() / 1000) + kho.WARM_TTL_S;
    await kho.ghiNeuKhac(kv, so, "k", by("AAA"), conDai);
    const sapHet = Math.floor(Date.now() / 1000) + 3600;              // còn 1 tiếng
    expect(await kho.ghiNeuKhac(kv, so, "k", by("AAA"), sapHet)).toBe(true);
  });

  it("chưa có hạn (khoá mới) thì ghi", async () => {
    const kv = new KvGia(); const so: SoMoc = { k: { ts: Date.now(), bam: "x" } };
    expect(await kho.ghiNeuKhac(kv, so, "k", by("AAA"), undefined)).toBe(true);
  });

  /* ĐÂY LÀ CA LÀM CHẾT WORKER THẬT. Bản đầu base64 MỌI ô rồi mới băm chuỗi đó để so — tức làm phần
     đắt nhất cho cả ô lát nữa phát hiện y nguyên và vứt đi. Gọi thử trên live 07/10/2026 ra đúng
     `error code: 1102` (worker vượt tài nguyên).

     Gác bằng cách ĐẾM: cho toB64 báo mỗi lần bị gọi. Ô y nguyên mà vẫn gọi base64 là sai. */
  it("ô y nguyên thì KHÔNG base64 — đó mới là phần đắt", async () => {
    const kv = new KvGia(); const so: SoMoc = {};
    const han = Math.floor(Date.now() / 1000) + kho.WARM_TTL_S;

    demB64 = 0;
    await kho.ghiNeuKhac(kv, so, "k", by("AAA"), han);     // lần đầu: phải base64 để ghi
    expect(demB64).toBeGreaterThan(0);

    const sauLanDau = demB64;
    await kho.ghiNeuKhac(kv, so, "k", by("AAA"), han);     // y nguyên: KHÔNG được base64 nữa
    expect(demB64).toBe(sauLanDau);
  });
});

describe("warmMaTran — một lượt warm cả danh sách", () => {
  const dsGia = [
    { fileId: "aaaaaaaaaa1", maCT: "CT1", chart: true, gid: "11", range: "A1:H30" },
    { fileId: "aaaaaaaaaa2", maCT: "CT2", chart: true, sheet: "Summary", range: "B3:AK45" },
    { fileId: "aaaaaaaaaa3", maCT: "CT3", chart: false, sheet: "Summary" },   // thẻ không-chart → không thuộc kho này
    { fileId: "aaaaaaaaaa4", maCT: "CT4" },                                    // không cờ chart
  ];

  it("chỉ làm thẻ có cờ chart, và ghi sổ ĐÚNG MỘT lần cho cả lượt", async () => {
    const kv = new KvGia();
    await kv.put("mtld:install:list:v2", JSON.stringify(dsGia));
    kv.soLuotGhi = 0; kv.khoaDaGhi = []; soLuotTai = 0; noiDungPdf = "PDF-A";

    const r = await kho.warmMaTran({ PMO_EDITS: kv });
    expect(r.tong).toBe(2);                     // 2 thẻ chart trong 4 dòng
    expect(r.ghi).toBe(2);
    expect(r.hong).toBe(0);
    expect(soLuotTai).toBe(2);

    const so = kv.khoaDaGhi.filter((k) => k === "warm:moc:v1").length;
    expect(so).toBe(1);                         // MỘT lượt ghi cho cả sổ, không phải một lượt mỗi ô
    expect(kv.soLuotGhi).toBe(3);               // 2 ô + 1 sổ
  });

  it("chạy lại trong CÙNG mốc → không làm lại ô nào, chỉ tốn 1 lượt ghi sổ", async () => {
    const kv = new KvGia();
    await kv.put("mtld:install:list:v2", JSON.stringify(dsGia));
    noiDungPdf = "PDF-A";
    await kho.warmMaTran({ PMO_EDITS: kv });

    kv.soLuotGhi = 0; kv.khoaDaGhi = []; soLuotTai = 0;
    const r2 = await kho.warmMaTran({ PMO_EDITS: kv });
    expect(r2.canLam).toBe(0);                  // mốc trong sổ đã mới hơn mốc làm mới gần nhất
    expect(soLuotTai).toBe(0);                  // không tải lại gì — đỡ cả CPU lẫn băng thông
    expect(kv.soLuotGhi).toBe(1);               // chỉ sổ
  });

  /* KHOÁ PHẢI TRÙNG — và so với khoá do CHÍNH APP dựng, không phải với chuỗi mình gõ tay vào test.
     Warmer là worker riêng, không import được mtld-install.functions.ts, nên đây là chỗ duy nhất
     đối chiếu được hai bên. Warm vào khoá A mà app đọc khoá B thì app vẫn chạy, số vẫn cũ, và
     KHÔNG có lỗi nào hiện ra — đúng kiểu lệch âm thầm đã xảy ra một lần với mốc giờ. */
  it("khoá cache dựng GIỐNG HỆT khoá app đọc", async () => {
    const kv = new KvGia();
    await kv.put("mtld:install:list:v2", JSON.stringify(dsGia));
    kv.khoaDaGhi = []; noiDungPdf = "PDF-A";
    await kho.warmMaTran({ PMO_EDITS: kv });
    for (const p of dsGia.filter((x) => x.chart)) {
      const a = kho.pdfArgs(p);
      expect(kv.khoaDaGhi).toContain(khoaPdf(p.fileId, a.gid, a.range));
    }
  });

  it("danh sách rỗng / KV thiếu → trả về gọn, KHÔNG ném", async () => {
    const kvRong = new KvGia();
    await expect(kho.warmMaTran({ PMO_EDITS: kvRong })).resolves.toEqual({ tong: 0 });
    await expect(kho.warmMaTran({} as { PMO_EDITS: KvGia })).resolves.toEqual({ note: "thiếu KV PMO_EDITS" });
  });
});

/* ── ĐƯỜNG NHẸ: tải ĐÚNG MỘT TAB theo gid ────────────────────────────────────
   Đo thật 07/10/2026 trên file 1le0CS6… (20 tab, ô Summary 96.071 ô):
       cả file 1.391.068 byte / parse 1.427ms   ·   một tab 301.313 byte / parse 177ms
       so từng ô: 0 ô thiếu, 0 ô lệch; merge 194=194, cols 96=96, rows 1002=1002, ô có màu
       15.464=15.464 → y nguyên cả dữ liệu lẫn định dạng.
   Phần giải nén + nén lại chính là chỗ warmer chết CPU mỗi ngày 07/09→13/09/2026. Bỏ được nó thì
   một lượt warm phủ được cả danh sách thay vì 3 file. */
describe("warmOne đi đường nhẹ", () => {
  it("tra gid từ /htmlview rồi tải THEO GID, không tải cả file", async () => {
    const kv = new KvGia(); const so: SoMoc = {};
    urlDaGoi = []; noiDungTab = "T1";
    expect(await kho.warmOne(kv, "aaaaaaaaaa1", so, new Map())).toBe(true);
    expect(urlDaGoi.some((u) => u.includes("/htmlview"))).toBe(true);
    expect(urlDaGoi.some((u) => u.includes("format=xlsx") && u.includes("&gid=1150967611"))).toBe(true);
    expect(urlDaGoi.some((u) => u.includes("format=xlsx") && !u.includes("&gid="))).toBe(false);
  });

  it("NHỚ gid vào sổ — lượt sau không hỏi /htmlview nữa", async () => {
    const kv = new KvGia(); const so: SoMoc = {};
    noiDungTab = "T1";
    await kho.warmOne(kv, "aaaaaaaaaa1", so, new Map());
    expect(so["sfile:aaaaaaaaaa1"].gid).toBe("1150967611");

    urlDaGoi = []; noiDungTab = "T2";                       // đổi nội dung để lượt hai thật sự ghi
    await kho.warmOne(kv, "aaaaaaaaaa1", so, new Map());
    expect(urlDaGoi.some((u) => u.includes("/htmlview"))).toBe(false);
    expect(urlDaGoi.some((u) => u.includes("&gid=1150967611"))).toBe(true);
  });

  it("nhớ gid KHÔNG tốn thêm lượt ghi — nó nằm trong sổ, mà sổ dù sao cũng ghi một lượt", async () => {
    const kv = new KvGia(); const so: SoMoc = {};
    noiDungTab = "T1";
    await kho.warmOne(kv, "aaaaaaaaaa1", so, new Map());
    expect(kv.khoaDaGhi.filter((k) => k.startsWith("tabs:"))).toEqual([]);
  });

  /* File .xlsx thật không có trang /htmlview → tra gid ra rỗng. Phải LÙI về đường cũ, vì thà chậm
     như trước còn hơn để trống cache rồi người mở phải chờ tải nguội. */
  it("không tra ra gid → LÙI về tải cả file, KHÔNG để trống cache", async () => {
    const kv = new KvGia(); const so: SoMoc = {};
    urlDaGoi = []; noiDungTab = "T1"; htmlTraRong = true;
    try {
      expect(await kho.warmOne(kv, "bbbbbbbbbb2", so, new Map())).toBe(true);
      expect(urlDaGoi.some((u) => u.includes("format=xlsx") && !u.includes("&gid="))).toBe(true);
      expect(kv.kho.has("sfile:bbbbbbbbbb2")).toBe(true);
      expect(so["sfile:bbbbbbbbbb2"].gid).toBeUndefined();   // không nhớ gid rỗng vào sổ
    } finally { htmlTraRong = false; }
  });

  it("ghi vào ĐÚNG khoá app đọc cho bản Summary", async () => {
    const kv = new KvGia(); const so: SoMoc = {};
    noiDungTab = "T1";
    await kho.warmOne(kv, "aaaaaaaaaa1", so, new Map());
    expect(kv.khoaDaGhi).toContain(khoaSummary("aaaaaaaaaa1"));
    // Thẻ dạng Summary gọi loadRegion(fid, { sheetName: "Summary" }) → app đọc đúng khoá này.
    expect(khoaSummary("aaaaaaaaaa1", { sheet: "Summary" })).toBe(khoaSummary("aaaaaaaaaa1"));
  });

  it("mỗi lượt phủ nhiều file hơn 3 — con số cũ là vì đường cũ đốt CPU", () => {
    expect(kho.WARM_MOI_LUOT).toBeGreaterThan(3);
  });
});
