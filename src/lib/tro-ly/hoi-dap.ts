/**
 * TRỢ LÝ ePMP — BỘ TRẢ LỜI.
 *
 * Nhận câu hỏi tiếng Việt + BẢN TÓM dữ liệu app đang bày + NGỮ CẢNH (đang ở màn nào, lọc gì, mở
 * dự án nào), trả về câu trả lời dựng được thành giao diện.
 *
 * BA LUẬT KHÔNG ĐƯỢC PHÁ:
 *  1. **KHÔNG BỊA.** Không dò ra thì nói thẳng là chưa biết. Câu trả lời nghe hợp lý mà sai còn
 *     tệ hơn "tôi chưa biết" — người ta mang số đó đi họp.
 *  2. **KHÔNG TỰ TÍNH LẠI LUẬT.** Trễ, cần cắt, cần trình BOD… lấy sẵn trong bản tóm.
 *  3. **NÓI SỐ THÌ NÓI LẤY TỪ ĐÂU**, và cho bấm về đúng chỗ soi lại.
 *
 * NGỮ CẢNH ĐƯỢC ƯU TIÊN: đang mở một dự án mà hỏi trống không ("sao chậm vậy") thì hiểu là hỏi
 * dự án đó. Đang lọc mà hỏi "bao nhiêu dự án" thì trả lời trên phần đang lọc, và nói rõ là đang
 * lọc — không lặng lẽ trả lời trên toàn bộ.
 *
 * Module THUẦN để test được.
 */
import type { CauTraLoi, DuAnTom, HanhDong, Khoi, NguonHoi } from "./kieu";
import { KIEN_THUC } from "./kien-thuc";

/* ── chữ nghĩa ──────────────────────────────────────────────────────────────── */

export function boDau(s: string): string {
  return (s || "").normalize("NFC").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/\s+/g, " ").trim();
}

const THANG_CHU = ["", "một", "hai", "ba", "tư", "năm", "sáu", "bảy", "tám", "chín", "mười", "mười một", "mười hai"];
const ddmm = (iso: string | null): string => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const ddmmyy = (iso: string | null): string => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "—");
const soNgay = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const dem = (n: number, dt = "dự án") => (n === 0 ? `không có ${dt} nào` : `${n} ${dt}`);
const chu = (...c: string[]): Khoi[] => c.map((x) => ({ loai: "chu" as const, chu: x }));

/* ── tra dự án ──────────────────────────────────────────────────────────────── */

export function timDuAn(cau: string, ds: DuAnTom[]): DuAnTom[] {
  const c = boDau(cau);
  const ma = c.match(/ct\s*\d{2}\s*-\s*\d{2,4}/g)?.map((x) => x.replace(/\s+/g, "")) ?? [];
  if (ma.length) {
    const hit = ds.filter((d) => ma.some((m) => boDau(d.maCT).replace(/\s+/g, "").includes(m)));
    if (hit.length) return hit;
  }
  const cham = ds.map((d) => {
    const tu = boDau(d.ten).split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
    if (!tu.length) return { d, diem: 0 };
    const trung = tu.filter((t) => c.includes(t)).length;
    return { d, diem: trung / tu.length + (c.includes(boDau(d.ten)) ? 1 : 0) };
  }).filter((x) => x.diem >= 0.6).sort((a, b) => b.diem - a.diem);
  return cham.slice(0, 5).map((x) => x.d);
}

export function thangTrongCau(cau: string, homNay: string): string | null {
  const c = boDau(cau);
  const nam = +homNay.slice(0, 4), thg = +homNay.slice(5, 7);
  const lam = (y: number, m: number) => `${y + Math.floor((m - 1) / 12)}-${String((((m - 1) % 12) + 12) % 12 + 1).padStart(2, "0")}`;
  if (/thang nay/.test(c)) return lam(nam, thg);
  if (/thang sau|thang toi|thang ke/.test(c)) return lam(nam, thg + 1);
  if (/thang truoc/.test(c)) return lam(nam, thg - 1);
  const m = c.match(/thang\s*(\d{1,2})(?:\s*[/-]\s*(\d{2,4}))?/);
  if (!m) return null;
  const mm = +m[1];
  if (mm < 1 || mm > 12) return null;
  let y = m[2] ? +m[2] : nam;
  if (y < 100) y += 2000;
  return `${y}-${String(mm).padStart(2, "0")}`;
}

/* ── mảnh dựng ──────────────────────────────────────────────────────────────── */

