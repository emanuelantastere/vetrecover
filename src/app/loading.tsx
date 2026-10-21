export default function Loading() {
  return <main className="app-shell loading-shell" aria-live="polite" aria-busy="true"><aside className="sidebar loading-sidebar"/><section className="workspace"><header className="topbar"/><div className="content"><div className="skeleton skeleton-title"/><div className="metrics">{[1, 2, 3, 4].map((item) => <div className="skeleton skeleton-card" key={item}/>)}</div><div className="skeleton skeleton-panel"/><p className="loading-label">Carregando os dados seguros da clínica…</p></div></section></main>;
}
