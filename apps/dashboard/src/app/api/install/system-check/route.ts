import { NextResponse } from "next/server";
import { execFileSync } from "child_process";
import { readFileSync, existsSync } from "fs";

interface SystemCheckResult {
  label: string;
  value: string;
  status: "pass" | "fail";
  detail: string;
}

// GET - Real system check
export async function GET() {
  try {
    const results: SystemCheckResult[] = [];

    // 1. Operating System Check
    let osName = "Unknown";
    let osPass = false;
    try {
      if (existsSync("/etc/os-release")) {
        const content = readFileSync("/etc/os-release", "utf8");
        const nameMatch = content.match(/PRETTY_NAME="?([^"\n]+)"?/);
        if (nameMatch) osName = nameMatch[1];

        const idMatch = content.match(/^ID=(.+)$/m);
        const versionMatch = content.match(/VERSION_ID="?(\d+)/);
        const id = idMatch ? idMatch[1].replace(/"/g, "") : "";
        const version = versionMatch ? parseInt(versionMatch[1], 10) : 0;

        // Accept Debian 11+ or Ubuntu 20.04+
        if ((id === "debian" && version >= 11) || (id === "ubuntu" && version >= 20)) {
          osPass = true;
        }
      }
    } catch { /* ignore */ }

    results.push({
      label: "Operating System",
      value: osName,
      status: osPass ? "pass" : "fail",
      detail: "Debian 11+ or Ubuntu 20.04+ required",
    });

    // 2. Disk Space Check
    let diskFree = "Unknown";
    let diskPass = false;
    try {
      const output = execFileSync("df", ["-BG", "--output=avail", "/"], {
        encoding: "utf8",
        timeout: 5000,
      });
      const lines = output.trim().split("\n");
      if (lines.length >= 2) {
        const freeStr = lines[1].trim().replace("G", "");
        const freeGb = parseFloat(freeStr);
        diskFree = `${freeGb} GB free`;
        diskPass = freeGb >= 10;
      }
    } catch { /* ignore */ }

    results.push({
      label: "Disk Space",
      value: diskFree,
      status: diskPass ? "pass" : "fail",
      detail: "Minimum 10 GB free space required",
    });

    // 3. RAM Check
    let ramInfo = "Unknown";
    let ramPass = false;
    try {
      const output = readFileSync("/proc/meminfo", "utf8");
      const match = output.match(/MemTotal:\s+(\d+)\s+kB/);
      if (match) {
        const memKb = parseInt(match[1], 10);
        const memGb = (memKb / 1048576).toFixed(1);
        ramInfo = `${memGb} GB`;
        ramPass = memKb >= 1048576; // 1 GB minimum
      }
    } catch { /* ignore */ }

    results.push({
      label: "RAM",
      value: ramInfo,
      status: ramPass ? "pass" : "fail",
      detail: "Minimum 1 GB RAM required",
    });

    // 4. CPU Cores Check
    let cpuInfo = "Unknown";
    let cpuPass = false;
    try {
      const output = execFileSync("nproc", [], { encoding: "utf8", timeout: 5000 }).trim();
      const cores = parseInt(output, 10);
      cpuInfo = `${cores} core${cores > 1 ? "s" : ""}`;
      cpuPass = cores >= 1;
    } catch { /* ignore */ }

    results.push({
      label: "CPU Cores",
      value: cpuInfo,
      status: cpuPass ? "pass" : "fail",
      detail: "Minimum 1 CPU core required",
    });

    // 5. Web Server Detection
    let webServer: "nginx" | "apache" | "none" = "none";
    let webServerInfo = "Not detected";
    try {
      // Check nginx first (common for reverse proxy setups)
      const nginxCheck = execFileSync("which", ["nginx"], { encoding: "utf8", timeout: 3000 }).trim();
      if (nginxCheck) {
        webServer = "nginx";
        try {
          const ver = execFileSync("nginx", ["-v"], { encoding: "utf8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] });
          webServerInfo = (ver || "").trim() || "nginx (installed)";
        } catch (e: unknown) {
          // nginx -v outputs to stderr
          const stderr = (e as { stderr?: string }).stderr || "";
          webServerInfo = stderr.trim() || "nginx (installed)";
        }
      }
    } catch {
      // nginx not found, check apache
      try {
        const apacheCheck = execFileSync("which", ["apache2"], { encoding: "utf8", timeout: 3000 }).trim();
        if (apacheCheck) {
          webServer = "apache";
          try {
            const ver = execFileSync("apache2", ["-v"], { encoding: "utf8", timeout: 3000 });
            const line = (ver || "").split("\n")[0]?.trim() || "Apache (installed)";
            webServerInfo = line;
          } catch {
            webServerInfo = "Apache (installed)";
          }
        }
      } catch { /* neither found */ }
    }

    results.push({
      label: "Web Server",
      value: webServerInfo,
      status: webServer !== "none" ? "pass" : "fail",
      detail: "nginx or Apache required for SSL termination",
    });

    return NextResponse.json({ checks: results, webServer });
  } catch (error) {
    console.error("Error running system check:", error);
    return NextResponse.json(
      { error: "Failed to run system check" },
      { status: 500 }
    );
  }
}