const dsDuAn = (ds: DuAnTom[], phu: (d: DuAnTom) => string, mau?: (d: DuAnTom) => "do" | "vang" | "xanh" | "trung", gioiHan = 8): Khoi => ({
  loai: "du-an",
  ds: ds.slice(0, gioiHan).map((d) => ({ khoa: d.khoa, maCT: d.maCT, ten: d.ten, phu: phu(d), mau: mau?.(d) })),
  con: Math.max(0, ds.length - gioiHan),
});

const GOI_Y_CHUNG = ["Tổng quan hôm nay", "Dự án nào đang trễ?", "Dự án nào cần trình BOD?", "Bàn giao tháng sau có gì?"];

const CHUA_BIET = (goiY: string[]): CauTraLoi => ({
  tieuDe: "Câu này tôi chưa trả lời được",
  khoi: chu(
    "Tôi chắc về ba thứ: số liệu dự án, master plan, và cách dùng app. Ngoài đó tôi không đoán bừa.",
    "Hỏi thẳng theo mã CT cũng được — ví dụ “CT26-036 thế nào rồi”.",
  ),
  goiY,
  khongBiet: true,
});

/** Câu hỏi nói tới phạm vi nào: đang lọc hay toàn bộ. */
function tapDuAn(n: NguonHoi, cau: string): { ds: DuAnTom[]; loc: boolean } {
  const c = boDau(cau);
  if (/tat ca|toan bo|moi du an|tong the/.test(c)) return { ds: n.duAn, loc: false };
  if (n.nguCanh.pham === "tat-ca") return { ds: n.duAn, loc: false };
  const hien = n.duAn.filter((d) => d.dangHien);
  const dangLoc = n.nguCanh.boLoc.length > 0 && hien.length < n.duAn.length;
  return dangLoc ? { ds: hien, loc: true } : { ds: n.duAn, loc: false };
}

const nhacLoc = (loc: boolean, n: NguonHoi): Khoi[] =>
  loc ? [{ loai: "nhac", mau: "trung", chu: `Đang tính trên phần đang lọc (${n.nguCanh.boLoc.join(" · ")}). Muốn tính cả 69 dự án thì đổi phạm vi ở đầu khung chat, hoặc hỏi “… tất cả”.` }] : [];

/* ── bộ trả lời ─────────────────────────────────────────────────────────────── */

