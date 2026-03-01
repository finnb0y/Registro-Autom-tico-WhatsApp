'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';

// ─── Types ────────────────────────────────────────────────────────────────────

type Contact = {
  id: string;
  name: string;
  phone: string;
  gastoCashGame?: number | string;
  saldoTorneio?: number | string;
  saldoBar?: number | string;
  saldoDia?: number | string;
  saldoTotal?: number | string;
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

type RawRow = Record<string, unknown>;

// ─── Column aliases ───────────────────────────────────────────────────────────

const NAME_ALIASES     = ['nome', 'name', 'cliente', 'cliente / comanda'];
const PHONE_ALIASES    = ['telefone', 'fone', 'celular', 'phone', 'numero', 'número', 'whatsapp'];
const CASH_ALIASES     = ['saldo/cashgame', 'saldo cashgame', 'saldo/cash game', 'saldo cash game', 'gasto cash game no dia', 'gasto cash game', 'cash game', 'consumo cash'];
const TORNEIO_ALIASES  = ['saldo/torneio', 'saldo torneio', 'torneio'];
const BAR_ALIASES      = ['saldo/comanda', 'saldo comanda', 'saldo/bar', 'saldo bar', 'bar', 'consumo bar', 'saldo final no dia'];
const TOTAL_ALIASES    = ['saldo/final', 'saldo final', 'saldo total', 'saldo', 'balance'];

function findCol(row: RawRow, aliases: string[]): string | number | undefined {
  for (const [k, v] of Object.entries(row)) {
    if (aliases.includes(k.trim().toLowerCase())) return v as string | number;
  }
  return undefined;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';

const DEFAULT_HEADER  = '📣 *Atualização de Saldo*\n\n👤 *Jogador:* <nome>';
const DEFAULT_CASH    = '🎲 *Cash Game:* R$ <gastoCashGame>';
const DEFAULT_TORNEIO = '🏆 *Torneio:* R$ <saldoTorneio>';
const DEFAULT_BAR     = '🍺 *Bar:* R$ <saldoBar>';
const DEFAULT_FOOTER  = '💰 *Saldo do dia:* R$ <saldoDia>\n💳 *Saldo Total:* R$ <saldoTotal>\n\n*_Para fazer um acerto, esse é o pix:_*\npix.quadrapoker@gmail.com\n*_IBM-C6BANK_*\n\n*_Para solicitar o saque de algum valor deixado de crédito, basta informar a sua chave pix e o nome do titular da conta._*\n\n*_Ficou alguma dúvida? Não hesite em perguntar._*\n\n♣️ QUADRA POKER CLUB – Onde Brasília joga sério!';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(value: string | number | undefined): string {
  if (value === undefined || value === '') return '—';
  const num = parseFloat(String(value));
  if (isNaN(num)) return String(value);
  return num.toFixed(2).replace('.', ',');
}

/** Returns "R$ X,XX" for a defined non-empty value, or "—" otherwise. */
function formatOptionalCurrency(value: string | number | undefined): string {
  if (value === undefined || value === '') return '—';
  return `R$ ${formatCurrency(value)}`;
}

/** Normalises a raw cell value: returns the value if non-empty, otherwise undefined. */
function normalizeValue(val: string | number | undefined): string | number | undefined {
  return val !== undefined && val !== '' ? val : undefined;
}

/** Normaliza nome para comparação: minúsculas + sem acentos + sem espaços extras */
function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function buildContactMessage(
  contact: Contact,
  header: string,
  cashTpl: string,
  torneioTpl: string,
  barTpl: string,
  footer: string,
): string {
  const lines: string[] = [];
  lines.push(header.replace(/<nome>/g, contact.name));
  lines.push('');
  if (contact.gastoCashGame !== undefined && contact.gastoCashGame !== '') {
    lines.push(cashTpl.replace(/<gastoCashGame>/g, formatCurrency(contact.gastoCashGame)));
  }
  if (contact.saldoTorneio !== undefined && contact.saldoTorneio !== '') {
    lines.push(torneioTpl.replace(/<saldoTorneio>/g, formatCurrency(contact.saldoTorneio)));
  }
  if (contact.saldoBar !== undefined && contact.saldoBar !== '') {
    lines.push(barTpl.replace(/<saldoBar>/g, formatCurrency(contact.saldoBar)));
  }
  lines.push('');
  const saldoDiaNum   = contact.saldoDia   !== undefined && contact.saldoDia   !== '' ? parseFloat(String(contact.saldoDia))   : NaN;
  const saldoTotalNum = contact.saldoTotal !== undefined && contact.saldoTotal !== '' ? parseFloat(String(contact.saldoTotal)) : NaN;
  const showSaldoDia  = !isNaN(saldoDiaNum) && (isNaN(saldoTotalNum) || saldoDiaNum !== saldoTotalNum);
  let builtFooter = footer.replace(/<saldoTotal>/g, formatCurrency(contact.saldoTotal));
  if (showSaldoDia) {
    builtFooter = builtFooter.replace(/<saldoDia>/g, formatCurrency(contact.saldoDia));
  } else {
    builtFooter = builtFooter.replace(/^.*<saldoDia>.*$\n?/m, '');
  }
  lines.push(builtFooter);
  return lines.join('\n');
}

// ─── UploadZone sub-component ─────────────────────────────────────────────────

function UploadZone({
  label,
  icon,
  fileName,
  loaded,
  error,
  required,
  onFile,
}: {
  label: string;
  icon: string;
  fileName: string | null;
  loaded: boolean;
  error: string | null;
  required?: boolean;
  onFile: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-1">
      <div
        className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors
          ${loaded ? 'border-green-400 bg-green-50' : dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
        />
        <div className="text-2xl mb-1">{loaded ? '✅' : icon}</div>
        <p className="text-xs font-semibold text-gray-700">
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </p>
        <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[130px] mx-auto">
          {fileName ?? 'Clique ou arraste'}
        </p>
      </div>
      {error && <p className="text-xs text-red-600">⚠️ {error}</p>}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const [contacts, setContacts]     = useState<Contact[]>([]);
  const [results, setResults]       = useState<SendResult[]>([]);
  const [isSending, setIsSending]   = useState(false);
  const [isDone, setIsDone]         = useState(false);

  // Raw spreadsheet data
  const [cadastrosData, setCadastrosData] = useState<RawRow[] | null>(null);
  const [cashGameData, setCashGameData]   = useState<RawRow[] | null>(null);
  const [torneioData, setTorneioData]     = useState<RawRow[] | null>(null);
  const [barData, setBarData]             = useState<RawRow[] | null>(null);

  // File names
  const [cadastrosFile, setCadastrosFile] = useState<string | null>(null);
  const [cashGameFile, setCashGameFile]   = useState<string | null>(null);
  const [torneioFile, setTorneioFile]     = useState<string | null>(null);
  const [barFile, setBarFile]             = useState<string | null>(null);

  // Parse errors
  const [cadastrosError, setCadastrosError] = useState<string | null>(null);
  const [cashGameError, setCashGameError]   = useState<string | null>(null);
  const [torneioError, setTorneioError]     = useState<string | null>(null);
  const [barError, setBarError]             = useState<string | null>(null);

  // Message template segments
  const [headerTemplate, setHeaderTemplate]   = useState(DEFAULT_HEADER);
  const [cashTemplate, setCashTemplate]       = useState(DEFAULT_CASH);
  const [torneioTemplate, setTorneioTemplate] = useState(DEFAULT_TORNEIO);
  const [barTemplate, setBarTemplate]         = useState(DEFAULT_BAR);
  const [footerTemplate, setFooterTemplate]   = useState(DEFAULT_FOOTER);

  const [waStatus, setWaStatus] = useState<WhatsAppStatus>({ connected: false, hasQr: false, phone: null });
  const [qrImage, setQrImage]   = useState<string | null>(null);
  const [mergeWarnings, setMergeWarnings] = useState<string[]>([]);

  // ─── WhatsApp polling ────────────────────────────────────────────────────────

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
      setWaStatus({ connected: false, hasQr: false, phone: null });
    }
  }, []);

  useEffect(() => {
    pollStatus();
    const interval = setInterval(pollStatus, 3000);
    return () => clearInterval(interval);
  }, [pollStatus]);

  // ─── Manual merge ────────────────────────────────────────────────────────────

  function performMerge() {
    console.log('Clique no botão merge detectado');
    if (!cadastrosData || !(cashGameData || torneioData || barData)) return;

    setMergeWarnings([]);

    // Mapa de cadastro: nome normalizado → telefone
    const phoneMap = new Map<string, string>();
    cadastrosData.forEach((r) => {
      const name  = String(findCol(r, NAME_ALIASES)  ?? '').trim();
      const phone = String(findCol(r, PHONE_ALIASES) ?? '').trim();
      if (name && phone) phoneMap.set(normalizeName(name), phone);
    });

    // Mapas de gastos: nome normalizado → linha da planilha
    const cashMap    = new Map<string, RawRow>();
    const torneioMap = new Map<string, RawRow>();
    const barMap     = new Map<string, RawRow>();

    // Conjunto ordenado de nomes (mantém ordem de aparição)
    const namesInOrder: { key: string; originalName: string }[] = [];
    const seenNames = new Set<string>();

    function indexRows(rows: RawRow[] | null, map: Map<string, RawRow>) {
      rows?.forEach((r) => {
        const name = String(findCol(r, NAME_ALIASES) ?? '').trim();
        if (!name) return;
        const key = normalizeName(name);
        map.set(key, r);
        if (!seenNames.has(key)) {
          seenNames.add(key);
          namesInOrder.push({ key, originalName: name });
        }
      });
    }

    indexRows(cashGameData, cashMap);
    indexRows(torneioData,  torneioMap);
    indexRows(barData,      barMap);

    const merged: Contact[] = [];
    const warnings: string[] = [];

    namesInOrder.forEach(({ key, originalName }, i) => {
      const phone = phoneMap.get(key) ?? '';
      if (!phone) {
        warnings.push(originalName);
        return; // sem telefone cadastrado, ignora
      }

      const cashRow    = cashMap.get(key);
      const torneioRow = torneioMap.get(key);
      const barRow     = barMap.get(key);

      const gastoCashGame = normalizeValue(cashRow    ? findCol(cashRow,    CASH_ALIASES)    as string | number | undefined : undefined);
      const saldoTorneio  = normalizeValue(torneioRow ? findCol(torneioRow, TORNEIO_ALIASES) as string | number | undefined : undefined);
      const saldoBar      = normalizeValue(barRow     ? findCol(barRow,     BAR_ALIASES)     as string | number | undefined : undefined);

      // saldoTotal: prefer Cash Game > Torneio > Bar, as specified in the business rules
      // (all three sheets should carry the same value; we just take the first available)
      const saldoTotal = normalizeValue(
        ((cashRow    && findCol(cashRow,    TOTAL_ALIASES)) ||
         (torneioRow && findCol(torneioRow, TOTAL_ALIASES)) ||
         (barRow     && findCol(barRow,     TOTAL_ALIASES)) ||
         undefined) as string | number | undefined,
      );

      const saldoDiaParts = [gastoCashGame, saldoTorneio, saldoBar]
        .filter((v) => v !== undefined && v !== '')
        .map((v) => parseFloat(String(v)));
      const saldoDia: number | undefined = saldoDiaParts.length > 0
        ? saldoDiaParts.reduce((a, b) => a + b, 0)
        : undefined;

      merged.push({
        id:           `row-${i}`,
        name:         originalName,
        phone,
        gastoCashGame,
        saldoTorneio,
        saldoBar,
        saldoDia,
        saldoTotal,
      });
    });

    setContacts(merged);
    setMergeWarnings(warnings);
    setResults([]);
    setIsDone(false);
  }

  // ─── Parse helpers ────────────────────────────────────────────────────────────

  function parseSheet(
    file: File,
    onData: (rows: RawRow[]) => void,
    onError: (msg: string) => void,
    validate?: (rows: RawRow[]) => boolean,
  ) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb   = XLSX.read(data, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];

        const rows = XLSX.utils.sheet_to_json<RawRow>(ws, { defval: '' });
        if (rows.length === 0) { onError('Planilha vazia.'); return; }

        if (!validate || validate(rows)) {
          onData(rows);
          return;
        }

        const rowsSkipped = XLSX.utils.sheet_to_json<RawRow>(ws, { defval: '', range: 1 });
        if (rowsSkipped.length === 0) { onError('Planilha vazia.'); return; }

        if (validate(rowsSkipped)) {
          onData(rowsSkipped);
          return;
        }

        onError('Colunas esperadas não encontradas na planilha.');
      } catch {
        onError('Erro ao ler o arquivo. Certifique-se de que é um .xlsx válido.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleCadastros(file: File) {
    setCadastrosError(null);
    setCadastrosFile(file.name);
    setContacts([]);
    setMergeWarnings([]);
    parseSheet(
      file,
      setCadastrosData,
      setCadastrosError,
      (rows) => rows.some((r) => findCol(r, NAME_ALIASES) && findCol(r, PHONE_ALIASES)),
    );
  }

  function handleCashGame(file: File) {
    setCashGameError(null);
    setCashGameFile(file.name);
    setContacts([]);
    setMergeWarnings([]);
    parseSheet(file, setCashGameData, setCashGameError);
  }

  function handleTorneio(file: File) {
    setTorneioError(null);
    setTorneioFile(file.name);
    setContacts([]);
    setMergeWarnings([]);
    parseSheet(file, setTorneioData, setTorneioError);
  }

  function handleBar(file: File) {
    setBarError(null);
    setBarFile(file.name);
    setContacts([]);
    setMergeWarnings([]);
    parseSheet(file, setBarData, setBarError);
  }

  function downloadTreated() {
    const rows = contacts.map((c) => ({
      Nome:        c.name,
      Telefone:    c.phone,
      'Cash Game': c.gastoCashGame ?? '',
      Torneio:     c.saldoTorneio  ?? '',
      Bar:         c.saldoBar      ?? '',
      'Saldo Dia': c.saldoDia      ?? '',
      'Saldo Total': c.saldoTotal  ?? '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dados');
    XLSX.writeFile(wb, 'planilha_tratada.xlsx');
  }

  function removeContact(id: string) {
    setContacts((prev) => prev.filter((c) => c.id !== id));
  }

  // ─── Send ─────────────────────────────────────────────────────────────────────

  async function sendMessages() {
    if (!waStatus.connected) return;
    setIsSending(true);
    setResults([]);

    const payload = contacts.map((c) => ({
      name:    c.name,
      phone:   c.phone,
      message: buildContactMessage(c, headerTemplate, cashTemplate, torneioTemplate, barTemplate, footerTemplate),
    }));

    try {
      const res = await fetch(`${SERVER_URL}/send`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ contacts: payload }),
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

  // ─── Render helpers ───────────────────────────────────────────────────────────

  const canMerge        = !!(cadastrosData && (cashGameData || torneioData || barData));
  const previewContact  = contacts[0];
  const successCount    = results.filter((r) => r.success).length;
  const errorCount      = results.filter((r) => !r.success).length;

  const hasCash    = previewContact?.gastoCashGame !== undefined && previewContact.gastoCashGame !== '';
  const hasTorneio = previewContact?.saldoTorneio  !== undefined && previewContact.saldoTorneio  !== '';
  const hasBar     = previewContact?.saldoBar      !== undefined && previewContact.saldoBar      !== '';

  // Fallback example when no contacts loaded yet
  const exampleContact: Contact = previewContact ?? {
    id:            'ex',
    name:          'João Silva',
    phone:         '11999999999',
    gastoCashGame: 150,
    saldoTorneio:  200,
    saldoBar:      undefined,
    saldoDia:      350,
    saldoTotal:    500,
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Resumos Diários</h1>
            <p className="text-gray-500 text-sm mt-0.5">Envie o resumo de consumo do dia pelo WhatsApp</p>
          </div>
          <div className="flex items-center gap-2 bg-white border rounded-lg px-4 py-2 shadow-sm">
            <span className={`w-2.5 h-2.5 rounded-full ${waStatus.connected ? 'bg-green-500' : 'bg-red-400'}`} />
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

        {/* Planilhas */}
        <div className="bg-white rounded-xl shadow-sm border p-5">
          <h2 className="font-semibold text-gray-800 mb-4">📤 Planilhas</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <UploadZone
              label="Cadastros"  icon="📋"
              fileName={cadastrosFile} loaded={!!cadastrosData} error={cadastrosError}
              required onFile={handleCadastros}
            />
            <UploadZone
              label="Cash Game"  icon="🎲"
              fileName={cashGameFile} loaded={!!cashGameData} error={cashGameError}
              onFile={handleCashGame}
            />
            <UploadZone
              label="Torneio"  icon="🏆"
              fileName={torneioFile} loaded={!!torneioData} error={torneioError}
              onFile={handleTorneio}
            />
            <UploadZone
              label="Bar"  icon="🍺"
              fileName={barFile} loaded={!!barData} error={barError}
              onFile={handleBar}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={performMerge}
              disabled={!canMerge}
              className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all
                ${!canMerge
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                }`}
            >
              🔀 Fazer Merge
            </button>
            {contacts.length > 0 && (
              <>
                <p className="text-xs text-green-700 font-medium">
                  ✅ {contacts.length} contato{contacts.length !== 1 ? 's' : ''} mesclado{contacts.length !== 1 ? 's' : ''}
                </p>
                <button
                  onClick={downloadTreated}
                  className="px-4 py-2 rounded-lg font-semibold text-sm bg-green-600 hover:bg-green-700 text-white shadow-sm transition-all"
                >
                  ⬇️ Baixar Planilha Tratada (.xlsx)
                </button>
              </>
            )}
            {mergeWarnings.length > 0 && (
              <div className="w-full mt-2 p-3 bg-yellow-50 border border-yellow-300 rounded-lg text-xs text-yellow-800">
                <p className="font-semibold mb-1">⚠️ {mergeWarnings.length} nome{mergeWarnings.length !== 1 ? 's' : ''} sem telefone no Cadastro (ignorado{mergeWarnings.length !== 1 ? 's' : ''}):</p>
                <p className="text-yellow-700">{mergeWarnings.join(', ')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Construtor de mensagem */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">✏️ Construtor de mensagem</h2>
            <button
              onClick={() => {
                setHeaderTemplate(DEFAULT_HEADER);
                setCashTemplate(DEFAULT_CASH);
                setTorneioTemplate(DEFAULT_TORNEIO);
                setBarTemplate(DEFAULT_BAR);
                setFooterTemplate(DEFAULT_FOOTER);
              }}
              className="text-xs text-gray-500 hover:text-green-700 border border-gray-200 hover:border-green-400 px-3 py-1 rounded-lg transition-colors"
            >
              Restaurar padrão
            </button>
          </div>

          <div className="p-5 space-y-4">
            {/* Cabeçalho */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cabeçalho</label>
              <textarea
                value={headerTemplate}
                onChange={(e) => setHeaderTemplate(e.target.value)}
                className="font-mono text-sm border border-gray-200 rounded-lg p-3 resize-none h-20 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300"
              />
              <p className="text-xs text-gray-400">Variável: <code className="bg-gray-100 rounded px-1">&lt;nome&gt;</code></p>
            </div>

            {/* Cash Game */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold px-2 py-0.5 rounded text-white" style={{ background: '#059669' }}>CASH</span>
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Cash Game</label>
              </div>
              <textarea
                value={cashTemplate}
                onChange={(e) => setCashTemplate(e.target.value)}
                className="font-mono text-sm border rounded-lg p-3 resize-none h-12 focus:outline-none focus:ring-1 focus:ring-green-600"
                style={{ background: '#d1fae5', borderColor: '#065f46' }}
              />
              <p className="text-xs text-gray-400">Variável: <code className="bg-gray-100 rounded px-1">&lt;gastoCashGame&gt;</code></p>
            </div>

            {/* Torneio */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold px-2 py-0.5 rounded text-white" style={{ background: '#2563eb' }}>TORNEIO</span>
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Torneio</label>
              </div>
              <textarea
                value={torneioTemplate}
                onChange={(e) => setTorneioTemplate(e.target.value)}
                className="font-mono text-sm border rounded-lg p-3 resize-none h-12 focus:outline-none focus:ring-1 focus:ring-blue-600"
                style={{ background: '#dbeafe', borderColor: '#1e40af' }}
              />
              <p className="text-xs text-gray-400">Variável: <code className="bg-gray-100 rounded px-1">&lt;saldoTorneio&gt;</code></p>
            </div>

            {/* Bar */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold px-2 py-0.5 rounded text-white" style={{ background: '#9d174d' }}>BAR</span>
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Bar</label>
              </div>
              <textarea
                value={barTemplate}
                onChange={(e) => setBarTemplate(e.target.value)}
                className="font-mono text-sm border rounded-lg p-3 resize-none h-12 focus:outline-none focus:ring-1 focus:ring-pink-700"
                style={{ background: '#fce7f3', borderColor: '#9d174d' }}
              />
              <p className="text-xs text-gray-400">Variável: <code className="bg-gray-100 rounded px-1">&lt;saldoBar&gt;</code></p>
            </div>

            {/* Rodapé */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Rodapé</label>
              <textarea
                value={footerTemplate}
                onChange={(e) => setFooterTemplate(e.target.value)}
                className="font-mono text-sm border border-gray-200 rounded-lg p-3 resize-none h-20 focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300"
              />
              <p className="text-xs text-gray-400">Variáveis: <code className="bg-gray-100 rounded px-1">&lt;saldoDia&gt;</code> <code className="bg-gray-100 rounded px-1">&lt;saldoTotal&gt;</code></p>
            </div>

            {/* Pré-visualização */}
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2 bg-gray-50 border-b text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Pré-visualização {previewContact ? `(${previewContact.name})` : '(exemplo)'}
              </div>
              <div className="p-4 space-y-1 text-sm">
                <div className="whitespace-pre-wrap text-gray-700 mb-2">
                  {headerTemplate.replace(/<nome>/g, exampleContact.name)}
                </div>

                {/* Cash Game segment */}
                <div
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-opacity"
                  style={{
                    background: hasCash || !previewContact ? '#d1fae5' : 'transparent',
                    opacity:    hasCash || !previewContact ? 1 : 0.4,
                  }}
                >
                  <span className="flex-1 text-gray-700">
                    {cashTemplate.replace(/<gastoCashGame>/g, formatCurrency(exampleContact.gastoCashGame))}
                  </span>
                  <span className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0 text-white" style={{ background: '#059669' }}>
                    {hasCash || !previewContact ? 'CASH' : 'CASH ❌'}
                  </span>
                </div>

                {/* Torneio segment */}
                <div
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-opacity"
                  style={{
                    background: hasTorneio || !previewContact ? '#dbeafe' : 'transparent',
                    opacity:    hasTorneio || !previewContact ? 1 : 0.4,
                  }}
                >
                  <span className="flex-1 text-gray-700">
                    {torneioTemplate.replace(/<saldoTorneio>/g, formatCurrency(exampleContact.saldoTorneio))}
                  </span>
                  <span className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0 text-white" style={{ background: '#2563eb' }}>
                    {hasTorneio || !previewContact ? 'TORNEIO' : 'TORNEIO ❌'}
                  </span>
                </div>

                {/* Bar segment */}
                <div
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-opacity"
                  style={{
                    background: hasBar || !previewContact ? '#fce7f3' : 'transparent',
                    opacity:    hasBar || !previewContact ? 1 : 0.4,
                  }}
                >
                  <span className="flex-1 text-gray-700">
                    {barTemplate.replace(/<saldoBar>/g, formatCurrency(exampleContact.saldoBar))}
                  </span>
                  <span className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0 text-white" style={{ background: '#9d174d' }}>
                    {hasBar || !previewContact ? 'BAR' : 'BAR ❌'}
                  </span>
                </div>

                <div className="whitespace-pre-wrap text-gray-700 mt-2">
                  {footerTemplate
                    .replace(/<saldoDia>/g, formatCurrency(exampleContact.saldoDia))
                    .replace(/<saldoTotal>/g, formatCurrency(exampleContact.saldoTotal))}
                </div>
              </div>
            </div>
          </div>
        </div>

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
                    <th className="px-4 py-3 text-right">Cash Game</th>
                    <th className="px-4 py-3 text-right">Torneio</th>
                    <th className="px-4 py-3 text-right">Bar</th>
                    <th className="px-4 py-3 text-right">Saldo Dia</th>
                    <th className="px-4 py-3 text-right">Saldo Total</th>
                    <th className="px-4 py-3 text-center">Remover</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {contacts.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-800">{c.name}</td>
                      <td className="px-4 py-3 text-gray-600">{c.phone}</td>
                      <td className="px-4 py-3 text-right text-gray-800">
                        {formatOptionalCurrency(c.gastoCashGame)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-800">
                        {formatOptionalCurrency(c.saldoTorneio)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-800">
                        {formatOptionalCurrency(c.saldoBar)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-800">
                        {formatOptionalCurrency(c.saldoDia)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-800">
                        {formatOptionalCurrency(c.saldoTotal)}
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
