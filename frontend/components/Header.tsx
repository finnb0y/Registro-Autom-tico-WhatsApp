type WhatsAppStatus = {
  connected: boolean;
  hasQr: boolean;
  phone: string | null;
};

type HeaderProps = {
  waStatus: WhatsAppStatus;
};

const Header = ({ waStatus }: HeaderProps) => {
  return (
    <header className="w-full border-b border-emerald-900/40 bg-transparent">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img
            src="/logos/logo-primary.svg"
            alt="Logo"
            className="h-10 w-auto object-contain"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="rounded-full px-3 py-1.5 bg-emerald-950/40 border border-emerald-900/30 flex items-center gap-2 text-sm text-slate-200">
            <span
              className={`w-2 h-2 rounded-full inline-block shadow ${
                waStatus.connected ? 'bg-emerald-400' : 'bg-rose-500'
              }`}
            />
            <span>
              {waStatus.connected
                ? `WhatsApp conectado${waStatus.phone ? ` (+${waStatus.phone})` : ''}`
                : 'WhatsApp desconectado'}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
