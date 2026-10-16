import { spawnSync, spawn } from "node:child_process";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export interface EngineStatus {
  name: string;
  category: "text" | "ast" | "symbol";
  installed: boolean;
  version?: string;
  installCmd?: { cmd: string; args: string[] };
}

function checkToolVersion(tool: string): string | null {
  try {
    const isWin = process.platform === "win32";
    const target = isWin && !tool.endsWith(".exe") && !tool.endsWith(".cmd") ? `${tool}.cmd` : tool;
    
    let res = isWin ? spawnSync(`${tool} --version`, { encoding: "utf8", shell: true }) : spawnSync(tool, ["--version"], { encoding: "utf8" });
    if (res.status === 0 && res.stdout) {
      return res.stdout.split("\n")[0].trim();
    }
    
    if (isWin && target !== tool) {
      res = spawnSync(`${target} --version`, { encoding: "utf8", shell: true });
      if (res.status === 0 && res.stdout) {
        return res.stdout.split("\n")[0].trim();
      }
    }
    return null;
  } catch {
    return null;
  }
}

function getInstallCommand(tool: "ast-grep" | "ripgrep" | "universal-ctags"): { cmd: string; args: string[]; desc: string } {
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";

  if (tool === "ast-grep") {
    return {
      cmd: isWin ? "npm.cmd" : "npm",
      args: ["install", "-g", "@ast-grep/cli"],
      desc: "npm install -g @ast-grep/cli",
    };
  }

  if (tool === "ripgrep") {
    if (isWin) {
      return { cmd: "winget", args: ["install", "BurntSushi.ripgrep.MSVC"], desc: "winget install BurntSushi.ripgrep.MSVC" };
    }
    if (isMac) {
      return { cmd: "brew", args: ["install", "ripgrep"], desc: "brew install ripgrep" };
    }
    return { cmd: "sudo", args: ["apt", "install", "-y", "ripgrep"], desc: "sudo apt install -y ripgrep" };
  }

  // universal-ctags
  if (isWin) {
    return { cmd: "choco", args: ["install", "universal-ctags", "-y"], desc: "choco install universal-ctags -y" };
  }
  if (isMac) {
    return { cmd: "brew", args: ["install", "universal-ctags"], desc: "brew install universal-ctags" };
  }
  return { cmd: "sudo", args: ["apt", "install", "-y", "universal-ctags"], desc: "sudo apt install -y universal-ctags" };
}

function executeInstall(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    console.log(`\n⏳ Running: ${cmd} ${args.join(" ")}\n`);
    const isWin = process.platform === "win32";
    const child = isWin ? spawn(`${cmd} ${args.join(" ")}`, { stdio: "inherit", shell: true }) : spawn(cmd, args, { stdio: "inherit" });

    child.on("close", (code) => {
      resolve(code === 0);
    });

    child.on("error", (err) => {
      console.error(`\n❌ Failed to execute installer: ${err.message}`);
      resolve(false);
    });
  });
}

export async function runEngineCli(): Promise<void> {
  console.log("\n=======================================================");
  console.log("  🔍 Code Search MCP — Engine Status & Manager");
  console.log("=======================================================\n");

  const rgVer = checkToolVersion("rg");
  const ugrepVer = checkToolVersion("ugrep");
  const gitVer = checkToolVersion("git");
  const astVer = checkToolVersion("ast-grep") || checkToolVersion("sg");
  const ctagsVer = checkToolVersion("ctags");

  console.log("[Text Search Engines]");
  console.log(`  ${rgVer ? "✔" : "❌"} ripgrep (rg)      : ${rgVer || "Not found"}`);
  console.log(`  ${ugrepVer ? "✔" : "❌"} ugrep             : ${ugrepVer || "Not found"}`);
  console.log(`  ${gitVer ? "✔" : "❌"} git grep          : ${gitVer || "Not found"}`);
  const activeText = rgVer ? "ripgrep (rg)" : ugrepVer ? "ugrep" : gitVer ? "git grep" : "None";
  console.log(`  ➜ Active Text Engine: ${activeText}\n`);

  console.log("[AST Structural Engines]");
  console.log(`  ${astVer ? "✔" : "❌"} ast-grep (or sg)  : ${astVer || "Not found"}`);
  console.log(`  ➜ Active AST Engine : ${astVer ? "ast-grep" : "None"}\n`);

  console.log("[Symbol Search Engines]");
  console.log(`  ${ctagsVer ? "✔" : "❌"} universal-ctags  : ${ctagsVer || "Not found"}`);
  const activeSymbol = ctagsVer
    ? "universal-ctags"
    : astVer
    ? "ast-grep"
    : rgVer
    ? "ripgrep heuristic"
    : "None";
  console.log(`  ➜ Active Symbol Engine: ${activeSymbol}\n`);

  const missingOptions: { label: string; tool: "ast-grep" | "ripgrep" | "universal-ctags" }[] = [];

  if (!astVer) {
    const inst = getInstallCommand("ast-grep");
    missingOptions.push({ label: `Install ast-grep (${inst.desc})`, tool: "ast-grep" });
  }

  if (!rgVer && !gitVer) {
    const inst = getInstallCommand("ripgrep");
    missingOptions.push({ label: `Install ripgrep (${inst.desc})`, tool: "ripgrep" });
  }

  if (!ctagsVer) {
    const inst = getInstallCommand("universal-ctags");
    missingOptions.push({ label: `Install universal-ctags (${inst.desc})`, tool: "universal-ctags" });
  }

  if (missingOptions.length === 0) {
    console.log("🎉 All recommended engines are installed and ready!\n");
    return;
  }

  console.log("-------------------------------------------------------");
  console.log("Missing engine(s) detected. Choose an option to install:");
  missingOptions.forEach((opt, idx) => {
    console.log(`  ${idx + 1}) ${opt.label}`);
  });
  if (missingOptions.length > 1) {
    console.log(`  ${missingOptions.length + 1}) Install all missing engines`);
  }
  console.log("  0) Exit");
  console.log("-------------------------------------------------------");

  const rl = readline.createInterface({ input, output });

  try {
    const maxChoice = missingOptions.length > 1 ? missingOptions.length + 1 : missingOptions.length;
    const answer = (await rl.question(`Enter choice [0-${maxChoice}]: `)).trim();

    if (answer === "0" || !answer) {
      console.log("\nExited without changes.\n");
      return;
    }

    const choiceNum = parseInt(answer, 10);

    if (choiceNum >= 1 && choiceNum <= missingOptions.length) {
      const selected = missingOptions[choiceNum - 1];
      const cmdInfo = getInstallCommand(selected.tool);
      const success = await executeInstall(cmdInfo.cmd, cmdInfo.args);
      if (success) {
        console.log(`\n✔ Installation of ${selected.tool} completed successfully!\n`);
      } else {
        console.log(`\n❌ Installation encountered an issue. You can manually run: ${cmdInfo.desc}\n`);
      }
    } else if (missingOptions.length > 1 && choiceNum === missingOptions.length + 1) {
      for (const opt of missingOptions) {
        const cmdInfo = getInstallCommand(opt.tool);
        await executeInstall(cmdInfo.cmd, cmdInfo.args);
      }
      console.log("\n✔ All selected installations finished!\n");
    } else {
      console.log("\nInvalid choice. Exited.\n");
    }
  } finally {
    rl.close();
  }
}
