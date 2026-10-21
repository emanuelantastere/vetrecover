import Link from "next/link";

export function SystemState({ title, children }: { title: string; children: React.ReactNode }) {
  return <main className="system-state"><Link className="brand system-brand" href="/" aria-label="VetRecover"><span className="brand-mark">v</span><span>vet<span className="brand-light">recover</span></span></Link><section className="system-card"><span className="system-mark">i</span><h1>{title}</h1>{children}</section></main>;
}
