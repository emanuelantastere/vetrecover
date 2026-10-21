import { AuthForm } from "@/components/auth-form";
import { SystemState } from "@/components/system-state";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import Link from "next/link";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { reason } = await searchParams;
  const singleReason = Array.isArray(reason) ? reason[0] : reason;
  if (!getSupabasePublicConfig()) {
    return <SystemState title="Conecte seu projeto Supabase">
      <p>Autenticação ainda não está ativa neste ambiente. Adicione a URL do projeto e a chave publishable em <code>.env.local</code>, aplique a migração e reinicie o servidor.</p>
      <p>Consulte o README para os passos de configuração. Nenhuma credencial é preenchida automaticamente.</p>
    </SystemState>;
  }
  return <main className="auth-shell"><Link className="brand" href="/" aria-label="VetRecover"><span className="brand-mark">v</span><span>vet<span className="brand-light">recover</span></span></Link><section className="auth-card"><span className="eyebrow">INTELIGÊNCIA COMERCIAL VETERINÁRIA</span><h1>Acesse sua clínica</h1><p className="subtitle">Entre para acompanhar oportunidades e resultados.</p><AuthForm reason={singleReason} /></section><p className="auth-privacy">Acesso protegido por Supabase Auth e políticas do banco.</p></main>;
}
