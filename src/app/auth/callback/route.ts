import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export async function GET(request: NextRequest) {
  if (!getSupabasePublicConfig()) return NextResponse.redirect(new URL("/login", request.url));
  const code = request.nextUrl.searchParams.get("code");
  const requestedNext = request.nextUrl.searchParams.get("next") ?? "/";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/";
  if (!code) return NextResponse.redirect(new URL("/login?reason=callback", request.url));

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?reason=callback", request.url));
  return NextResponse.redirect(new URL(next, request.url));
}
