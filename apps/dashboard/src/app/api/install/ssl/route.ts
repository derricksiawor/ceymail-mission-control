import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "child_process";
import { requireAdmin } from "@/lib/api/helpers";

// POST - Request SSL certificate via certbot
export async function POST(request: NextRequest) {
  try {
    const denied = requireAdmin(request);
    if (denied) return denied;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or missing JSON body" }, { status: 400 });
    }

    const { hostname, adminEmail, webServer = "apache" } = body as {
      hostname?: string;
      adminEmail?: string;
      webServer?: "nginx" | "apache";
    };

    if (!hostname || typeof hostname !== "string") {
      return NextResponse.json({ error: "Hostname is required" }, { status: 400 });
    }

    // Validate hostname format
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(hostname)) {
      return NextResponse.json({ error: "Invalid hostname format" }, { status: 400 });
    }

    if (!adminEmail || typeof adminEmail !== "string") {
      return NextResponse.json({ error: "Admin email is required" }, { status: 400 });
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    // Run certbot via sudo with deploy hook to reload mail services on renewal
    const deployHook = "systemctl reload postfix 2>/dev/null; systemctl restart dovecot 2>/dev/null; true";
    const result = spawnSync(
      "/usr/bin/sudo",
      [
        "/usr/bin/certbot",
        "certonly",
        webServer === "nginx" ? "--nginx" : "--apache",
        "-d", hostname,
        "--non-interactive",
        "--agree-tos",
        "--email", adminEmail,
        "--no-eff-email",
        "--deploy-hook", deployHook,
      ],
      { encoding: "utf8", timeout: 120000 } // 2 min timeout
    );

    const output = ((result.stdout || "") + (result.stderr || "")).slice(-1000);

    if (result.status === 0) {
      return NextResponse.json({
        success: true,
        hostname,
        message: `SSL certificate issued for ${hostname}. Auto-renewal enabled.`,
        output,
      });
    }

    // Check if cert already exists
    if (output.includes("already exists")) {
      return NextResponse.json({
        success: true,
        hostname,
        message: `SSL certificate for ${hostname} already exists. Auto-renewal enabled.`,
        output,
      });
    }

    console.error("Certbot failed:", output);
    return NextResponse.json({
      success: false,
      hostname,
      message: `Failed to obtain SSL certificate: ${output.slice(-300)}`,
      output,
    }, { status: 500 });
  } catch (error) {
    console.error("Error in SSL setup:", error);
    return NextResponse.json(
      { error: "Failed to set up SSL" },
      { status: 500 }
    );
  }
}
