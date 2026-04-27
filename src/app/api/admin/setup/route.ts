import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { eq } from "drizzle-orm";

// One-time admin setup endpoint
export async function POST() {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || "admin@golite.com";
    const adminPassword = process.env.ADMIN_PASSWORD || "Admin1234";

    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, adminEmail));

    if (existing.length > 0) {
      return NextResponse.json({
        message: "Admin already exists",
        email: adminEmail,
      });
    }

    const hashedPassword = await hashPassword(adminPassword);

    await db.insert(users).values({
      email: adminEmail,
      password: hashedPassword,
      username: "Admin",
      role: "ADMIN",
      subscriptionStatus: "ACTIVE",
      isActive: true,
      tradeMode: "DEMO",
      demoBalance: "10000.00",
    });

    return NextResponse.json({ success: true, email: adminEmail });
  } catch (error) {
    console.error("Admin setup error:", error);
    return NextResponse.json({ error: "Setup failed" }, { status: 500 });
  }
}
