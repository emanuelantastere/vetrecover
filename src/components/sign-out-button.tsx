"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return <button className="sign-out-button" disabled={pending} onClick={async () => {
    setPending(true);
    const { error } = await createClient().auth.signOut();
    if (!error) {
      router.replace("/login");
      router.refresh();
    }
    else setPending(false);
  }}>{pending ? "Saindo…" : "Sair"}</button>;
}
