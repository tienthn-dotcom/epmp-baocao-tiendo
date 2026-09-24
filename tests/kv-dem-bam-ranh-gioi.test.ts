/**
 * RANH GIỚI của đồng hồ đo băm — xem V2b ở sổ bàn giao.
 *
 * `tests/kv-dem-bam.test.ts` đã chốt ĐƯỜNG CHÍNH: băm ổn định, dòng đếm có băm, D1 chết thì không
 * ném. File này soi ba chỗ đường chính CHƯA với tới:
 *
 *   1. RÀNG BUỘC 2 của đặc tả — "băm hỏng thì ghi chuỗi rỗng, KHÔNG ném". Phép kiểm L14 bên kia cho
 *      **D1** hỏng, không phải cho **BĂM** hỏng. Hai chuyện khác nhau: băm chạy TRƯỚC câu chèn, nên
 *      băm ném lỗi thì hỏng theo một đường khác hẳn. `demGhiKv` chạy ở MỌI đường ghi KV, nên đây là
 *      chỗ nặng nhất của cả việc này.
 *   2. MỐC CẮT 128 KB — Thực thi nêu thẳng đánh đổi, nhưng chưa phép kiểm nào CHỐT nó. Không chốt
 *      thì người sau tưởng cột `bam` chính xác với mọi kho, rồi kết luận sai về `sfile:`.
 *   3. CÂU `ALTER TABLE` — cột `bam` trên production chỉ có được nhờ câu này. Bỏ nó đi thì cả 11
 *      phép kiểm bên kia VẪN XANH, mà đồng hồ thì không bao giờ chạy.
 *
 * Gọi thẳng hàm thật trong src/lib/kv-dem.ts, không chép luật sang đây.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { bamNgan, demGhiKv } from "@/lib/kv-dem";

/** Mốc cắt trong kv-dem.ts. Chép lại con số để phép kiểm nói rõ mình đang soi mốc nào. */
const CAT = 131_072; // 128 KB

type Cau = { sql: string; tham: unknown[] };

/** D1 giả — giữ lại MỌI câu lệnh đã chạy, để soi được cả phần dựng bảng lẫn phần chèn. */
function d1Gia(opt?: { alterHong?: boolean }) {
  const cau: Cau[] = [];
  const d1 = {
    prepare(sql: string) {
      const chay = async () => {
        if (opt?.alterHong && sql.startsWith("ALTER")) throw new Error("duplicate column name: bam");
        return {};
      };
      return {
        bind: (...tham: unknown[]) => ({ run: async () => { const r = await chay(); cau.push({ sql, tham }); return r; } }),
        run: async () => { const r = await chay(); cau.push({ sql, tham: [] }); return r; },
      };
    },
  };
  return {
    d1,
    tatCa: () => cau,
    chen: () => cau.filter((c) => c.sql.startsWith("INSERT")),
    demCau: (dau: string) => cau.filter((c) => c.sql.startsWith(dau)).length,
  };
}

type CoEnv = { __env__?: unknown };
const g = globalThis as CoEnv;

/** Nạp lại module để `banSan` về false — nếu không, chỉ lượt gọi ĐẦU TIÊN mới dựng bảng. */
async function napMoi() {
  vi.resetModules();
  return (await import("@/lib/kv-dem")) as { bamNgan: typeof bamNgan; demGhiKv: typeof demGhiKv };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete g.__env__;
});

/** Thay `crypto` bằng một bản LUÔN NÉM, giống hệt một runtime không có Web Crypto. */
function bamLuonNem() {
  vi.stubGlobal("crypto", {
    subtle: { digest: () => { throw new Error("runtime nay khong co crypto.subtle"); } },
  });
}

