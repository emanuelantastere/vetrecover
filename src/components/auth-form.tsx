"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AuthForm({ reason }: { reason?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [clinicName, setClinicName] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const supabase = createClient();
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { clinic_name: clinicName.trim() },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/`,
          },
        });
        if (error) throw error;
        if (!data.session) {
          setMessage("Conta criada. Confira seu e-mail para confirmar o endereço e acessar a clínica.");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setMessage(mode === "signin" ? "Não foi possível entrar. Confira seus dados ou tente novamente." : "Não foi possível criar a conta. Confira os dados e tente novamente.");
    } finally {
      setPending(false);
    }
  }

  return <form className="auth-form" onSubmit={submit}>
    {reason === "expired" && <div className="auth-notice" role="status">Sua sessão terminou. Entre novamente para continuar.</div>}
    {reason === "callback" && <div className="auth-notice" role="status">Não foi possível validar o link. Solicite um novo e-mail de confirmação.</div>}
    {reason === "connection" && <div className="auth-notice" role="status">Não foi possível validar a sessão agora. Confira a conexão com Supabase e tente novamente.</div>}
    <label>E-mail<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    {mode === "signup" && <label>Nome da clínica<input type="text" autoComplete="organization" minLength={2} maxLength={120} required value={clinicName} onChange={(event) => setClinicName(event.target.value)} /></label>}
    <label>Senha<input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={mode === "signup" ? 12 : 1} required value={password} onChange={(event) => setPassword(event.target.value)} />{mode === "signup" && <small>Use pelo menos 12 caracteres.</small>}</label>
    {message && <div className="auth-notice" role="status">{message}</div>}
    <button className="primary-button auth-submit" type="submit" disabled={pending}>{pending ? "Aguarde…" : mode === "signin" ? "Entrar na clínica" : "Criar conta e clínica"}</button>
    <p className="auth-switch">{mode === "signin" ? "Ainda não tem uma conta?" : "Já tem uma conta?"} <button type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); }}>{mode === "signin" ? "Criar conta" : "Entrar"}</button></p>
  </form>;
}