export function traLoi(cauHoi: string, n: NguonHoi): CauTraLoi {
  const c = boDau(cauHoi);
  if (!c) return CHUA_BIET(GOI_Y_CHUNG);
  const mo = n.nguCanh.duAnDangMo;

  /* 0. Đang mở một dự án + hỏi trống không → hiểu là hỏi dự án đó */
  if (mo && /^(sao|tai sao|vi sao|the nao|nhu the nao|tinh hinh|tom tat|gio sao|con gi)/.test(c) && !/ct\s*\d{2}/.test(c)) {
    const d = n.duAn.find((x) => x.maCT === mo.maCT && x.ten === mo.ten) ?? n.duAn.find((x) => x.ten === mo.ten);
    if (d) return theDuAn(d, n, `Đang mở ${d.ten} nên tôi trả lời trên dự án này.`);
  }

  /* 1. Chào */
  if (/^(hi|hello|chao|xin chao|alo)\b/.test(c)) {
    return {
      tieuDe: "Chào anh/chị",
      khoi: chu(`Tôi là trợ lý của ePMP. Hỏi tôi về số liệu dự án, master plan, hay cách dùng app. App đang theo ${dem(n.kpi.hienHanh)}.`),
      goiY: GOI_Y_CHUNG,
      nguon: "bấm số phiên bản ở đầu trang để xem đủ",
    };
  }

  /* 2. Tổng quan */
  if (/tong quan|tinh hinh chung|bao nhieu du an|tong cong|tong so|hom nay the nao|co gi bat thuong|co van de gi/.test(c)) {
    const { ds, loc } = tapDuAn(n, cauHoi);
    const tre = ds.filter((d) => d.tre > 0), mp = ds.filter((d) => d.canTrinhMp);
    const quaHan = mp.filter((d) => d.soTuanTreMp > 0);
    return {
      tieuDe: `Tổng quan ngày ${ddmm(n.homNay)}`,
      khoi: [
        {
          loai: "the-so",
          the: [
            { nhan: "Dự án", gia: String(ds.length) },
            { nhan: "Có hạng mục trễ", gia: String(tre.length), mau: tre.length ? "do" : "xanh" },
            { nhan: "Cần trình BOD", gia: String(mp.length), mau: mp.length ? "vang" : "xanh" },
            { nhan: "Quá hạn trình", gia: String(quaHan.length), mau: quaHan.length ? "do" : "xanh" },
          ],
        },
        ...nhacLoc(loc, n),
        ...chu(`Cộng lại **${ds.reduce((a, d) => a + d.tre, 0)} hạng mục** đang trễ, ${ds.reduce((a, d) => a + d.canCat, 0)} cần cắt đầu việc, ${ds.reduce((a, d) => a + d.canTapTrung, 0)} cần tập trung.`),
        ...(quaHan.length ? [{ loai: "nhac" as const, mau: "do" as const, chu: `${quaHan.length} dự án đã quá hạn trình BOD và đang bị trừ điểm.` }] : []),
      ],
      hanhDong: [
        { nhan: "Xem dự án trễ", lenh: { kieu: "loc-tre" } },
        { nhan: "Xem cần trình BOD", lenh: { kieu: "loc-mp" } },
      ],
      goiY: ["Dự án nào đang trễ?", "Dự án nào cần trình BOD?", "Bàn giao tháng sau có gì?"],
      nguon: "dãy thẻ số ở đầu trang",
    };
  }

  /* 3. Cần trình BOD */
  if (/trinh bod|cap nhat mp|master plan|can trinh|bitrix/.test(c) && !/cu phap|ghi the nao|viet the nao|ghi sao|cach ghi/.test(c)) {
    const { ds: tap, loc } = tapDuAn(n, cauHoi);
    const ds = tap.filter((d) => d.canTrinhMp)
      .sort((a, b) => (b.soTuanTreMp - a.soTuanTreMp) || (a.hanMp ?? "9999").localeCompare(b.hanMp ?? "9999"));
    if (!ds.length) {
      return { tieuDe: "Không có dự án nào đang cần trình BOD", khoi: [...nhacLoc(loc, n), ...chu("Bộ lọc “Cần cập nhật MP” đang rỗng.")], nguon: "bộ lọc Cần cập nhật MP" };
    }
    const quaHan = ds.filter((d) => d.soTuanTreMp > 0);
    const chuaHan = ds.filter((d) => !d.hanMp);
    return {
      tieuDe: `${dem(ds.length)} cần PM trình BOD phê duyệt master plan`,
      khoi: [
        ...nhacLoc(loc, n),
        ...(quaHan.length
          ? [{ loai: "nhac" as const, mau: "do" as const, chu: `${quaHan.length} dự án đã quá hạn — mỗi tuần quá hạn trừ 10 điểm.` }]
          : chu("Chưa dự án nào quá hạn trình.")),
        dsDuAn(ds, (d) => (d.hanMp ? `trước ${ddmm(d.hanMp)}${d.soTuanTreMp > 0 ? ` · trễ ${d.soTuanTreMp} tuần` : ""}` : "chưa ghi hạn"),
          (d) => (d.soTuanTreMp > 0 ? "do" : d.hanMp ? "vang" : "trung")),
        ...(chuaHan.length ? chu(`${chuaHan.length} dự án chưa ghi hạn trong ô Vướng mắc nên không tính được số tuần.`) : []),
      ],
      hanhDong: [{ nhan: "Lọc bảng theo nhóm này", lenh: { kieu: "loc-mp" } }],
      goiY: ["Cú pháp ghi cần trình BOD thế nào?", "Tổng quan hôm nay"],
      nguon: "bộ lọc “Cần cập nhật MP” trên bảng",
    };
  }

  /* 4. Trễ tiến độ */
  if (/tre tien do|dang tre|nao tre|cham tien do|tre han|overdue|qua han/.test(c)) {
    const { ds: tap, loc } = tapDuAn(n, cauHoi);
    const ds = tap.filter((d) => d.tre > 0).sort((a, b) => b.tre - a.tre);
    if (!ds.length) return { tieuDe: "Không có dự án nào đang trễ", khoi: [...nhacLoc(loc, n), ...chu("Không hạng mục nào rơi vào nhóm Trễ tiến độ.")], nguon: "thẻ Trễ tiến độ" };
    return {
      tieuDe: `${dem(ds.length)} có hạng mục trễ tiến độ`,
      khoi: [
        ...nhacLoc(loc, n),
        { loai: "the-so", the: [
          { nhan: "Dự án dính trễ", gia: String(ds.length), mau: "do" },
          { nhan: "Hạng mục trễ", gia: String(ds.reduce((a, d) => a + d.tre, 0)), mau: "do" },
          { nhan: "Nặng nhất", gia: `${ds[0].tre} hạng mục`, phu: ds[0].maCT },
        ] },
        dsDuAn(ds, (d) => `${d.tre} hạng mục trễ · bàn giao ${ddmmyy(d.banGiao)}`, () => "do"),
      ],
      hanhDong: [{ nhan: "Lọc bảng theo nhóm trễ", lenh: { kieu: "loc-tre" } }],
      goiY: ["Tổng quan hôm nay", "Dự án nào cần trình BOD?"],
      nguon: "thẻ “Trễ tiến độ” ở đầu trang",
    };
  }

  /* 5. Bàn giao theo tháng */
  const thg = thangTrongCau(c, n.homNay);
  if (thg && /ban giao|ket thuc|deadline|han|giao thang|dao han/.test(c)) {
    const { ds: tap, loc } = tapDuAn(n, cauHoi);
    const ds = tap.filter((d) => (d.banGiao ?? "").startsWith(thg)).sort((a, b) => (a.banGiao ?? "").localeCompare(b.banGiao ?? ""));
    const nhan = `tháng ${THANG_CHU[+thg.slice(5, 7)]}/${thg.slice(0, 4)}`;
    if (!ds.length) return { tieuDe: `Không có dự án nào bàn giao ${nhan}`, khoi: nhacLoc(loc, n), goiY: GOI_Y_CHUNG, nguon: "cột Ngày kết thúc cấp dự án" };
    const coTre = ds.filter((d) => d.tre > 0);
    return {
      tieuDe: `${dem(ds.length)} bàn giao ${nhan}`,
      khoi: [
        ...nhacLoc(loc, n),
        ...(coTre.length
          ? [{ loai: "nhac" as const, mau: "do" as const, chu: `${coTre.length} dự án trong nhóm này đang có hạng mục trễ.` }]
          : chu("Không dự án nào trong nhóm này đang trễ.")),
        dsDuAn(ds, (d) => `${ddmmyy(d.banGiao)} · ${d.pm || "chưa có PM"}${d.tre ? ` · ${d.tre} hạng mục trễ` : ""}`,
          (d) => (d.tre ? "do" : "trung"), 10),
      ],
      hanhDong: [{ nhan: `Lọc bảng theo ${nhan}`, lenh: { kieu: "loc-thang", thang: thg } }],
      goiY: ["Dự án nào đang trễ?", "Tổng quan hôm nay"],
      nguon: "cột Ngày kết thúc cấp dự án",
    };
  }

  /* 6. Theo PM */
  const mPm = c.match(/(?:cua|pm|phu trach)\s+((?:[a-z]+\s*){1,4})$/);
  if (mPm) {
    const ten = mPm[1].trim();
    const ds = n.duAn.filter((d) => boDau(d.pm).includes(ten));
    if (ds.length) {
      return {
        tieuDe: `${dem(ds.length)} do ${ds[0].pm} phụ trách`,
        khoi: [
          { loai: "the-so", the: [
            { nhan: "Dự án", gia: String(ds.length) },
            { nhan: "Hạng mục trễ", gia: String(ds.reduce((a, d) => a + d.tre, 0)), mau: ds.some((d) => d.tre) ? "do" : "xanh" },
            { nhan: "Cần trình BOD", gia: String(ds.filter((d) => d.canTrinhMp).length), mau: "vang" },
          ] },
          dsDuAn(ds, (d) => `bàn giao ${ddmmyy(d.banGiao)}${d.tre ? ` · ${d.tre} trễ` : ""}`, (d) => (d.tre ? "do" : "trung")),
        ],
        hanhDong: [{ nhan: `Lọc bảng theo ${ds[0].pm}`, lenh: { kieu: "loc-pm", pm: ds[0].pm } }],
        nguon: "ô lọc PM trên bảng",
      };
    }
  }

  /* 7. Tra một dự án */
  const hit = timDuAn(cauHoi, n.duAn);
  if (hit.length === 1) return theDuAn(hit[0], n);
  if (hit.length > 1 && hit.length <= 5) {
    return {
      tieuDe: `Có ${hit.length} dự án khớp`,
      khoi: [...chu("Anh/chị chọn đúng dự án nào:"), dsDuAn(hit, (d) => `bàn giao ${ddmmyy(d.banGiao)}`, undefined, 5)],
      goiY: hit.slice(0, 3).map((d) => `${d.ten} thế nào rồi?`),
    };
  }

  /* 8. Phiên bản */
  if (/co gi moi|phien ban|version|vua sua gi|changelog|cap nhat gi/.test(c)) {
    const b = n.banMoi[0];
    return {
      tieuDe: `App đang ở bản ${n.phienBan}`,
      khoi: b ? [...chu(`**${b.v}** · ${b.date}`), ...chu(...b.items.slice(0, 4).map((x) => "· " + x))] : chu("Chưa có ghi chép phiên bản."),
      goiY: GOI_Y_CHUNG,
    };
  }

  /* 9. Kiến thức tính năng */
  for (const m of KIEN_THUC) {
    if (!m.tuKhoa.some((k) => c.includes(k))) continue;
    if (m.buoc && !m.buoc.some((k) => c.includes(k))) continue;
    return m.tra;
  }

  /* 10. Không biết */
  return CHUA_BIET(GOI_Y_CHUNG);
}

