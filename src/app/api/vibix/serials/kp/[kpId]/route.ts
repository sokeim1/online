import { NextRequest, NextResponse } from "next/server";

import { getVibixSerialByKpId } from "@/lib/vibix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ kpId: string }> },
) {
  const { kpId } = await params;
  const id = Number(kpId);

  if (!Number.isFinite(id)) {
    return NextResponse.json(
      { success: false, message: "Invalid kpId" },
      { status: 400 },
    );
  }

  try {
    const data = await getVibixSerialByKpId(id);
    return NextResponse.json({ success: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { success: false, message },
      {
        status: 500,
      },
    );
  }
}
