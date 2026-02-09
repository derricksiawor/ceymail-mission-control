import { NextRequest, NextResponse } from "next/server";
import { existsSync, statSync, createReadStream } from "fs";
import { join, resolve } from "path";
import { requireAdmin } from "@/lib/api/helpers";

const BACKUP_DIR = "/var/backups/ceymail";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const { id } = await params;

  // Validate ID format: only alphanumeric, dash, underscore
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: "Invalid backup ID" }, { status: 400 });
  }

  const filepath = resolve(join(BACKUP_DIR, `${id}.tar.gz`));

  // Defense-in-depth: ensure resolved path stays within backup directory
  if (!filepath.startsWith(BACKUP_DIR + "/")) {
    return NextResponse.json({ error: "Invalid backup ID" }, { status: 400 });
  }

  if (!existsSync(filepath)) {
    return NextResponse.json({ error: "Backup not found" }, { status: 404 });
  }

  try {
    const stat = statSync(filepath);

    // Stream the file instead of loading it entirely into memory
    const stream = createReadStream(filepath);
    const readableStream = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk: Buffer | string) => {
          const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
          controller.enqueue(new Uint8Array(buf));
        });
        stream.on("end", () => {
          controller.close();
        });
        stream.on("error", (err) => {
          controller.error(err);
        });
      },
      cancel() {
        stream.destroy();
      },
    });

    return new NextResponse(readableStream, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${id}.tar.gz"`,
        "Content-Length": String(stat.size),
      },
    });
  } catch (error) {
    console.error("Error downloading backup:", error);
    return NextResponse.json(
      { error: "Failed to download backup" },
      { status: 500 }
    );
  }
}
