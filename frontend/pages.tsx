'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';

// ─── Types ────────────────────────────────────────────────────────────────────

type Contact = {
  id: string;
  name: string;
  phone: string;
  value: string | number;
  balance: string | number;
  type: string;
};

type SendResult = {
  name: string;
  phone: string;
  success: boolean;
  error?: string;
};

type WhatsAppStatus = {
  connected: boolean;
  hasQr: boolean;
  phone: string | null;
};

// ─── Mapeamento de colunas ─────────────────────────────────────────────────────
// Ajuste aqui se os nomes das colunas da sua planilha forem diferentes

const COL_MAP: Record<string, string> = {
  // nome
  nome: 'name',
  name: 'name',
  cliente: 'name',
  // telefone
  telefone: 'phone',
  fone: 'phone',
  celular: 'phone',
  phone: 'phone',
  numero: 'phone',
  'número': 'phone',
  whatsapp: 'phone',
  // valor consumido
  valor: 'value',
  consumo: 'value',
  'valor consumido': 'value',
  'consumo do dia': 'value',
  value: 'value',
  // saldo
  saldo: 'balance',
  balance: 'balance',
  'saldo disponível': 'balance',
  'saldo disponivel': 'balance',
  // tipo
  tipo: 'type',
  type: 'type',
  'tipo de consumo': 'type',
  categoria: 'type',
};

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [results, setResults] = useState<SendResult[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [waStatus, setWaStatus] = useState<WhatsAppStatus>({ connected: false, hasQr: false, phone: null });
  const [qrImage, setQrImage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Polling do status do WhatsApp
  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/status`);
      const data: WhatsAppStatus = await res.json();
      setWaStatus(data);

      if (data.hasQr && !data.connected) {
        const qrRes = await fetch(`${SERVER_URL}/qr`);
        if (qrRes.ok) {
          const qrData = await qrRes.json();
          setQrImage(qrData.qr);
        }
      } else {
        setQrImage(null);
      }
    } catch {
      // servidor offline
      setWaStatus({ connected: false, hasQr: false, phone: null });
    }
  }, []);

  useEffect(() => {
    pollStatus();
    const interval = setInterval(pollStatus, 3000);
    return () => clearInterval(interval);
  }, [pollStatus]);

  // ─── Parse da planilha ───────────────────────────────────────────────────────

  function parseFile(file: File) {
    setParseError(null);
    setResults([]);
    setIsDone(false);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        if (rows.length === 0) {
          setParseError('A planilha está vazia.');
          return;
        }

        const mapped = rows.map((row, i) => {
          const contact: Partial<Contact> & { id: string } = { id: `row-${i}` };

          for (const [col, val] of Object.entries(row)) {
            const normalized = col.trim().toLowerCase();
            const mapped = COL_MAP[normalized];
            if (mapped) {
              (contact as Record<string, unknown>)[mapped] = val;
            }
          }

          return contact as Contact;
        });

        // Verifica campos obrigatórios
        const missing = mapped.filter((c) => !c.name || !c.phone);
        if (missing.length === mapped.length) {
          setParseError(
            'Não foi possível identificar as colunas. Verifique se a planilha tem colunas com nomes como: Nome, Telefone, Valor, Saldo, Tipo.'
          );
          return;
        }

        setContacts(mapped.filter((c) => c.name && c.phone));
      } catch {
        setParseError('Erro ao ler o arquivo. Certifique-se de que é um .xlsx válido.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) parseFile(file);
  }

  function removeContact(id: string) {
    setContacts((prev) => prev.filter((c) => c.id !== id));
  }

  // ─── Envio ───────────────────────────────────────────────────────────────────

  async function sendMessages() {
    if (!waStatus.connected) return;
    setIsSending(true);
    setResults([]);

    try {
      const res = await fetch(`${SERVER_URL}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts }),
      });
      const data = await res.json();
      setResults(data.results || []);
      setIsDone(true);
    } catch {
      alert('Erro ao conectar com o servidor. Verifique se ele está rodando.');
    } finally {
      setIsSending(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  const successCount = results.filter((r) => r.success).length;
  const errorCount = results.filter((r) => !r.success).length;

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Resumos Diários</h1>
            <p className="text-gray-500 text-sm mt-0.5">Envie o resumo de consumo do dia pelo WhatsApp</p>
          </div>

          {/* Status WhatsApp */}
          <div className="flex items-center gap-2 bg-white border rounded-lg px-4 py-2 shadow-sm">
            <span
              className={`w-2.5 h-2.5 rounded-full ${waStatus.connected ? 'bg-green-500' : 'bg-red-400'}`}
            />
            <span className="text-sm font-medium text-gray-700">
              {waStatus.connected
                ? `WhatsApp conectado ${waStatus.phone ? `(+${waStatus.phone})` : ''}`
                : 'WhatsApp desconectado'}
            </span>
          </div>
        </div>

        {/* QR Code */}
        {!waStatus.connected && (
          <div className="bg-white border rounded-xl shadow-sm p-6 flex flex-col items-center gap-4">
            <h2 className="text-lg font-semibold text-gray-800">Conecte o WhatsApp</h2>
            {qrImage ? (
              <>
                <p className="text-gray-500 text-sm text-center">
                  Abra o WhatsApp no celular → Menu (⋮) → Aparelhos conectados → Conectar aparelho
                </p>
                <img src={qrImage} alt="QR Code WhatsApp" className="w-56 h-56 rounded-lg border" />
              </>
            ) : (
              <p className="text-gray-400 text-sm">Aguardando QR Code do servidor…</p>
            )}
          </div>
        )}

        {/* Upload */}
        <div
          className={`bg-white border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
            ${isDragging ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:border-gray-300'}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />
          <div className="text-4xl mb-2">📊</div>
          <p className="font-medium text-gray-700">
            {fileName ? fileName : 'Arraste a planilha aqui ou clique para selecionar'}
          </p>
          <p className="text-gray-400 text-sm mt-1">Aceita .xlsx e .xls</p>
        </div>

        {/* Erro de parse */}
        {parseError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            ⚠️ {parseError}
          </div>
        )}

        {/* Tabela de contatos */}
        {contacts.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">
                {contacts.length} contato{contacts.length !== 1 ? 's' : ''} para envio
              </h2>
              <span className="text-xs text-gray-400">Clique em × para remover</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">Nome</th>
                    <th className="px-4 py-3 text-left">Telefone</th>
                    <th className="px-4 py-3 text-left">Tipo</th>
                    <th className="px-4 py-3 text-right">Consumo</th>
                    <th className="px-4 py-3 text-right">Saldo</th>
                    <th className="px-4 py-3 text-center">Remover</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {contacts.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-800">{c.name}</td>
                      <td className="px-4 py-3 text-gray-600">{c.phone}</td>
                      <td className="px-4 py-3 text-gray-600">{c.type || '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-800">
                        {c.value !== undefined && c.value !== '' ? `R$ ${Number(c.value).toFixed(2).replace('.', ',')}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-800">
                        {c.balance !== undefined && c.balance !== '' ? `R$ ${Number(c.balance).toFixed(2).replace('.', ',')}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => removeContact(c.id)}
                          className="text-gray-400 hover:text-red-500 transition-colors font-bold text-base w-7 h-7 rounded-full hover:bg-red-50"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Botão de envio */}
            <div className="px-5 py-4 border-t bg-gray-50 flex items-center justify-between">
              {!waStatus.connected && (
                <p className="text-sm text-amber-600">⚠️ Conecte o WhatsApp antes de enviar</p>
              )}
              {waStatus.connected && <p className="text-sm text-gray-500" />}

              <button
                onClick={sendMessages}
                disabled={isSending || !waStatus.connected || contacts.length === 0}
                className={`px-6 py-2.5 rounded-lg font-semibold text-sm transition-all
                  ${isSending || !waStatus.connected || contacts.length === 0
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-green-600 hover:bg-green-700 text-white shadow-sm'
                  }`}
              >
                {isSending
                  ? `Enviando… (${results.length}/${contacts.length})`
                  : `Enviar ${contacts.length} mensagem${contacts.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}

        {/* Resultados */}
        {isDone && results.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="px-5 py-4 border-b">
              <h2 className="font-semibold text-gray-800">Resultado do envio</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                ✅ {successCount} enviado{successCount !== 1 ? 's' : ''}&nbsp;&nbsp;
                {errorCount > 0 && <>❌ {errorCount} com erro</>}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Nome</th>
                    <th className="px-4 py-3 text-left">Telefone</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-left">Detalhe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {results.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{r.name}</td>
                      <td className="px-4 py-3 text-gray-600">{r.phone}</td>
                      <td className="px-4 py-3 text-center">
                        {r.success ? (
                          <span className="text-green-600 font-semibold">✅ Enviado</span>
                        ) : (
                          <span className="text-red-500 font-semibold">❌ Erro</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{r.error || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
