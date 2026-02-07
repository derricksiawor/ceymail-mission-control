import { NextRequest, NextResponse } from "next/server";
import { getMailPool } from "@/lib/db/connection";
import { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { hashPassword } from "@/lib/auth/password";

// GET - Fetch all users with domain names
export async function GET() {
  try {
    const pool = getMailPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT vu.id, vu.domain_id, vu.email, vu.created_at, vd.name as domain_name
       FROM virtual_users vu
       JOIN virtual_domains vd ON vu.domain_id = vd.id
       ORDER BY vu.email`
    );

    return NextResponse.json(rows, { status: 200 });
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json(
      { error: "Failed to fetch users" },
      { status: 500 }
    );
  }
}

// POST - Create a new user
export async function POST(request: NextRequest) {
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

    const { email, password, domain_id } = body as { email?: unknown; password?: unknown; domain_id?: unknown };

    // Validate required fields
    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Email is required and must be a string" },
        { status: 400 }
      );
    }

    if (!password || typeof password !== "string") {
      return NextResponse.json(
        { error: "Password is required and must be a string" },
        { status: 400 }
      );
    }

    if (!domain_id || typeof domain_id !== "number") {
      return NextResponse.json(
        { error: "Domain ID is required and must be a number" },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    // Validate password length (min and max)
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters long" },
        { status: 400 }
      );
    }

    if (password.length > 128) {
      return NextResponse.json(
        { error: "Password must not exceed 128 characters" },
        { status: 400 }
      );
    }

    // Bug 4 fix: Validate password complexity
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);

    if (!hasUppercase || !hasLowercase || !hasDigit || !hasSpecial) {
      return NextResponse.json(
        { error: "Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character" },
        { status: 400 }
      );
    }

    const pool = getMailPool();

    // Verify domain exists
    const [domainRows] = await pool.query<RowDataPacket[]>(
      "SELECT id, name FROM virtual_domains WHERE id = ?",
      [domain_id]
    );

    if (domainRows.length === 0) {
      return NextResponse.json(
        { error: "Domain not found" },
        { status: 404 }
      );
    }

    // Bug 3 fix: Verify email domain matches the domain_id's domain name
    const emailDomain = email.split("@")[1]?.toLowerCase();
    const domainName = (domainRows[0] as RowDataPacket).name?.toLowerCase();

    if (emailDomain !== domainName) {
      return NextResponse.json(
        { error: "Email domain does not match the specified domain" },
        { status: 400 }
      );
    }

    // Hash password with SSHA512 (Salted SHA-512) - Dovecot compatible
    const hashedPassword = hashPassword(password);

    // Insert the user using prepared statement
    const [result] = await pool.query<ResultSetHeader>(
      "INSERT INTO virtual_users (email, password, domain_id) VALUES (?, ?, ?)",
      [email, hashedPassword, domain_id]
    );

    // Fetch the created user with domain name
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT vu.*, vd.name as domain_name
       FROM virtual_users vu
       JOIN virtual_domains vd ON vu.domain_id = vd.id
       WHERE vu.id = ?`,
      [result.insertId]
    );

    // Remove password from response
    const user = rows[0];
    delete user.password;

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    console.error("Error creating user:", error);

    // Handle duplicate entry error
    const dbError = error as { code?: string };
    if (dbError.code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { error: "User with this email already exists" },
        { status: 409 }
      );
    }

    // Handle foreign key constraint errors
    if (dbError.code === "ER_NO_REFERENCED_ROW_2") {
      return NextResponse.json(
        { error: "Invalid domain ID" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create user" },
      { status: 500 }
    );
  }
}

// PATCH - Update user password
export async function PATCH(request: NextRequest) {
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

    const { id, password } = body as { id?: unknown; password?: unknown };

    // Validate ID
    if (!id || typeof id !== "number") {
      return NextResponse.json(
        { error: "User ID is required and must be a number" },
        { status: 400 }
      );
    }

    if (id <= 0) {
      return NextResponse.json(
        { error: "Invalid user ID" },
        { status: 400 }
      );
    }

    // Validate password
    if (!password || typeof password !== "string") {
      return NextResponse.json(
        { error: "Password is required and must be a string" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters long" },
        { status: 400 }
      );
    }

    if (password.length > 128) {
      return NextResponse.json(
        { error: "Password must not exceed 128 characters" },
        { status: 400 }
      );
    }

    // Validate password complexity (PATCH)
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);

    if (!hasUppercase || !hasLowercase || !hasDigit || !hasSpecial) {
      return NextResponse.json(
        { error: "Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character" },
        { status: 400 }
      );
    }

    const pool = getMailPool();

    // Verify user exists
    const [userRows] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM virtual_users WHERE id = ?",
      [id]
    );

    if (userRows.length === 0) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Hash password with SSHA512 (Salted SHA-512) - Dovecot compatible
    const hashedPassword = hashPassword(password);

    // Update the password using prepared statement
    const [result] = await pool.query<ResultSetHeader>(
      "UPDATE virtual_users SET password = ? WHERE id = ?",
      [hashedPassword, id]
    );

    return NextResponse.json(
      { message: "Password updated successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating password:", error);
    return NextResponse.json(
      { error: "Failed to update password" },
      { status: 500 }
    );
  }
}

// DELETE - Delete a user by ID
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get("id");

    // Validate ID
    if (!id) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 }
      );
    }

    const userId = Number(id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json(
        { error: "Invalid user ID" },
        { status: 400 }
      );
    }

    const pool = getMailPool();

    // Delete the user using prepared statement
    const [result] = await pool.query<ResultSetHeader>(
      "DELETE FROM virtual_users WHERE id = ?",
      [userId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: "User deleted successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error deleting user:", error);
    return NextResponse.json(
      { error: "Failed to delete user" },
      { status: 500 }
    );
  }
}