describe("RÀNG BUỘC 2 — băm hỏng KHÔNG được chặn lượt ghi KV", () => {
  it("ĐỐI CHỨNG: bản băm KHÔNG có lớp đỡ thì cái bẫy này thật sự làm nó ném", async () => {
    // Phép kiểm nào cũng phải tự chứng minh mình có răng. Nếu `crypto` giả bên dưới không thật sự
    // phá được một phép băm, thì ba phép kiểm sau đây xanh mà chẳng chứng minh điều gì.
    bamLuonNem();
    const bamKhongDo = async (s: string) =>
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
    await expect(bamKhongDo("bat ky")).rejects.toThrow();
  });

  it("crypto.subtle ném lỗi → băm trả CHUỖI RỖNG, không ném ra ngoài", async () => {
    bamLuonNem();
    await expect(bamNgan("noi dung that")).resolves.toBe("");
  });

  it("runtime KHÔNG CÓ crypto.subtle → băm trả chuỗi rỗng, không ném", async () => {
    // Workers là runtime chưa ai kiểm được trên máy. Nếu ở đó không có `subtle` thì đây là đường đi.
    vi.stubGlobal("crypto", {});
    await expect(bamNgan("noi dung that")).resolves.toBe("");
  });

  it("băm hỏng → dòng đếm VẪN được ghi, đúng một dòng, băm rỗng, tên kho vẫn đúng", async () => {
    // Mất cái băm thì chỉ mất phép đo. Mất dòng đếm là mù hẳn hạn mức KV — xem L9.
    bamLuonNem();
    const f = d1Gia();
    g.__env__ = { PMO_LOG: f.d1 };
    const { demGhiKv: dem } = await napMoi();
    await dem("mtld:install:list:v2", '{"du":"lieu that"}');
    const chen = f.chen();
    expect(chen.length).toBe(1);
    expect(chen[0].tham[1]).toBe("mtld");
    expect(chen[0].tham[2]).toBe("");
  });

  it("băm hỏng → lượt PUT thật vẫn đi qua và người gọi không thấy lỗi", async () => {
    // Dựng lại phép L14 từ đầu thay vì tin báo cáo: chốt bằng SỐ LƯỢT PUT, không chốt bằng dấu vết
    // gián tiếp. Đây là hình dạng `bocKv` thật ở mtld-install.functions.ts:38 và
    // edits.functions.ts:166 — ghi KV trước, đếm sau.
    bamLuonNem();
    const f = d1Gia();
    g.__env__ = { PMO_LOG: f.d1 };
    const { demGhiKv: dem } = await napMoi();
    let soPut = 0;
    const kv = { put: async (_k: string, _v: string) => { soPut++; } };
    const boc = async (k: string, v: string) => { await kv.put(k, v); await dem(k, v); };
    await expect(boc("mtld:install:list:v2", "noi dung")).resolves.toBeUndefined();
    expect(soPut).toBe(1);
  });
});

describe("MỐC CẮT 128 KB — chốt lại giới hạn, đừng để người sau tưởng cột này chính xác mọi kho", () => {
  it("NGAY DƯỚI mốc: hai payload khác nhau ở ký tự cuối → HAI băm khác nhau", async () => {
    const a = "a".repeat(CAT - 2) + "X";
    const b = "a".repeat(CAT - 2) + "Y";
    expect(a.length).toBe(CAT - 1);
    expect(await bamNgan(a)).not.toBe(await bamNgan(b));
  });

  it("ĐÚNG BẰNG mốc: vẫn băm TRỌN, hai payload khác nhau vẫn ra hai băm khác nhau", async () => {
    const a = "a".repeat(CAT - 1) + "X";
    const b = "a".repeat(CAT - 1) + "Y";
    expect(a.length).toBe(CAT);
    expect(await bamNgan(a)).not.toBe(await bamNgan(b));
  });

  it("NGAY TRÊN mốc: phần sau mốc bị bỏ — hai payload KHÁC NHAU ra CÙNG một băm", async () => {
    // ĐÂY LÀ GIỚI HẠN ĐÃ BIẾT, không phải lỗi. Thực thi chọn cắt để không đốt CPU trên kho `sfile:`
    // (file .xlsx base64, có bản trên 2MB) — trần CPU mỗi lượt Worker khoảng 2.010.000 µs, xem L9.
    // Chốt lại ở đây để ai đọc cột `bam` còn biết: nó CHỈ hứa chính xác với kho `mtld`.
    const a = "a".repeat(CAT) + "X";
    const b = "a".repeat(CAT) + "Y";
    expect(a.length).toBe(CAT + 1);
    expect(await bamNgan(a)).toBe(await bamNgan(b));
  });

  it("khác ĐỘ DÀI thì vẫn khác băm, dù trùng nhau suốt phần trước mốc cắt", async () => {
    const a = "a".repeat(CAT) + "XX";
    const b = "a".repeat(CAT) + "YYY";
    expect(await bamNgan(a)).not.toBe(await bamNgan(b));
  });
});

