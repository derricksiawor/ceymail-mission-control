import { NextRequest, NextResponse } from "next/server";
import { getMailPool } from "@/lib/db/connection";
import { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { requireAdmin } from "@/lib/api/helpers";

// GET - Fetch all domains
export async function GET(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  try {
    const pool = getMailPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM virtual_domains ORDER BY name"
    );

    return NextResponse.json(rows, { status: 200 });
  } catch (error) {
    console.error("Error fetching domains:", error);
    return NextResponse.json(
      { error: "Failed to fetch domains" },
      { status: 500 }
    );
  }
}

// POST - Create a new domain
export async function POST(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or missing JSON body" }, { status: 400 });
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
    }

    const { name } = body as { name?: unknown };

    // Validate domain name
    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Domain name is required and must be a string" },
        { status: 400 }
      );
    }

    // Basic domain name validation (simple regex)
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
    if (!domainRegex.test(name)) {
      return NextResponse.json(
        { error: "Invalid domain name format" },
        { status: 400 }
      );
    }

    const pool = getMailPool();

    // Insert the domain using prepared statement
    const [result] = await pool.query<ResultSetHeader>(
      "INSERT INTO virtual_domains (name) VALUES (?)",
      [name]
    );

    // Fetch the created domain
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM virtual_domains WHERE id = ?",
      [result.insertId]
    );

    return NextResponse.json(rows[0], { status: 201 });
  } catch (error) {
    console.error("Error creating domain:", error);

    // Handle duplicate entry error
    const dbError = error as { code?: string };
    if (dbError.code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { error: "Domain already exists" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create domain" },
      { status: 500 }
    );
  }
}

// DELETE - Delete a domain by ID
export async function DELETE(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get("id");

    // Validate ID
    if (!id) {
      return NextResponse.json(
        { error: "Domain ID is required" },
        { status: 400 }
      );
    }

    const domainId = Number(id);
    if (!Number.isInteger(domainId) || domainId <= 0) {
      return NextResponse.json(
        { error: "Invalid domain ID" },
        { status: 400 }
      );
    }

    const pool = getMailPool();

    // Delete the domain using prepared statement
    const [result] = await pool.query<ResultSetHeader>(
      "DELETE FROM virtual_domains WHERE id = ?",
      [domainId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { error: "Domain not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: "Domain deleted successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error deleting domain:", error);

    // Handle foreign key constraint errors
    const dbError = error as { code?: string };
    if (dbError.code === "ER_ROW_IS_REFERENCED_2") {
      return NextResponse.json(
        { error: "Cannot delete domain: it has associated users or aliases" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Failed to delete domain" },
      { status: 500 }
    );
  }
}
