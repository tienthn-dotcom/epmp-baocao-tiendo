/**
 * LUẬT "GIỐNG THÌ KHÔNG GHI" cho cache Summary (`sfile:`) và PDF tab lạ (`spdf2:`).
 *
 * Vì sao có bộ kiểm này: gói KV free chỉ cho 1.000 lượt GHI mỗi ngày và app đã tràn thật ba ngày
 * 09–11/09/2026. Đo 23/09/2026: 651 lượt / 1.000, trong đó riêng hai kho trên ăn 210 lượt mà phần
 * lớn là ghi đè đúng nội dung y hệt bản đã có.
 *
 * Bộ kiểm này gọi THẲNG hàm trong src/lib/mtld-install.functions.ts, KHÔNG chép luật sang đây.
 * Chép luật thì file test xanh trong khi code thật đã trôi đi lúc nào không biết.
 */
import { describe, it, expect } from "vitest";
import { ghiCacheNeuDoiB64, nenLamMoiNen } from "@/lib/mtld-install.functions";

/** KV giả — chỉ đếm số lượt PUT và giữ lại giá trị cuối. Đếm PUT là đúng thứ đang khan hiếm. */
function kvGia(banDau?: string) {
  const kho = new Map<string, string>();
  const ttl: (number | undefined)[] = [];
  let soPut = 0;
  if (banDau !== undefined) kho.set("k", banDau);
  return {
    soPut: () => soPut,
    ttl,
    doc: (k: string) => kho.get(k),
    kv: {
      get: async (k: string) => kho.get(k) ?? null,
      put: async (k: string, v: string, o?: { expirationTtl?: number }) => {
        soPut++; kho.set(k, v); ttl.push(o?.expirationTtl);
      },
    },
  };
}

const b64cua = (s: string | undefined) => (s === undefined ? undefined : (JSON.parse(s) as { b64: string }).b64);
const tsCua = (s: string | undefined) => (s === undefined ? undefined : (JSON.parse(s) as { ts: number }).ts);