describe("CHUỖI — rỗng, khoảng trắng, dấu tiếng Việt", () => {
  it("Ô TRỐNG và Ô TOÀN KHOẢNG TRẮNG là hai thứ KHÁC nhau", async () => {
    // Luật 5.2: ô trống nghĩa là KHÔNG BIẾT, không phải bằng không. Một payload toàn khoảng trắng
    // là payload CÓ nội dung, phải có băm thật, không được rơi về rỗng như đường delete.
    expect(await bamNgan("")).toBe("");
    expect(await bamNgan("   ")).toMatch(/^[0-9a-f]{12}$/);
  });

  it("số lượng khoảng trắng khác nhau → băm khác nhau, không bị cắt hai đầu", async () => {
    expect(await bamNgan(" ")).not.toBe(await bamNgan("  "));
    expect(await bamNgan("abc")).not.toBe(await bamNgan("abc "));
  });

  it("chữ HOA và chữ thường ra hai băm khác nhau", async () => {
    expect(await bamNgan("Sun Group")).not.toBe(await bamNgan("sun group"));
  });

  it("CHỮ NHÌN GIỐNG HỆT NHAU mà dựng bằng hai lối gõ dấu → HAI băm khác nhau", async () => {
    // Tiếng Việt có hai cách dựng cùng một chữ: dựng sẵn (NFC) và tổ hợp (NFD). Trên màn hình chúng
    // giống hệt nhau, nhưng là hai chuỗi byte khác nhau nên ra hai băm khác nhau.
    // KHÔNG phải lỗi — băm đang làm đúng việc của nó. Nhưng ai đọc số phải biết: nếu nguồn Master
    // Plan lẫn cả hai lối gõ, cột `bam` sẽ báo "hai nội dung khác nhau" cho hai thứ mắt thường thấy
    // như một. Đọc nhầm chỗ này là kết luận sai về câu hỏi 63 lượt ghi.
    const dungSan = "Dự án Sun Group";
    const toHop = dungSan.normalize("NFD");
    expect(toHop).not.toBe(dungSan);
    expect(await bamNgan(toHop)).not.toBe(await bamNgan(dungSan));
  });

  it("băm KHÔNG chứa lại nội dung — chỉ 12 ký tự hex, đọc ngược không ra tên dự án", async () => {
    // Ràng buộc 1: đây là bảng ĐẾM, không phải nhật ký nội dung.
    const bam = await bamNgan('{"ten":"Sun Ha Long","ma":"SHL-01"}');
    expect(bam).toMatch(/^[0-9a-f]{12}$/);
    expect(bam).not.toContain("Sun");
    expect(bam.length).toBe(12);
  });
});

describe("DỰNG BẢNG — câu ALTER là thứ duy nhất tạo ra cột bam trên production", () => {
  it("lượt dựng bảng đầu tiên PHẢI phát ra câu ALTER TABLE thêm cột bam", async () => {
    // Bảng `kv_write` đã có sẵn trên production từ trước. `CREATE TABLE IF NOT EXISTS` KHÔNG bao giờ
    // thêm cột cho một bảng đang tồn tại — nên bỏ câu ALTER đi thì cột `bam` không bao giờ có, câu
    // chèn ba cột hỏng mãi, đường lùi nuốt lỗi, và đồng hồ đứng im mà không ai được báo.
    const f = d1Gia();
    g.__env__ = { PMO_LOG: f.d1 };
    const { demGhiKv: dem } = await napMoi();
    await dem("mtld:x", "noi dung");
    const alter = f.tatCa().filter((c) => c.sql.startsWith("ALTER"));
    expect(alter.length).toBe(1);
    expect(alter[0].sql).toContain("kv_write");
    expect(alter[0].sql).toContain("bam");
  });

  it("ALTER ném lỗi 'đã có cột' → dòng đếm vẫn ghi ĐỦ BA CỘT, băm không mất", async () => {
    // Đây là đường đi THẬT khi deploy: Plan đã thêm cột tay trên production 24/09, nên câu ALTER sẽ
    // ném ngay lượt đầu. Nuốt lỗi đó là đúng, nhưng phải nuốt mà vẫn chèn được cả băm.
    const f = d1Gia({ alterHong: true });
    g.__env__ = { PMO_LOG: f.d1 };
    const { demGhiKv: dem, bamNgan: bam } = await napMoi();
    await dem("mtld:install:list:v2", "noi dung that");
    const chen = f.chen();
    expect(chen.length).toBe(1);
    expect(chen[0].sql).toContain("bam");
    expect(chen[0].tham[2]).toBe(await bam("noi dung that"));
  });

  it("gọi nhiều lượt chỉ dựng bảng MỘT lần — không nện D1 mỗi lượt ghi KV", async () => {
    const f = d1Gia();
    g.__env__ = { PMO_LOG: f.d1 };
    const { demGhiKv: dem } = await napMoi();
    await dem("mtld:x", "mot");
    await dem("mtld:x", "hai");
    await dem("edits:y", "ba");
    expect(f.demCau("CREATE TABLE")).toBe(1);
    expect(f.demCau("ALTER")).toBe(1);
    expect(f.chen().length).toBe(3);
  });

  it("ĐƯỜNG DELETE gọi thiếu tham số → băm rỗng mà dòng đếm VẪN ghi", async () => {
    // edits.functions.ts:167 gọi `demGhiKv(key)` kiểu cũ, một tham số. Xoá mà mất dòng đếm thì bảng
    // đếm hụt số ngay ở đường đang nghi ăn hạn mức.
    const f = d1Gia();
    g.__env__ = { PMO_LOG: f.d1 };
    const { demGhiKv: dem } = await napMoi();
    await dem("edits:du-an-123");
    const chen = f.chen();
    expect(chen.length).toBe(1);
    expect(chen[0].tham[1]).toBe("edits");
    expect(chen[0].tham[2]).toBe("");
  });
});
