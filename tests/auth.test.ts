import { describe, it, expect } from "vitest";
import { decideAccess, signSession, verifySession, readCookie, cookieHeader, bangNhauAnToan, ROBOT_EMAIL } from "../src/lib/auth";

const DS = ["tienthn@aacorporation.com", "sep@aacorporation.com"];

describe("decideAccess — ai được vào", () => {
  it("email trong danh sách → cho vào", () => {
    expect(decideAccess("tienthn@aacorporation.com", "aacorporation.com", DS).ok).toBe(true);
  });

  it("không phân biệt HOA/thường và khoảng trắng thừa", () => {
    expect(decideAccess("  TienThN@AACorporation.com  ", "aacorporation.com", DS).ok).toBe(true);
  });

  it("email ngoài danh sách → chặn, dù đúng domain công ty", () => {
    const r = decideAccess("nhanvien@aacorporation.com", "aacorporation.com", DS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("chưa được cấp quyền");
  });

  it("email rỗng → chặn", () => {
    expect(decideAccess("", undefined, DS).ok).toBe(false);
  });

  /* Đây là test QUAN TRỌNG NHẤT của cả file. Nếu ai đó sửa readAllowlist/decideAccess theo
     hướng "chưa cấu hình thì cho qua cho tiện", app sẽ mở toang mà NHÌN VẪN NHƯ ĐÃ KHOÁ —
     hỏng kiểu im lặng, nguy hơn hẳn không có đăng nhập. */
  it("CHƯA có danh sách (null) → CHẶN HẾT, tuyệt đối không được hiểu là không giới hạn", () => {
    const r = decideAccess("tienthn@aacorporation.com", "aacorporation.com", null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("chưa được cấu hình");
  });

  it("danh sách RỖNG → chặn hết (khác null, nhưng cũng không ai vào được)", () => {
    expect(decideAccess("tienthn@aacorporation.com", "aacorporation.com", []).ok).toBe(false);
  });

  describe('chế độ MỞ THEO DOMAIN — danh sách ["*"]', () => {
    const MO = ["*"];
    it("ai có email @aacorporation.com (kèm hd khớp) → vào", () => {
      expect(decideAccess("nhanvien@aacorporation.com", "aacorporation.com", MO, "aacorporation.com").ok).toBe(true);
    });
    it("không phân biệt hoa/thường", () => {
      expect(decideAccess("NhanVien@AACorporation.com", "aacorporation.com", MO, "aacorporation.com").ok).toBe(true);
    });
    it("email domain KHÁC → chặn", () => {
      const r = decideAccess("ai@gmail.com", "gmail.com", MO, "aacorporation.com");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("aacorporation.com");
    });
    it("mạo domain qua subdomain (@x.aacorporation.com.evil.com) → chặn", () => {
      // endsWith("@aacorporation.com") phải KHÔNG khớp chuỗi này.
      expect(decideAccess("ke@aacorporation.com.evil.com", undefined, MO, "aacorporation.com").ok).toBe(false);
    });
    it('"*" nhưng KHÔNG cấu hình ALLOWED_HD → chặn hết (không mở cho cả internet)', () => {
      const r = decideAccess("ai@dau-do.com", "dau-do.com", MO, undefined);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("domain công ty");
    });
    it('email đúng domain nhưng hd Google trả KHÁC → chặn (không phải tài khoản Workspace thật)', () => {
      expect(decideAccess("x@aacorporation.com", "khac.com", MO, "aacorporation.com").ok).toBe(false);
    });
    it('cho phép NGOẠI LỆ ngoài domain nếu liệt kê cùng "*"', () => {
      const list = ["*", "doitac@ngoai.com"];
      expect(decideAccess("doitac@ngoai.com", undefined, list, "aacorporation.com").ok).toBe(true);
      expect(decideAccess("nguoila@ngoai.com", undefined, list, "aacorporation.com").ok).toBe(false);
    });
  });

  describe("khi có siết thêm theo domain Workspace (ALLOWED_HD)", () => {
    it("đúng domain + trong danh sách → cho vào", () => {
      expect(decideAccess("tienthn@aacorporation.com", "aacorporation.com", DS, "aacorporation.com").ok).toBe(true);
    });
    it("SAI domain → chặn, kể cả khi email nằm trong danh sách", () => {
      // Ca thật: lỡ thêm nhầm email gmail cá nhân vào danh sách → lớp domain đỡ được.
      const r = decideAccess("tienthn@aacorporation.com", "gmail.com", DS, "aacorporation.com");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("aacorporation.com");
    });
    it("tài khoản Gmail thường (không có hd) → chặn", () => {
      expect(decideAccess("tienthn@aacorporation.com", undefined, DS, "aacorporation.com").ok).toBe(false);
    });
  });
});

describe("cookie phiên — ký và mở", () => {
  const SECRET = "khoa-bi-mat-dung-de-test-cho-du-dai";
  const mk = (email: string, ttl = 3600) => ({ email, name: "Tiên", exp: Math.floor(Date.now() / 1000) + ttl });

  it("ký xong mở lại ra đúng nội dung", async () => {
    const t = await signSession(mk("a@b.com"), SECRET);
    const s = await verifySession(t, SECRET);
    expect(s?.email).toBe("a@b.com");
  });

  it("SỬA nội dung cookie → chữ ký sai → bị loại", async () => {
    // Ca tấn công thật: người dùng tự đổi email trong cookie thành sếp để xem báo cáo.
    const t = await signSession(mk("nguoingoai@x.com"), SECRET);
    const gia = btoa(JSON.stringify(mk("sep@aacorporation.com"))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const doi = gia + "." + t.split(".")[1];
    expect(await verifySession(doi, SECRET)).toBeNull();
  });

  it("ký bằng secret khác → bị loại", async () => {
    const t = await signSession(mk("a@b.com"), "secret-cua-ke-khac");
    expect(await verifySession(t, SECRET)).toBeNull();
  });

  it("phiên hết hạn → bị loại", async () => {
    const t = await signSession(mk("a@b.com", -10), SECRET);
    expect(await verifySession(t, SECRET)).toBeNull();
  });

  it("cookie rỗng / rác → bị loại, không văng lỗi", async () => {
    expect(await verifySession(null, SECRET)).toBeNull();
    expect(await verifySession("", SECRET)).toBeNull();
    expect(await verifySession("khong-co-dau-cham", SECRET)).toBeNull();
    expect(await verifySession("aaa.bbb", SECRET)).toBeNull();
  });
});

describe("đọc cookie từ request", () => {
  const req = (c: string) => new Request("https://x.test/", { headers: { cookie: c } });
  it("lấy đúng cookie giữa nhiều cookie khác", () => {
    expect(readCookie(req("a=1; epmp_session=abc; b=2"), "epmp_session")).toBe("abc");
  });
  it("không có thì trả null", () => {
    expect(readCookie(req("a=1"), "epmp_session")).toBeNull();
    expect(readCookie(new Request("https://x.test/"), "epmp_session")).toBeNull();
  });
});

describe("thuộc tính cookie", () => {
  it("HTTPS → có Secure; localhost (http) → KHÔNG có Secure", () => {
    // Gắn Secure trên http là trình duyệt bỏ cookie ⇒ đăng nhập ở máy dev quay vòng vô tận.
    expect(cookieHeader("x", "1", 60, true)).toContain("Secure");
    expect(cookieHeader("x", "1", 60, false)).not.toContain("Secure");
  });
  it("luôn có HttpOnly và SameSite=Lax", () => {
    const h = cookieHeader("x", "1", 60, true);
    expect(h).toContain("HttpOnly");   // JS không đọc được ⇒ XSS không cuỗm được phiên
    expect(h).toContain("SameSite=Lax"); // Strict thì callback từ Google không gửi cookie
  });
});

/* CHÌA RIÊNG CHO MÁY — chuỗi bí mật để warmer tự bấm nút "Cập nhật bản gửi mail" thứ Tư 20:00.
 * Đây là một ĐƯỜNG VÀO app đang có 10-17 người dùng, nên phép so chuỗi phải kín. */
describe("so chuỗi bí mật", () => {
  it("trùng thì nhận", () => expect(bangNhauAnToan("abc123", "abc123")).toBe(true));
  it("lệch một ký tự thì chặn", () => expect(bangNhauAnToan("abc123", "abc124")).toBe(false));
  it("khác độ dài thì chặn", () => expect(bangNhauAnToan("abc", "abc1")).toBe(false));
  it("rỗng không khớp chuỗi thật", () => expect(bangNhauAnToan("", "abc")).toBe(false));
  /* GÁC: chuỗi rỗng khớp chuỗi rỗng là ĐÚNG về mặt so sánh, nên nhánh gọi phải tự chặn chuỗi
     rỗng (`dua && bangNhauAnToan(...)` trong auth-gate.ts). Ghi lại đây để ai đọc test biết
     chỗ chặn nằm ở đâu, đừng tưởng hàm này lo. */
  it("rỗng khớp rỗng — nên nhánh gọi PHẢI tự chặn chuỗi rỗng", () => {
    expect(bangNhauAnToan("", "")).toBe(true);
  });
  it("so bao nhiêu lần cũng cùng kết quả, không phụ thuộc vị trí lệch", () => {
    const that = "x".repeat(64);
    expect(bangNhauAnToan("y" + that.slice(1), that)).toBe(false);
    expect(bangNhauAnToan(that.slice(0, 63) + "y", that)).toBe(false);
  });
});

describe("danh tính của máy", () => {
  /* Phải là một email RIÊNG, KHÔNG phải email người thật: nhật ký giám sát ghi đúng là máy làm.
     Đổi chuỗi này thì chốt quyền trong saveComplianceReportPdf không khớp nữa và máy mất quyền
     ghi báo cáo — nên gác lại. */
  it("là email riêng của máy, không phải người", () => {
    expect(ROBOT_EMAIL).toBe("robot-tuanthu@aacorporation.com");
  });
  it("phiên của máy ký và đọc lại được như phiên thường", async () => {
    const bm = "bi-mat-de-test";
    const t = await signSession({ email: ROBOT_EMAIL, name: "ePMP tự động", exp: Math.floor(Date.now() / 1000) + 600 }, bm);
    const p = await verifySession(t, bm);
    expect(p?.email).toBe(ROBOT_EMAIL);
  });
  it("phiên của máy HẾT HẠN thì không đọc được nữa", async () => {
    const bm = "bi-mat-de-test";
    const t = await signSession({ email: ROBOT_EMAIL, name: "ePMP tự động", exp: Math.floor(Date.now() / 1000) - 1 }, bm);
    expect(await verifySession(t, bm)).toBeNull();
  });
  it("ký bằng bí mật khác thì không đọc được", async () => {
    const t = await signSession({ email: ROBOT_EMAIL, name: "x", exp: Math.floor(Date.now() / 1000) + 600 }, "bi-mat-A");
    expect(await verifySession(t, "bi-mat-B")).toBeNull();
  });
});
