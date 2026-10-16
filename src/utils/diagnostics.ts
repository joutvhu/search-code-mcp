import { safeSpawn } from "./exec.js";

export interface SystemCapabilities {
  text: { available: boolean; engine?: string };
  ast: { available: boolean; engine?: string };
  symbol: { available: boolean; engine?: string };
  fileListing: { available: boolean; engine: string };
}

let cachedCaps: SystemCapabilities | null = null;

/**
 * Actively probe which search engines are currently available on this machine
 */
export async function probeSystemCapabilities(): Promise<SystemCapabilities> {
  if (cachedCaps) return cachedCaps;

  // 1. Probe text search engines (rg -> ugrep -> git)
  let textAvailable = false;
  let textEngine: string | undefined;

  try {
    await safeSpawn("rg", ["--version"]);
    textAvailable = true;
    textEngine = "ripgrep (rg)";
  } catch {
    try {
      await safeSpawn("ugrep", ["--version"]);
      textAvailable = true;
      textEngine = "ugrep";
    } catch {
      try {
        await safeSpawn("git", ["--version"]);
        textAvailable = true;
        textEngine = "git grep";
      } catch {}
    }
  }

  // 2. Probe AST engines (ast-grep -> sg)
  let astAvailable = false;
  let astEngine: string | undefined;

  try {
    await safeSpawn("ast-grep", ["--version"]);
    astAvailable = true;
    astEngine = "ast-grep";
  } catch {
    try {
      await safeSpawn("sg", ["--version"]);
      astAvailable = true;
      astEngine = "sg";
    } catch {}
  }

  // 3. Probe Symbol search engines (ctags -> ast-grep -> ripgrep)
  let symbolAvailable = false;
  let symbolEngine: string | undefined;

  try {
    const res = await safeSpawn("ctags", ["--version"]);
    if (res.stdout.includes("Universal Ctags") || res.stdout.includes("Exuberant Ctags")) {
      symbolAvailable = true;
      symbolEngine = "universal-ctags";
    }
  } catch {}

  if (!symbolAvailable && astAvailable) {
    symbolAvailable = true;
    symbolEngine = "ast-grep (" + astEngine + ")";
  }

  if (!symbolAvailable && textAvailable) {
    symbolAvailable = true;
    symbolEngine = "ripgrep heuristic (" + textEngine + ")";
  }

  cachedCaps = {
    text: { available: textAvailable, engine: textEngine },
    ast: { available: astAvailable, engine: astEngine },
    symbol: { available: symbolAvailable, engine: symbolEngine },
    fileListing: {
      available: true,
      engine: textAvailable ? (textEngine + " (--files)") : "native node fs.readdir",
    },
  };

  return cachedCaps;
}

/**
 * Format an actionable diagnostic error message when an engine is missing
 */