describe("ghiCacheNeuDoiB64 — chỉ ghi khi nội dung thật sự đổi", () => {
  it("mở hai lần, nội dung y hệt → ghi ĐÚNG MỘT lượt", async () => {
    const g = kvGia();
    // Lượt 1: cache trượt, KHÔNG có bản cũ trong tay → phải ghi (thà thừa hơn để cache trống).
    expect(await ghiCacheNeuDoiB64(g.kv, "k", "AAA", undefined, 100)).toBe(true);
    // Lượt 2: người thứ hai mở cùng file, Drive trả về y hệt → KHÔNG được ghi.
    expect(await ghiCacheNeuDoiB64(g.kv, "k", "AAA", "AAA", 100)).toBe(false);
    expect(g.soPut()).toBe(1);
  });

  it("nội dung ĐỔI → ghi lượt thứ hai, và cache mang bản mới", async () => {
    const g = kvGia();
    await ghiCacheNeuDoiB64(g.kv, "k", "AAA", undefined, 100);
    expect(await ghiCacheNeuDoiB64(g.kv, "k", "BBB", "AAA", 100)).toBe(true);
    expect(g.soPut()).toBe(2);
    // Đây là phép kiểm quan trọng nhất: tiết kiệm lượt ghi mà làm dữ liệu cũ đọng lại thì tệ hơn hẳn.
    expect(b64cua(g.doc("k"))).toBe("BBB");
  });

  it("KHÔNG có bản cũ trong tay thì CỨ GHI, dù kho đang có đúng nội dung đó", async () => {
    // Đường "Làm mới" (force) bỏ qua lượt đọc cache nên không có bản cũ để so. Ràng buộc: cứ ghi.
    const g = kvGia(JSON.stringify({ b64: "AAA", ts: 1 }));
    expect(await ghiCacheNeuDoiB64(g.kv, "k", "AAA", undefined, 100)).toBe(true);
    expect(g.soPut()).toBe(1);
  });

  it("so trên RIÊNG b64, không so trên ts — ts đổi mỗi lượt nên so cả chuỗi là không bao giờ khớp", async () => {
    const g = kvGia(JSON.stringify({ b64: "AAA", ts: 1 }));
    // Chuỗi đã JSON hoá của lượt này chắc chắn khác bản trong kho (ts mới), nhưng b64 thì y hệt.
    expect(await ghiCacheNeuDoiB64(g.kv, "k", "AAA", "AAA", 100)).toBe(false);
    expect(g.soPut()).toBe(0);
    expect(tsCua(g.doc("k"))).toBe(1);   // ts đứng yên vì không có lượt ghi nào
  });

  it("bỏ ghi thì ts ĐỨNG YÊN — đây là chủ ý, không phải lỗi", async () => {
    const g = kvGia();
    await ghiCacheNeuDoiB64(g.kv, "k", "AAA", undefined, 100);
    const tsDau = tsCua(g.doc("k"));
    await ghiCacheNeuDoiB64(g.kv, "k", "AAA", "AAA", 100);
    // ts không nhích lên → lần mở sau lại thấy "cũ hơn mốc quét" và làm mới nền. Đổi lấy việc đó là
    // giữ được lượt ghi, thứ đang khan. Phần tải lặp do nenLamMoiNen chặn — xem nhóm kiểm dưới.
    //
    // Phải chốt bằng SỐ LƯỢT PUT, đừng chốt bằng riêng ts: hai lượt ghi liền nhau có thể rơi vào
    // cùng một milli giây nên `Date.now()` ra số y hệt, và phép kiểm sẽ xanh cả trên bản ghi vô điều
    // kiện. Đã thử thật lúc viết bài này: chỉ so ts thì bản sai vẫn lọt.
    expect(g.soPut()).toBe(1);
    expect(tsCua(g.doc("k"))).toBe(tsDau);
  });

  it("cache ĐỜI CŨ (b64 thô) phải được ghi lại một lượt để đổi sang định dạng {b64, ts}", async () => {
    // Bản cũ lưu thẳng chuỗi b64, không bọc {b64, ts}. Chỗ gọi truyền `undefined` cho bản đời cũ.
    // Nếu lỡ đem nó ra so mà nội dung trùng thì lượt ghi bị bỏ, bản cũ nằm lại mãi với ts=0, và MỖI
    // lượt mở đều kích hoạt tải nền — tiết kiệm được lượt ghi nhưng đổi lấy CPU, đúng bẫy L9.
    const g = kvGia("AAA");
    expect(await ghiCacheNeuDoiB64(g.kv, "k", "AAA", undefined, 100)).toBe(true);
    expect(b64cua(g.doc("k"))).toBe("AAA");     // đọc ra được = đã ở định dạng mới
  });

  it("giữ nguyên hạn cache khi ghi (không âm thầm bỏ expirationTtl)", async () => {
    const g = kvGia();
    await ghiCacheNeuDoiB64(g.kv, "k", "AAA", undefined, 259_200);
    expect(g.ttl).toEqual([259_200]);
  });
});

describe("nenLamMoiNen — chặn tải lặp trong cùng một isolate", () => {
  it("lượt đầu được làm mới, lượt ngay sau đó thì không", () => {
    const gio = Date.parse("2026-09-24T02:00:00Z");
    expect(nenLamMoiNen("sfile:kA", gio)).toBe(true);
    expect(nenLamMoiNen("sfile:kA", gio + 1_000)).toBe(false);
    expect(nenLamMoiNen("sfile:kA", gio + 9 * 60_000)).toBe(false);
  });

  it("quá 10 phút thì cho làm mới lại", () => {
    const gio = Date.parse("2026-09-24T02:00:00Z");
    expect(nenLamMoiNen("sfile:kB", gio)).toBe(true);
    expect(nenLamMoiNen("sfile:kB", gio + 10 * 60_000)).toBe(true);
  });

  it("mỗi khoá cache đếm riêng — file này bị chặn không được làm file khác đứng theo", () => {
    const gio = Date.parse("2026-09-24T02:00:00Z");
    expect(nenLamMoiNen("sfile:kC", gio)).toBe(true);
    expect(nenLamMoiNen("sfile:kC", gio + 1_000)).toBe(false);
    expect(nenLamMoiNen("spdf2:kC::", gio + 1_000)).toBe(true);
  });
});
