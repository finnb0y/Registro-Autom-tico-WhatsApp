import { Smartphone } from 'lucide-react';

type WhatsAppStatus = {
  connected: boolean;
  hasQr: boolean;
  phone: string | null;
};

type WhatsAppConnectProps = {
  waStatus: WhatsAppStatus;
  qrImage: string | null;
};

const WhatsAppConnect = ({ waStatus, qrImage }: WhatsAppConnectProps) => {
  if (waStatus.connected) return null;

  return (
    <section className="w-full">
      <div className="glass-card p-8">
        <h2 className="text-center text-xl font-semibold mb-2 text-slate-100">
          Conecte o WhatsApp
        </h2>
        <p className="text-center text-sm text-slate-300 mb-6">
          Abra o WhatsApp no celular → Menu (⋮) → Aparelhos conectados → Conectar aparelho
        </p>

        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-center h-56 rounded-lg border-2 border-dashed border-emerald-900/40 bg-transparent">
            {qrImage ? (
              <img
                src={qrImage}
                alt="QR Code WhatsApp"
                className="w-48 h-48 rounded-lg"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-slate-400">
                <Smartphone className="w-8 h-8" />
                <div className="text-xs">Aguardando QR Code…</div>
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center gap-4 bg-emerald-950/40 border border-emerald-900/30 rounded-xl p-4">
            <div className="w-10 h-10 rounded-md bg-emerald-950/60 flex items-center justify-center text-emerald-300 shrink-0">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-medium text-slate-100">Conectar aparelho</div>
              <div className="text-xs text-slate-300">Status: desconectado</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default WhatsAppConnect;