/** Thẻ một dự án. */
function theDuAn(d: DuAnTom, n: NguonHoi, moDau?: string): CauTraLoi {
  const conLai = d.banGiao ? soNgay(n.homNay, d.banGiao) : null;
  const khoi: Khoi[] = [];
  if (moDau) khoi.push({ loai: "nhac", mau: "trung", chu: moDau });
  khoi.push({
    loai: "the-so",
    the: [
      { nhan: "Bàn giao", gia: ddmmyy(d.banGiao), phu: conLai == null ? undefined : conLai >= 0 ? `còn ${conLai} ngày` : `đã qua ${-conLai} ngày`, mau: conLai != null && conLai < 0 ? "do" : conLai != null && conLai <= 14 ? "vang" : "trung" },
      { nhan: "Thực tế", gia: d.pct == null ? "—" : Math.round(d.pct) + "%" },
      { nhan: "Cập nhật", gia: ddmm(d.ngayUpdate) },
      { nhan: "Hạng mục", gia: String(d.soHangMuc) },
    ],
  });
  khoi.push(...chu(`**Mã CT** ${d.maCT}  ·  **PM** ${d.pm || "—"}  ·  **Vùng** ${d.vung || "—"}`));

  const canh: string[] = [];
  if (d.tre) canh.push(`${d.tre} trễ tiến độ`);
  if (d.canCat) canh.push(`${d.canCat} cần cắt đầu việc`);
  if (d.canTapTrung) canh.push(`${d.canTapTrung} cần tập trung`);
  khoi.push(canh.length
    ? { loai: "nhac", mau: d.tre ? "do" : "vang", chu: `Cảnh báo: ${canh.join(" · ")} (trên ${d.soHangMuc} hạng mục).` }
    : { loai: "nhac", mau: "xanh", chu: `Không có cảnh báo nào trên ${d.soHangMuc} hạng mục.` });

  if (d.daBanGiao) khoi.push({ loai: "nhac", mau: "xanh", chu: "Dự án này đã bàn giao xong." });
  if (d.canTrinhMp) {
    khoi.push({
      loai: "nhac", mau: d.soTuanTreMp > 0 ? "do" : "vang",
      chu: d.hanMp
        ? `Cần PM trình BOD phê duyệt master plan trước ${ddmm(d.hanMp)}${d.soTuanTreMp > 0 ? ` — quá hạn ${d.soTuanTreMp} tuần, đang bị trừ ${d.soTuanTreMp * 10} điểm.` : "."}`
        : "Cần PM trình BOD phê duyệt master plan — ô Vướng mắc chưa ghi hạn nên chưa tính được số tuần.",
    });
  }
  if (d.vuongMac) khoi.push(...chu(`**Vướng mắc đang chiếu:** ${d.vuongMac.replace(/\s*\n\s*/g, " ").slice(0, 320)}`));
  if (d.giaiPhap) khoi.push(...chu(`**Giải pháp:** ${d.giaiPhap.replace(/\s*\n\s*/g, " ").slice(0, 320)}`));
  khoi.push(...chu(d.coBaoCao ? "Đã gắn báo cáo lắp đặt / bàn giao vào app." : "Chưa gắn báo cáo lắp đặt hay bàn giao nào vào app."));

  const hd: HanhDong[] = [{ nhan: "Mở dự án trên bảng", lenh: { kieu: "mo-du-an", khoa: d.khoa } }];
  if (d.pm) hd.push({ nhan: `Xem cả nhóm ${d.pm}`, lenh: { kieu: "loc-pm", pm: d.pm } });

  return { tieuDe: d.ten, khoi, hanhDong: hd, goiY: ["Tổng quan hôm nay", "Dự án nào đang trễ?"], nguon: "dòng dự án trên bảng Việc cần xử lý" };
}
