import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// POST - Request SSL certificate via certbot
export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or missing JSON body" }, { status: 400 });
    }

    const { hostname, adminEmail } = body as {
      hostname?: string;
      adminEmail?: string;
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

    // Run certbot
    try {
      const { stdout, stderr } = await execFileAsync(
        "certbot",
        [
          "certonly",
          "--apache",
          "-d", hostname,
          "--non-interactive",
          "--agree-tos",
          "--email", adminEmail,
          "--no-eff-email",
        ],
        { encoding: "utf8", timeout: 120000 } // 2 min timeout
      );

      return NextResponse.json({
        success: true,
        hostname,
        message: `SSL certificate issued for ${hostname}. Auto-renewal enabled.`,
        output: (stdout + stderr).slice(-1000),
      });
    } catch (certError: any) {
      // Check if cert already exists
      if (certError.stderr?.includes("already exists")) {
        return NextResponse.json({
          success: true,
          hostname,
          message: `SSL certificate for ${hostname} already exists. Auto-renewal enabled.`,
          output: certError.stderr.slice(-500),
        });
      }

      console.error("Certbot failed:", certError);
      return NextResponse.json({
        success: false,
        hostname,
        message: `Failed to obtain SSL certificate: ${certError.stderr?.slice(-300) || certError.message}`,
        output: certError.stderr?.slice(-1000) || certError.message,
      }, { status: 500 });
    }
  } catch (error) {
    console.error("Error in SSL setup:", error);
    return NextResponse.json(
      { error: "Failed to set up SSL" },
      { status: 500 }
    );
  }
}
