export default function Header() {
  return (
    <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <img src="/logo192.png" alt="" className="h-8 w-8 rounded-lg" />
          <div className="leading-tight">
            <div className="text-base font-semibold text-white">purssh</div>
            <div className="text-xs text-slate-400">RSS → Push</div>
          </div>
        </div>
      </div>
    </header>
  )
}