export async function formatMissingEngineError(
  category: "ast" | "text" | "symbol",
  contextHint?: string
): Promise<string> {
  const caps = await probeSystemCapabilities();
  const lines: string[] = [];

  if (category === "ast") {
    lines.push(
      "❌ [Missing Engine] Máy chưa cài đặt công cụ phân tích cú pháp AST ('ast-grep' hoặc 'sg').",
      "",
      "👉 Người dùng vui lòng cài đặt một trong các engine sau để kích hoạt tính năng AST:",
      "   • npm (khuyên dùng): npm install -g @ast-grep/cli",
      "   • Cargo: cargo install ast-grep --locked",
      "   • Homebrew (macOS): brew install ast-grep",
      "   • Windows Choco: choco install ast-grep",
      "   • Windows Winget: winget install ast-grep",
      "",
      "📋 KẾT QUẢ KIỂM TRA HỆ THỐNG (AI Agent dùng ngay danh sách này, KHÔNG CẦN tốn lượt kiểm tra lại PATH):",
      caps.text.available
        ? ("   ✔ Text/Regex Search: SẴN SÀNG (Engine: '" + caps.text.engine + "')")
        : "   ❌ Text/Regex Search: CHƯA CÓ",
      caps.symbol.available
        ? ("   ✔ Symbol Search: SẴN SÀNG (Engine: '" + caps.symbol.engine + "')")
        : "   ❌ Symbol Search: CHƯA CÓ",
      ("   ✔ File Listing: SẴN SÀNG (Engine: '" + caps.fileListing.engine + "')"),
      "   ❌ AST Structural: CHƯA SẴN SÀNG (thiếu ast-grep/sg)",
      "",
      "🤖 CÁC TOOLS VÀ TYPES THAY THẾ KHẢ DỤ NGAY CHO AI AGENT:"
    );

    if (caps.text.available) {
      lines.push(
        "   1. Tool `search`: Chuyển sang `type: \"regex\"` hoặc `type: \"text\"` để tìm kiếm mã nguồn theo regex/text cực nhanh:",
        '      👉 search({ query: "<regex-pattern>", type: "regex", path: "..." })',
        "   2. Tool `replace`: Chuyển sang `type: \"regex\"` hoặc `type: \"text\"` để thay thế an toàn:",
        '      👉 replace({ query: "<regex>", replacement: "<new>", type: "regex", dryRun: true })',
        "   3. Tool `count`: Đếm số lần xuất hiện với `type: \"regex\"`:",
        '      👉 count({ query: "<pattern>", type: "regex" })'
      );
    }

    if (caps.symbol.available) {
      lines.push(
        "   4. Tool `find_symbols`: Để tìm định nghĩa hàm, class, interface, method:",
        '      👉 find_symbols({ name: "...", kinds: ["function", "class"] })'
      );
    }

    lines.push(
      "   5. Tool `list_files`: Liệt kê các file trong dự án:",
      '      👉 list_files({ path: ".", filePattern: "*.ts" })'
    );
  } else if (category === "text") {
    lines.push(
      "❌ [Missing Engine] Máy chưa cài đặt công cụ tìm kiếm văn bản nào ('ripgrep', 'ugrep', hoặc 'git').",
      "",
      "👉 Người dùng vui lòng cài đặt ripgrep hoặc Git để sử dụng:",
      "   • Windows: winget install BurntSushi.ripgrep.MSVC (hoặc choco install ripgrep)",
      "   • macOS: brew install ripgrep",
      "   • Linux: sudo apt install ripgrep (hoặc sudo pacman -S ripgrep)",
      "   • Hoặc cài đặt Git: https://git-scm.com/",
      "",
      "📋 KẾT QUẢ KIỂM TRA HỆ THỐNG (AI Agent dùng ngay danh sách này, KHÔNG CẦN tốn lượt kiểm tra lại PATH):",
      "   ❌ Text/Regex Search: CHƯA CÓ (thiếu rg, ugrep, git)",
      caps.ast.available
        ? ("   ✔ AST Structural Search: SẴN SÀNG (Engine: '" + caps.ast.engine + "')")
        : "   ❌ AST Structural Search: CHƯA CÓ",
      ("   ✔ File Listing: SẴN SÀNG (Engine: '" + caps.fileListing.engine + "')"),
      "",
      "🤖 CÁC TOOLS VÀ TYPES THAY THẾ KHẢ DỤ NGAY CHO AI AGENT:"
    );

    if (caps.ast.available) {
      lines.push(
        "   1. Tool `search`: Dùng `type: \"ast\"` để tìm kiếm theo cú pháp:",
        '      👉 search({ query: "...", type: "ast", language: "..." })',
        "   2. Tool `replace`: Dùng `type: \"ast\"` để thay thế cấu trúc:",
        '      👉 replace({ query: "...", replacement: "...", type: "ast" })'
      );
    }

    lines.push(
      "   3. Tool `list_files`: Vẫn hoạt động bình thường qua native Node.js:",
      '      👉 list_files({ path: ".", filePattern: "*" })',
      "   4. Sử dụng các công cụ đọc file có sẵn trong môi trường IDE của bạn để duyệt file theo danh sách từ list_files."
    );
  } else {
    lines.push(
      "❌ [Missing Engine] Máy chưa có engine phù hợp cho tính năng tìm kiếm Symbol ('ctags', 'ast-grep', 'ripgrep').",
      "",
      "👉 Người dùng vui lòng cài đặt một trong các công cụ sau:",
      "   • Universal Ctags: choco install universal-ctags (hoặc brew install universal-ctags)",
      "   • ripgrep: winget install BurntSushi.ripgrep.MSVC (hoặc brew install ripgrep)",
      "",
      "📋 KẾT QUẢ KIỂM TRA HỆ THỐNG:",
      ("   ✔ File Listing: SẴN SÀNG (Engine: '" + caps.fileListing.engine + "')"),
      "",
      "🤖 CÁC TOOLS KHẢ DỤ NGAY CHO AI AGENT:",
      '   • list_files({ path: "." })'
    );
  }

  if (contextHint) {
    lines.push("", "📌 Ghi chú ngữ cảnh: " + contextHint);
  }

  return lines.join("\n");
}
