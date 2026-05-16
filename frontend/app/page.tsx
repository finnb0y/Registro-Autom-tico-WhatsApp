'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { BarChart3, Send } from 'lucide-react';
import Header from '@/components/Header';
import WhatsAppConnect from '@/components/WhatsAppConnect';
import FeatureCard from '@/components/FeatureCard';
import ManualConfigModal, { type ManualFieldRequirement, type SheetConfig } from '@/components/ManualConfigModal';

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
type WorksheetRows = unknown[][];

type SheetRequirement = ManualFieldRequirement;

type ParsedSheetResult = {
  rows: RawRow[];
  rawRows: WorksheetRows;
  needsManualConfig: boolean;
  missingLabels: string[];
  error?: string;
};

type RowWithConfig = {
  row: RawRow;
  config?: SheetConfig;
};

// ─── Column aliases ───────────────────────────────────────────────────────────

const NAME_ALIASES = [
  'nome',
  'name',
  'cliente',
  'cliente / comanda',
  'cliente/comanda',
  'cliente/ comanda',
  'cliente /comanda',
  'jogador',
  'player',
];
const PHONE_ALIASES = ['telefone', 'fone', 'celular', 'phone', 'numero', 'número', 'whatsapp'];
const CASH_ALIASES = ['saldo/cashgame', 'saldo cashgame', 'saldo/cash game', 'saldo cash game', 'gasto cash game no dia', 'gasto cash game', 'gastocashgame', 'cash game', 'consumo cash'];
const TORNEIO_ALIASES = ['saldo/torneio', 'saldo torneio', 'torneio', 'saldotorneio'];
const BAR_ALIASES = ['saldo/comanda', 'saldo comanda', 'saldo/bar', 'saldo bar', 'bar', 'consumo bar', 'saldo final no dia'];
const TOTAL_ALIASES = ['saldo/final', 'saldo final', 'saldo total', 'saldo', 'balance'];

const CADASTROS_FIELDS: SheetRequirement[] = [
  { key: 'name', label: 'Nome', aliases: NAME_ALIASES },
  { key: 'phone', label: 'Telefone', aliases: PHONE_ALIASES },
];
const CASH_FIELDS: SheetRequirement[] = [
  { key: 'name', label: 'Nome', aliases: NAME_ALIASES },
  { key: 'cash', label: 'Cash Game', aliases: CASH_ALIASES },
];
const TORNEIO_FIELDS: SheetRequirement[] = [
  { key: 'name', label: 'Nome', aliases: NAME_ALIASES },
  { key: 'torneio', label: 'Torneio', aliases: TORNEIO_ALIASES },
];
const BAR_FIELDS: SheetRequirement[] = [
  { key: 'name', label: 'Nome', aliases: NAME_ALIASES },
  { key: 'bar', label: 'Bar', aliases: BAR_ALIASES },
];

function normalizeColName(col: string): string {
  return col
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function findCol(row: RawRow, aliases: string[]): string | number | undefined {
  const normalizedAliases = aliases.map((alias) => normalizeColName(alias));
  for (const [k, v] of Object.entries(row)) {
    const normalizedKey = normalizeColName(k);
    if (normalizedAliases.includes(normalizedKey)) return v as string | number;
  }
  return undefined;
}

function findMappedCol(
  row: RawRow,
  aliases: string[],
  fieldKey?: string,
  config?: SheetConfig,
): string | number | undefined {
  const mappedColumn = fieldKey ? config?.columnMap[fieldKey] : undefined;
  if (mappedColumn !== undefined) {
    return row[mappedColumn] as string | number | undefined;
  }
  return findCol(row, aliases);
}

function readFileAsWorksheetRows(file: File): Promise<WorksheetRows> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
        resolve(rawRows);
      } catch {
        reject(new Error('Erro ao ler o arquivo. Certifique-se de que é um .xlsx válido.'));
      }
    };
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo. Certifique-se de que é um .xlsx válido.'));
    reader.readAsArrayBuffer(file);
  });
}

function toRawRowsWithHeader(rawRows: WorksheetRows, headerRowIndex: number): RawRow[] {
  const headerRow = rawRows[headerRowIndex] ?? [];
  const headers = headerRow.map((cell, i) => {
    const value = String(cell ?? '').trim();
    return value || `Coluna ${i + 1}`;
  });
  const rows = rawRows.slice(headerRowIndex + 1);

  return rows
    .map((row) => {
      const out: RawRow = {};
      headers.forEach((header, i) => {
        out[header] = row?.[i] ?? '';
      });
      return out;
    })
    .filter((row) => Object.values(row).some((v) => String(v ?? '').trim() !== ''));
}

function findMissingFields(rows: RawRow[], requiredFields: SheetRequirement[], config?: SheetConfig): string[] {
  if (rows.length === 0) {
    return requiredFields.map((f) => f.label);
  }
  const sampleRow = rows[0];
  return requiredFields
    .filter((field) => {
      const value = findMappedCol(sampleRow, field.aliases, field.key, config);
      return value === undefined;
    })
    .map((field) => field.label);
}

function parseRowsWithAutoHeader(rawRows: WorksheetRows, requiredFields: SheetRequirement[], skipFirstRow: boolean): ParsedSheetResult {
  const firstHeader = skipFirstRow ? 1 : 0;
  const candidateIndexes = [firstHeader, firstHeader + 1].filter((idx) => idx < rawRows.length);
  if (candidateIndexes.length === 0) {
    return { rows: [], rawRows, needsManualConfig: true, missingLabels: requiredFields.map((f) => f.label), error: 'Planilha vazia.' };
  }

  let bestRows: RawRow[] = [];
  let bestMissing = requiredFields.map((f) => f.label);

  for (const idx of candidateIndexes) {
    const rows = toRawRowsWithHeader(rawRows, idx);
    const missing = findMissingFields(rows, requiredFields);
    if (missing.length < bestMissing.length) {
      bestRows = rows;
      bestMissing = missing;
    }
    if (missing.length === 0) {
      return { rows, rawRows, needsManualConfig: false, missingLabels: [] };
    }
  }

  return { rows: bestRows, rawRows, needsManualConfig: true, missingLabels: bestMissing };
}

function parseRowsWithConfig(rawRows: WorksheetRows, requiredFields: SheetRequirement[], config: SheetConfig): ParsedSheetResult {
  const rows = toRawRowsWithHeader(rawRows, config.headerRowIndex);
  const missingLabels = findMissingFields(rows, requiredFields, config);
  return {
    rows,
    rawRows,
    needsManualConfig: missingLabels.length > 0,
    missingLabels,
    error: rows.length === 0 ? 'Planilha vazia.' : undefined,
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3001';

const DEFAULT_HEADER  = '📣 *Atualização de Saldo*\n👤 *Jogador:* <nome>';
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

/** Escapes HTML special characters to prevent XSS. */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const CODE_BG = '#1a2e23';

/** Converts WhatsApp markdown formatting to safe HTML for preview rendering. */
function whatsAppToHtml(raw: string): string {
  let s = escapeHtml(raw);
  // Code blocks: ```...```
  s = s.replace(/```([\s\S]*?)```/g, `<pre style="background:${CODE_BG};border-radius:4px;padding:4px 8px;font-family:monospace;font-size:0.85em;white-space:pre-wrap;display:inline-block">$1</pre>`);
  // Bold: *text*
  s = s.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
  // Italic: _text_
  s = s.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  // Strikethrough: ~text~
  s = s.replace(/~([^~\n]+)~/g, '<s>$1</s>');
  // Inline code: `text`
  s = s.replace(/`([^`\n]+)`/g, `<code style="background:${CODE_BG};border-radius:3px;padding:1px 4px;font-family:monospace;font-size:0.9em">$1</code>`);
  // Newlines to <br>
  s = s.replace(/\n/g, '<br>');
  return s;
}

/** Normaliza nome para comparação: minúsculas + sem acentos + sem espaços extras */
function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Remove o sufixo de ID no formato " - XXX" do final do nome (ex: "João Silva - 042" → "João Silva") */
function stripIdSuffix(name: string): string {
  return name.replace(/\s*-\s*\S+\s*$/, '').trim();
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
          ${loaded ? 'border-green-400 bg-emerald-950/20 ring-1 ring-green-500' : dragging ? 'border-blue-400 bg-blue-50' : 'border-emerald-900/30 hover:border-emerald-700/50 bg-emerald-950/20'}`}
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
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
        />
        <div className="text-2xl mb-1">{loaded ? '✅' : icon}</div>
        <p className="text-xs font-semibold text-slate-200">
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </p>
        <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[130px] mx-auto">
          {fileName ?? 'Clique ou arraste'}
        </p>
      </div>
      {error && <p className="text-xs text-red-600">⚠️ {error}</p>}
    </div>
  );
}

// ─── MultiUploadZone sub-component ───────────────────────────────────────────

type MultiFile = {
  name: string;
  data: RawRow[];
  error?: string;
  rawRows?: WorksheetRows;
  needsManualConfig?: boolean;
  missingLabels?: string[];
  config?: SheetConfig;
};

type ManualConfigTarget =
  | { type: 'cadastros'; fileName: string; rawRows: WorksheetRows }
  | { type: 'massa-cadastros'; fileName: string; rawRows: WorksheetRows }
  | { type: 'cash'; index: number; fileName: string; rawRows: WorksheetRows }
  | { type: 'torneio'; index: number; fileName: string; rawRows: WorksheetRows }
  | { type: 'bar'; index: number; fileName: string; rawRows: WorksheetRows };

function MultiUploadZone({
  label,
  icon,
  files,
  onAdd,
  onRemove,
  onManualConfig,
}: {
  label: string;
  icon: string;
  files: MultiFile[];
  onAdd: (file: File) => void;
  onRemove: (index: number) => void;
  onManualConfig: (index: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-2">
      <div
        className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors
          ${files.length > 0 ? 'border-green-400 bg-emerald-950/20 ring-1 ring-green-500' : dragging ? 'border-blue-400 bg-blue-50' : 'border-emerald-900/30 hover:border-emerald-700/50 bg-emerald-950/20'}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const dropped = Array.from(e.dataTransfer.files);
          dropped.forEach((f) => onAdd(f));
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          multiple
          className="hidden"
          onChange={(e) => {
            Array.from(e.target.files ?? []).forEach((f) => onAdd(f));
            e.target.value = '';
          }}
        />
        <div className="text-2xl mb-1">{files.length > 0 ? '✅' : icon}</div>
        <p className="text-xs font-semibold text-slate-200">{label}</p>
        <p className="text-xs text-slate-400 mt-0.5">
          {files.length > 0 ? `${files.length} arquivo${files.length !== 1 ? 's' : ''}` : '+ Adicionar'}
        </p>
      </div>
      {files.length > 0 && (
        <ul className="flex flex-col gap-1">
          {files.map((f, i) => (
            <li key={i} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1 bg-emerald-950/20 border border-emerald-900/30 rounded-lg px-2 py-1">
                <span className="text-xs text-slate-200 flex-1 truncate">{f.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(i); }}
                  className="text-slate-400 hover:text-red-500 font-bold text-sm w-5 h-5 rounded-full hover:bg-red-900/30 shrink-0"
                  title="Remover"
                >
                  ×
                </button>
              </div>
              {f.error && <p className="text-xs text-red-600 px-1">⚠️ {f.error}</p>}
              {f.needsManualConfig && (
                <div className="px-1 py-1">
                  <p className="text-xs text-amber-500">
                    ⚠️ Campos não encontrados: {(f.missingLabels ?? []).join(', ')}
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onManualConfig(i);
                    }}
                    className="mt-1 text-xs px-2 py-1 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 transition-colors"
                  >
                    Seleção Manual
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  // ─── Navigation mode ──────────────────────────────────────────────────────
  const [mode, setMode] = useState<null | 'resumos' | 'envio-massa'>(null);

  const [contacts, setContacts]     = useState<Contact[]>([]);
  const [results, setResults]       = useState<SendResult[]>([]);
  const [isSending, setIsSending]   = useState(false);
  const [isDone, setIsDone]         = useState(false);

  // Raw spreadsheet data (Resumos mode)
  const [cadastrosData, setCadastrosData] = useState<RawRow[] | null>(null);
  const [cadastrosFile, setCadastrosFile] = useState<string | null>(null);
  const [cadastrosError, setCadastrosError] = useState<string | null>(null);
  const [cadastrosRawRows, setCadastrosRawRows] = useState<WorksheetRows | null>(null);
  const [cadastrosNeedsManualConfig, setCadastrosNeedsManualConfig] = useState(false);
  const [cadastrosMissingLabels, setCadastrosMissingLabels] = useState<string[]>([]);
  const [cadastrosConfig, setCadastrosConfig] = useState<SheetConfig | undefined>(undefined);

  // Multi-file states for Resumos mode categories
  const [cashGameFiles, setCashGameFiles]   = useState<MultiFile[]>([]);
  const [torneioFiles, setTorneioFiles]     = useState<MultiFile[]>([]);
  const [barFiles, setBarFiles]             = useState<MultiFile[]>([]);

  // Envio em Massa mode state
  const [massaCadastrosData, setMassaCadastrosData] = useState<RawRow[] | null>(null);
  const [massaCadastrosFile, setMassaCadastrosFile] = useState<string | null>(null);
  const [massaCadastrosError, setMassaCadastrosError] = useState<string | null>(null);
  const [massaCadastrosRawRows, setMassaCadastrosRawRows] = useState<WorksheetRows | null>(null);
  const [massaCadastrosNeedsManualConfig, setMassaCadastrosNeedsManualConfig] = useState(false);
  const [massaCadastrosMissingLabels, setMassaCadastrosMissingLabels] = useState<string[]>([]);
  const [massaCadastrosConfig, setMassaCadastrosConfig] = useState<SheetConfig | undefined>(undefined);
  const [massaMessage, setMassaMessage] = useState('');
  const [massaImage, setMassaImage] = useState<File | null>(null);
  const [massaImagePreview, setMassaImagePreview] = useState<string | null>(null);
  const [massaResults, setMassaResults] = useState<SendResult[]>([]);
  const [massaIsSending, setMassaIsSending] = useState(false);
  const [massaIsDone, setMassaIsDone] = useState(false);

  // Message template segments
  const [headerTemplate, setHeaderTemplate]   = useState(DEFAULT_HEADER);
  const [cashTemplate, setCashTemplate]       = useState(DEFAULT_CASH);
  const [torneioTemplate, setTorneioTemplate] = useState(DEFAULT_TORNEIO);
  const [barTemplate, setBarTemplate]         = useState(DEFAULT_BAR);
  const [footerTemplate, setFooterTemplate]   = useState(DEFAULT_FOOTER);

  const [waStatus, setWaStatus] = useState<WhatsAppStatus>({ connected: false, hasQr: false, phone: null });
  const [qrImage, setQrImage]   = useState<string | null>(null);
  const [mergeWarnings, setMergeWarnings] = useState<string[]>([]);
  const [manualConfigTarget, setManualConfigTarget] = useState<ManualConfigTarget | null>(null);

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

  // ─── localStorage persistence for templates ───────────────────────────────────

  const STORAGE_KEY = 'wa_template_settings';

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.header   === 'string') setHeaderTemplate(parsed.header);
        if (typeof parsed.cash     === 'string') setCashTemplate(parsed.cash);
        if (typeof parsed.torneio  === 'string') setTorneioTemplate(parsed.torneio);
        if (typeof parsed.bar      === 'string') setBarTemplate(parsed.bar);
        if (typeof parsed.footer   === 'string') setFooterTemplate(parsed.footer);
      }
    } catch { /* ignore parse errors */ }
  }, [setHeaderTemplate, setCashTemplate, setTorneioTemplate, setBarTemplate, setFooterTemplate]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        header:  headerTemplate,
        cash:    cashTemplate,
        torneio: torneioTemplate,
        bar:     barTemplate,
        footer:  footerTemplate,
      }));
    } catch { /* ignore quota errors */ }
  }, [headerTemplate, cashTemplate, torneioTemplate, barTemplate, footerTemplate]);

  // ─── Manual merge ────────────────────────────────────────────────────────────

  function performMerge() {
    console.log('[Merge] 🖱️ Botão clicado');
    if (!cadastrosData || !(cashGameFiles.length > 0 || torneioFiles.length > 0 || barFiles.length > 0)) {
      console.warn('[Merge] ❌ Merge bloqueado: dados insuficientes.', {
        cadastrosData: !!cadastrosData,
        cashGameFiles: cashGameFiles.length,
        torneioFiles: torneioFiles.length,
        barFiles: barFiles.length,
      });
      return;
    }

    console.log('[Merge] ⏳ Iniciando merge...');

    setMergeWarnings([]);

    // Mapa de cadastro: nome normalizado → telefone
    const phoneMap = new Map<string, string>();
    cadastrosData.forEach((r) => {
      const name = String(findMappedCol(r, NAME_ALIASES, 'name', cadastrosConfig) ?? '').trim();
      const phone = String(findMappedCol(r, PHONE_ALIASES, 'phone', cadastrosConfig) ?? '').trim();
      if (name && phone) phoneMap.set(normalizeName(name), phone);
    });
    console.log(`[Merge] 📋 phoneMap gerado com ${phoneMap.size} entrada(s).`);

    // Mapas de gastos: nome normalizado → linha da planilha
    const cashMap = new Map<string, RowWithConfig>();
    const torneioMap = new Map<string, RowWithConfig>();
    const barMap = new Map<string, RowWithConfig>();

    // Conjunto ordenado de nomes (mantém ordem de aparição)
    const namesInOrder: { key: string; originalName: string }[] = [];
    const seenNames = new Set<string>();

    function indexRows(rows: RawRow[], map: Map<string, RowWithConfig>, config?: SheetConfig) {
      rows.forEach((r) => {
        const name = String(findMappedCol(r, NAME_ALIASES, 'name', config) ?? '').trim();
        if (!name) return;
        const key = normalizeName(stripIdSuffix(name));
        map.set(key, { row: r, config });
        if (!seenNames.has(key)) {
          seenNames.add(key);
          namesInOrder.push({ key, originalName: name });
        }
      });
    }

    cashGameFiles.forEach((file) => indexRows(file.data, cashMap, file.config));
    torneioFiles.forEach((file) => indexRows(file.data, torneioMap, file.config));
    barFiles.forEach((file) => indexRows(file.data, barMap, file.config));

    const merged: Contact[] = [];
    const warnings: string[] = [];

    namesInOrder.forEach(({ key, originalName }, i) => {
      const phone = phoneMap.get(key) ?? '';
      if (!phone) {
        console.warn(`[Merge] ⚠️ Sem telefone para: "${originalName}" (ignorado)`);
        warnings.push(originalName);
        return; // sem telefone cadastrado, ignora
      }

      const cashEntry = cashMap.get(key);
      const torneioEntry = torneioMap.get(key);
      const barEntry = barMap.get(key);

      const gastoCashGame = normalizeValue(cashEntry ? findMappedCol(cashEntry.row, CASH_ALIASES, 'cash', cashEntry.config) as string | number | undefined : undefined);
      const saldoTorneio = normalizeValue(torneioEntry ? findMappedCol(torneioEntry.row, TORNEIO_ALIASES, 'torneio', torneioEntry.config) as string | number | undefined : undefined);
      const saldoBar = normalizeValue(barEntry ? findMappedCol(barEntry.row, BAR_ALIASES, 'bar', barEntry.config) as string | number | undefined : undefined);

      // saldoTotal: prefer Cash Game > Torneio > Bar, as specified in the business rules
      // (all three sheets should carry the same value; we just take the first available)
      const saldoTotal = normalizeValue(
        ((cashEntry && findMappedCol(cashEntry.row, TOTAL_ALIASES, undefined, cashEntry.config)) ||
         (torneioEntry && findMappedCol(torneioEntry.row, TOTAL_ALIASES, undefined, torneioEntry.config)) ||
         (barEntry && findMappedCol(barEntry.row, TOTAL_ALIASES, undefined, barEntry.config)) ||
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
    console.log(
      `[Merge] ✅ Merge concluído! ${merged.length} contato(s) mesclado(s), ${warnings.length} ignorado(s) por falta de telefone.`
    );
  }

  // ─── Parse helpers ────────────────────────────────────────────────────────────

  async function parseUploadedSheet(
    file: File,
    requiredFields: SheetRequirement[],
    skipFirstRow = false,
    config?: SheetConfig,
  ): Promise<ParsedSheetResult> {
    const rawRows = await readFileAsWorksheetRows(file);
    if (rawRows.length === 0) {
      return { rows: [], rawRows, needsManualConfig: true, missingLabels: requiredFields.map((f) => f.label), error: 'Planilha vazia.' };
    }
    return config
      ? parseRowsWithConfig(rawRows, requiredFields, config)
      : parseRowsWithAutoHeader(rawRows, requiredFields, skipFirstRow);
  }

  function missingFieldsMessage(labels: string[]): string {
    return `Campos obrigatórios não encontrados: ${labels.join(', ')}.`;
  }

  async function handleCadastros(file: File) {
    setCadastrosError(null);
    setCadastrosFile(file.name);
    setCadastrosConfig(undefined);
    setContacts([]);
    setMergeWarnings([]);
    try {
      const parsed = await parseUploadedSheet(file, CADASTROS_FIELDS);
      setCadastrosRawRows(parsed.rawRows);
      setCadastrosMissingLabels(parsed.missingLabels);
      setCadastrosNeedsManualConfig(parsed.needsManualConfig);
      if (parsed.error) {
        setCadastrosData(null);
        setCadastrosError(parsed.error);
        return;
      }
      if (parsed.needsManualConfig) {
        setCadastrosData(null);
        setCadastrosError(missingFieldsMessage(parsed.missingLabels));
        return;
      }
      setCadastrosData(parsed.rows);
      setCadastrosError(null);
    } catch (err) {
      setCadastrosData(null);
      setCadastrosRawRows(null);
      setCadastrosNeedsManualConfig(false);
      setCadastrosMissingLabels([]);
      setCadastrosError(err instanceof Error ? err.message : 'Erro ao ler o arquivo. Certifique-se de que é um .xlsx válido.');
    }
  }

  async function handleAddCashGame(file: File) {
    setContacts([]);
    setMergeWarnings([]);
    try {
      const parsed = await parseUploadedSheet(file, CASH_FIELDS, true);
      setCashGameFiles((prev) => [
        ...prev,
        {
          name: file.name,
          data: parsed.needsManualConfig ? [] : parsed.rows,
          rawRows: parsed.rawRows,
          needsManualConfig: parsed.needsManualConfig,
          missingLabels: parsed.missingLabels,
          error: parsed.error || (parsed.needsManualConfig ? missingFieldsMessage(parsed.missingLabels) : undefined),
        },
      ]);
    } catch (err) {
      setCashGameFiles((prev) => [...prev, {
        name: file.name,
        data: [],
        error: err instanceof Error ? err.message : 'Erro ao ler o arquivo. Certifique-se de que é um .xlsx válido.',
      }]);
    }
  }

  function handleRemoveCashGame(index: number) {
    setCashGameFiles((prev) => prev.filter((_, i) => i !== index));
    setContacts([]);
    setMergeWarnings([]);
  }

  async function handleAddTorneio(file: File) {
    setContacts([]);
    setMergeWarnings([]);
    try {
      const parsed = await parseUploadedSheet(file, TORNEIO_FIELDS, true);
      setTorneioFiles((prev) => [
        ...prev,
        {
          name: file.name,
          data: parsed.needsManualConfig ? [] : parsed.rows,
          rawRows: parsed.rawRows,
          needsManualConfig: parsed.needsManualConfig,
          missingLabels: parsed.missingLabels,
          error: parsed.error || (parsed.needsManualConfig ? missingFieldsMessage(parsed.missingLabels) : undefined),
        },
      ]);
    } catch (err) {
      setTorneioFiles((prev) => [...prev, {
        name: file.name,
        data: [],
        error: err instanceof Error ? err.message : 'Erro ao ler o arquivo. Certifique-se de que é um .xlsx válido.',
      }]);
    }
  }

  function handleRemoveTorneio(index: number) {
    setTorneioFiles((prev) => prev.filter((_, i) => i !== index));
    setContacts([]);
    setMergeWarnings([]);
  }

  async function handleAddBar(file: File) {
    setContacts([]);
    setMergeWarnings([]);
    try {
      const parsed = await parseUploadedSheet(file, BAR_FIELDS, true);
      setBarFiles((prev) => [
        ...prev,
        {
          name: file.name,
          data: parsed.needsManualConfig ? [] : parsed.rows,
          rawRows: parsed.rawRows,
          needsManualConfig: parsed.needsManualConfig,
          missingLabels: parsed.missingLabels,
          error: parsed.error || (parsed.needsManualConfig ? missingFieldsMessage(parsed.missingLabels) : undefined),
        },
      ]);
    } catch (err) {
      setBarFiles((prev) => [...prev, {
        name: file.name,
        data: [],
        error: err instanceof Error ? err.message : 'Erro ao ler o arquivo. Certifique-se de que é um .xlsx válido.',
      }]);
    }
  }

  function handleRemoveBar(index: number) {
    setBarFiles((prev) => prev.filter((_, i) => i !== index));
    setContacts([]);
    setMergeWarnings([]);
  }

  // Envio em Massa handlers
  async function handleMassaCadastros(file: File) {
    setMassaCadastrosError(null);
    setMassaCadastrosFile(file.name);
    setMassaCadastrosConfig(undefined);
    setMassaResults([]);
    setMassaIsDone(false);
    try {
      const parsed = await parseUploadedSheet(file, CADASTROS_FIELDS);
      setMassaCadastrosRawRows(parsed.rawRows);
      setMassaCadastrosMissingLabels(parsed.missingLabels);
      setMassaCadastrosNeedsManualConfig(parsed.needsManualConfig);
      if (parsed.error) {
        setMassaCadastrosData(null);
        setMassaCadastrosError(parsed.error);
        return;
      }
      if (parsed.needsManualConfig) {
        setMassaCadastrosData(null);
        setMassaCadastrosError(missingFieldsMessage(parsed.missingLabels));
        return;
      }
      setMassaCadastrosData(parsed.rows);
      setMassaCadastrosError(null);
    } catch (err) {
      setMassaCadastrosData(null);
      setMassaCadastrosRawRows(null);
      setMassaCadastrosNeedsManualConfig(false);
      setMassaCadastrosMissingLabels([]);
      setMassaCadastrosError(err instanceof Error ? err.message : 'Erro ao ler o arquivo. Certifique-se de que é um .xlsx válido.');
    }
  }

  function openManualConfigForCadastros() {
    if (!cadastrosRawRows || !cadastrosFile) return;
    setManualConfigTarget({ type: 'cadastros', fileName: cadastrosFile, rawRows: cadastrosRawRows });
  }

  function openManualConfigForMassaCadastros() {
    if (!massaCadastrosRawRows || !massaCadastrosFile) return;
    setManualConfigTarget({ type: 'massa-cadastros', fileName: massaCadastrosFile, rawRows: massaCadastrosRawRows });
  }

  function handleOpenMultiFileManualConfig(type: 'cash' | 'torneio' | 'bar', index: number) {
    const source = type === 'cash' ? cashGameFiles : type === 'torneio' ? torneioFiles : barFiles;
    const target = source[index];
    if (!target?.rawRows) return;
    setManualConfigTarget({ type, index, fileName: target.name, rawRows: target.rawRows });
  }

  function applyManualConfig(config: SheetConfig) {
    if (!manualConfigTarget) return;
    setContacts([]);
    setMergeWarnings([]);

    if (manualConfigTarget.type === 'cadastros') {
      const parsed = parseRowsWithConfig(manualConfigTarget.rawRows, CADASTROS_FIELDS, config);
      setCadastrosConfig(config);
      setCadastrosRawRows(manualConfigTarget.rawRows);
      setCadastrosNeedsManualConfig(parsed.needsManualConfig);
      setCadastrosMissingLabels(parsed.missingLabels);
      setCadastrosData(parsed.needsManualConfig ? null : parsed.rows);
      setCadastrosError(parsed.needsManualConfig ? missingFieldsMessage(parsed.missingLabels) : null);
      setManualConfigTarget(null);
      return;
    }

    if (manualConfigTarget.type === 'massa-cadastros') {
      const parsed = parseRowsWithConfig(manualConfigTarget.rawRows, CADASTROS_FIELDS, config);
      setMassaCadastrosConfig(config);
      setMassaCadastrosRawRows(manualConfigTarget.rawRows);
      setMassaCadastrosNeedsManualConfig(parsed.needsManualConfig);
      setMassaCadastrosMissingLabels(parsed.missingLabels);
      setMassaCadastrosData(parsed.needsManualConfig ? null : parsed.rows);
      setMassaCadastrosError(parsed.needsManualConfig ? missingFieldsMessage(parsed.missingLabels) : null);
      setManualConfigTarget(null);
      return;
    }

    if (manualConfigTarget.type === 'cash') {
      const parsed = parseRowsWithConfig(manualConfigTarget.rawRows, CASH_FIELDS, config);
      setCashGameFiles((prev) => prev.map((file, i) => i === manualConfigTarget.index
        ? {
            ...file,
            config,
            data: parsed.needsManualConfig ? [] : parsed.rows,
            needsManualConfig: parsed.needsManualConfig,
            missingLabels: parsed.missingLabels,
            error: parsed.needsManualConfig ? missingFieldsMessage(parsed.missingLabels) : undefined,
          }
        : file));
      setManualConfigTarget(null);
      return;
    }

    if (manualConfigTarget.type === 'torneio') {
      const parsed = parseRowsWithConfig(manualConfigTarget.rawRows, TORNEIO_FIELDS, config);
      setTorneioFiles((prev) => prev.map((file, i) => i === manualConfigTarget.index
        ? {
            ...file,
            config,
            data: parsed.needsManualConfig ? [] : parsed.rows,
            needsManualConfig: parsed.needsManualConfig,
            missingLabels: parsed.missingLabels,
            error: parsed.needsManualConfig ? missingFieldsMessage(parsed.missingLabels) : undefined,
          }
        : file));
      setManualConfigTarget(null);
      return;
    }

    const parsed = parseRowsWithConfig(manualConfigTarget.rawRows, BAR_FIELDS, config);
    setBarFiles((prev) => prev.map((file, i) => i === manualConfigTarget.index
      ? {
          ...file,
          config,
          data: parsed.needsManualConfig ? [] : parsed.rows,
          needsManualConfig: parsed.needsManualConfig,
          missingLabels: parsed.missingLabels,
          error: parsed.needsManualConfig ? missingFieldsMessage(parsed.missingLabels) : undefined,
        }
      : file));
    setManualConfigTarget(null);
  }

  async function sendMassMessages() {
    if (!waStatus.connected || !massaCadastrosData) return;
    if (!massaImage && !massaMessage.trim()) return;
    setMassaIsSending(true);
    setMassaResults([]);

    const payload = massaCadastrosData
      .map((r) => ({
        name:  String(findMappedCol(r, NAME_ALIASES, 'name', massaCadastrosConfig) ?? '').trim(),
        phone: String(findMappedCol(r, PHONE_ALIASES, 'phone', massaCadastrosConfig) ?? '').trim(),
      }))
      .filter((c) => c.name && c.phone)
      .map((c) => ({
        name:    c.name,
        phone:   c.phone,
        message: massaMessage.replace(/<nome>/g, c.name),
      }));

    try {
      let res;
      if (massaImage) {
        const imageBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
          };
          reader.onerror = () => reject(new Error('Falha ao ler o arquivo de imagem'));
          reader.readAsDataURL(massaImage);
        });
        res = await fetch(`${SERVER_URL}/send-image`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ contacts: payload, imageBase64, mimeType: massaImage.type }),
        });
      } else {
        res = await fetch(`${SERVER_URL}/send`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ contacts: payload }),
        });
      }
      const data = await res.json();
      setMassaResults(data.results || []);
      setMassaIsDone(true);
    } catch (err) {
      console.error('[sendMassMessages] Erro:', err);
      alert('Erro ao conectar com o servidor. Verifique se ele está rodando.');
    } finally {
      setMassaIsSending(false);
    }
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

  const hasMergeSourceData = cashGameFiles.some((f) => f.data.length > 0)
    || torneioFiles.some((f) => f.data.length > 0)
    || barFiles.some((f) => f.data.length > 0);
  const canMerge = !!(cadastrosData && hasMergeSourceData);
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

  const massaContactCount = massaCadastrosData
    ? massaCadastrosData.filter((r) =>
      findMappedCol(r, NAME_ALIASES, 'name', massaCadastrosConfig)
      && findMappedCol(r, PHONE_ALIASES, 'phone', massaCadastrosConfig)).length
    : 0;
  const massaSuccessCount = massaResults.filter((r) => r.success).length;
  const massaErrorCount   = massaResults.filter((r) => !r.success).length;
  const requiredFieldsByTargetType: Record<ManualConfigTarget['type'], SheetRequirement[]> = {
    cadastros: CADASTROS_FIELDS,
    'massa-cadastros': CADASTROS_FIELDS,
    cash: CASH_FIELDS,
    torneio: TORNEIO_FIELDS,
    bar: BAR_FIELDS,
  };
  const requiredFieldsForManualTarget: SheetRequirement[] = manualConfigTarget
    ? requiredFieldsByTargetType[manualConfigTarget.type]
    : BAR_FIELDS;

  // ─── QR Code block (shared) ───────────────────────────────────────────────────

  const qrBlock = !waStatus.connected && (
    <div className="bg-emerald-950/30 border border-emerald-900/30 rounded-xl shadow-sm p-6 flex flex-col items-center gap-4">
      <h2 className="text-lg font-semibold text-slate-100">Conecte o WhatsApp</h2>
      {qrImage ? (
        <>
          <p className="text-slate-300 text-sm text-center">
            Abra o WhatsApp no celular → Menu (⋮) → Aparelhos conectados → Conectar aparelho
          </p>
          <img src={qrImage} alt="QR Code WhatsApp" className="w-56 h-56 rounded-lg border" />
        </>
      ) : (
        <p className="text-slate-300 text-sm">Aguardando QR Code do servidor…</p>
      )}
    </div>
  );

  // ─── Render ──────────────────────────────────────────────────────────────────

  // ── Mode selection screen ────────────────────────────────────────────────────
  if (mode === null) {
    return (
      <div className="min-h-screen bg-felt text-slate-100">
        <Header waStatus={waStatus} />
        <main className="max-w-5xl mx-auto px-6 py-12 space-y-10 relative">
          {/* soft green glow */}
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#04160e]" />
            <div
              className="absolute left-1/2 -translate-x-1/2 top-24 w-[780px] h-[420px] rounded-full opacity-10"
              style={{
                filter: 'blur(32px)',
                background:
                  'radial-gradient(circle at 30% 30%, #10b981, rgba(16,185,129,0.06) 40%, transparent 70%)',
              }}
            />
          </div>

          <WhatsAppConnect waStatus={waStatus} qrImage={qrImage} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FeatureCard
              icon={BarChart3}
              title="Resumos Diários"
              description="Faça upload das planilhas de Cadastros, Cash Game, Torneio e Bar, mescle os dados e envie mensagens personalizadas para cada jogador."
              iconColor="bg-accent"
              onClick={() => setMode('resumos')}
            />
            <FeatureCard
              icon={Send}
              title="Envio em Massa"
              description="Digite uma mensagem e envie para todos os contatos de uma planilha de Cadastros de uma só vez."
              iconColor="bg-whatsapp"
              onClick={() => setMode('envio-massa')}
            />
          </div>
        </main>
      </div>
    );
  }

  // ── Envio em Massa screen ────────────────────────────────────────────────────
  if (mode === 'envio-massa') {
    return (
      <div className="min-h-screen bg-felt text-slate-100">
        <Header waStatus={waStatus} />
        <main className="max-w-3xl mx-auto px-6 py-10 space-y-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMode(null)}
              className="text-sm text-slate-400 hover:text-slate-100 border border-emerald-900/40 hover:border-emerald-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              ← Voltar
            </button>
            <div>
              <h1 className="text-2xl font-bold text-slate-100">📨 Envio em Massa</h1>
              <p className="text-slate-400 text-sm mt-0.5">Envie a mesma mensagem para todos os contatos</p>
            </div>
          </div>

          {qrBlock}

          {/* Cadastros upload */}
          <div className="bg-emerald-950/30 rounded-xl shadow-sm border border-emerald-900/30 p-5 space-y-4">
            <h2 className="font-semibold text-slate-100">📤 Planilha de Contatos</h2>
            <div className="max-w-xs">
              <UploadZone
                label="Cadastros"
                icon="📋"
                fileName={massaCadastrosFile}
                loaded={!!massaCadastrosData}
                error={massaCadastrosError}
                required
                onFile={handleMassaCadastros}
              />
            </div>
            {massaCadastrosNeedsManualConfig && massaCadastrosRawRows && (
              <div className="max-w-xs p-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
                <p className="text-xs text-amber-300">
                  ⚠️ Campos não encontrados: {massaCadastrosMissingLabels.join(', ')}
                </p>
                <button
                  type="button"
                  onClick={openManualConfigForMassaCadastros}
                  className="mt-2 text-xs px-2 py-1 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 transition-colors"
                >
                  Seleção Manual
                </button>
              </div>
            )}
            {massaCadastrosData && (
              <p className="text-xs text-green-700 font-medium">
                ✅ {massaContactCount} contato{massaContactCount !== 1 ? 's' : ''} carregado{massaContactCount !== 1 ? 's' : ''}
              </p>
            )}
          </div>

          {/* Message textarea */}
          <div className="bg-emerald-950/30 rounded-xl shadow-sm border border-emerald-900/30 p-5 space-y-3">
            <h2 className="font-semibold text-slate-100">✉️ Mensagem</h2>
            <textarea
              value={massaMessage}
              onChange={(e) => setMassaMessage(e.target.value)}
              placeholder={"Digite a mensagem que será enviada a todos os contatos…\n\nUse <nome> para personalizar com o nome de cada contato."}
              rows={8}
              className="w-full font-mono text-sm border border-emerald-900/30 rounded-lg p-3 resize-y focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 bg-emerald-950/20 text-slate-100 placeholder-slate-500"
            />
            <p className="text-xs text-slate-400">
              Opcional: use <code className="bg-emerald-900/30 rounded px-1">&lt;nome&gt;</code> para inserir o nome do contato na mensagem.
            </p>
          </div>

          {/* Image upload */}
          <div className="bg-emerald-950/30 rounded-xl shadow-sm border border-emerald-900/30 p-5 space-y-3">
            <h2 className="font-semibold text-slate-100">🖼️ Imagem (opcional)</h2>
            <p className="text-xs text-slate-400">Opcional: adicione uma imagem. O texto acima será enviado como legenda.</p>
            {massaImagePreview ? (
              <div className="flex flex-col gap-2">
                <img src={massaImagePreview} alt="Preview" className="max-h-48 rounded-lg border border-emerald-900/30 object-contain" />
                <button
                  onClick={() => { if (massaImagePreview) URL.revokeObjectURL(massaImagePreview); setMassaImage(null); setMassaImagePreview(null); }}
                  className="self-start text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-3 py-1 rounded-lg transition-colors"
                >
                  Remover imagem
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-emerald-900/40 rounded-lg cursor-pointer hover:border-purple-400 hover:bg-purple-900/20 transition-colors">
                <span className="text-2xl mb-1">📎</span>
                <span className="text-xs text-slate-400">Clique para selecionar uma imagem</span>
                <span className="text-xs text-slate-500">.jpg, .jpeg, .png, .gif, .webp</span>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.gif,.webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setMassaImage(file);
                    if (file) {
                      setMassaImagePreview((prev) => {
                        if (prev) URL.revokeObjectURL(prev);
                        return URL.createObjectURL(file);
                      });
                    } else {
                      setMassaImagePreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
                    }
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </div>

          {/* Send button */}
          <div className="bg-emerald-950/30 rounded-xl shadow-sm border border-emerald-900/30 p-5 flex items-center justify-between">
            {!waStatus.connected && (
              <p className="text-sm text-amber-600">⚠️ Conecte o WhatsApp antes de enviar</p>
            )}
            {waStatus.connected && <p className="text-sm text-slate-400" />}
            <button
              onClick={sendMassMessages}
              disabled={massaIsSending || !waStatus.connected || !massaCadastrosData || (!massaImage && !massaMessage.trim())}
              className={`px-6 py-2.5 rounded-lg font-semibold text-sm transition-all
                ${massaIsSending || !waStatus.connected || !massaCadastrosData || (!massaImage && !massaMessage.trim())
                  ? 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
                  : 'bg-purple-600 hover:bg-purple-700 text-white shadow-sm'
                }`}
            >
              {massaIsSending
                ? `Enviando… (${massaResults.length}/${massaContactCount})`
                : `Enviar para todos (${massaContactCount})`}
            </button>
          </div>

          {/* Results */}
          {massaIsDone && massaResults.length > 0 && (
            <div className="bg-emerald-950/30 rounded-xl shadow-sm border border-emerald-900/30 overflow-hidden">
              <div className="px-5 py-4 border-b">
                <h2 className="font-semibold text-slate-100">Resultado do envio</h2>
                <p className="text-sm text-slate-400 mt-0.5">
                  ✅ {massaSuccessCount} enviado{massaSuccessCount !== 1 ? 's' : ''}&nbsp;&nbsp;
                  {massaErrorCount > 0 && <>❌ {massaErrorCount} com erro</>}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-emerald-900/20 text-slate-400 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-3 text-left">Nome</th>
                      <th className="px-4 py-3 text-left">Telefone</th>
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-4 py-3 text-left">Detalhe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-900/20">
                    {massaResults.map((r, i) => (
                      <tr key={i} className="hover:bg-emerald-900/20">
                        <td className="px-4 py-3 font-medium text-slate-100">{r.name}</td>
                        <td className="px-4 py-3 text-slate-300">{r.phone}</td>
                        <td className="px-4 py-3 text-center">
                          {r.success ? (
                            <span className="text-green-600 font-semibold">✅ Enviado</span>
                          ) : (
                            <span className="text-red-500 font-semibold">❌ Erro</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs">{r.error || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
        {manualConfigTarget && (
          <ManualConfigModal
            fileName={manualConfigTarget.fileName}
            rawRows={manualConfigTarget.rawRows}
            requiredFields={requiredFieldsForManualTarget}
            onCancel={() => setManualConfigTarget(null)}
            onConfirm={applyManualConfig}
          />
        )}
      </div>
    );
  }

  // ── Resumos Diários screen ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-felt text-slate-100">
      <Header waStatus={waStatus} />
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMode(null)}
            className="text-sm text-slate-400 hover:text-slate-100 border border-emerald-900/40 hover:border-emerald-700 px-3 py-1.5 rounded-lg transition-colors"
          >
            ← Voltar
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">📊 Resumos Diários</h1>
            <p className="text-slate-400 text-sm mt-0.5">Envie o resumo de consumo do dia pelo WhatsApp</p>
          </div>
        </div>

        {/* QR Code */}
        {qrBlock}

        {/* Planilhas */}
        <div className="bg-emerald-950/30 rounded-xl shadow-sm border border-emerald-900/30 p-5">
          <h2 className="font-semibold text-slate-100 mb-4">📤 Planilhas</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="flex flex-col gap-2">
              <UploadZone
                label="Cadastros"  icon="📋"
                fileName={cadastrosFile} loaded={!!cadastrosData} error={cadastrosError}
                required onFile={handleCadastros}
              />
              {cadastrosNeedsManualConfig && cadastrosRawRows && (
                <div className="p-2 rounded-lg border border-amber-500/30 bg-amber-500/10">
                  <p className="text-xs text-amber-300">
                    ⚠️ Campos não encontrados: {cadastrosMissingLabels.join(', ')}
                  </p>
                  <button
                    type="button"
                    onClick={openManualConfigForCadastros}
                    className="mt-1 text-xs px-2 py-1 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 transition-colors"
                  >
                    Seleção Manual
                  </button>
                </div>
              )}
            </div>
            <MultiUploadZone
              label="Cash Game"  icon="🎲"
              files={cashGameFiles}
              onAdd={handleAddCashGame}
              onRemove={handleRemoveCashGame}
              onManualConfig={(index) => handleOpenMultiFileManualConfig('cash', index)}
            />
            <MultiUploadZone
              label="Torneio"  icon="🏆"
              files={torneioFiles}
              onAdd={handleAddTorneio}
              onRemove={handleRemoveTorneio}
              onManualConfig={(index) => handleOpenMultiFileManualConfig('torneio', index)}
            />
            <MultiUploadZone
              label="Bar"  icon="🍺"
              files={barFiles}
              onAdd={handleAddBar}
              onRemove={handleRemoveBar}
              onManualConfig={(index) => handleOpenMultiFileManualConfig('bar', index)}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={performMerge}
              disabled={!canMerge}
              className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all
                ${!canMerge
                  ? 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
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
        <div className="bg-emerald-950/30 rounded-xl shadow-sm border border-emerald-900/30 overflow-hidden">
          <div className="px-5 py-3 border-b border-emerald-900/40 flex items-center justify-between">
            <h2 className="font-semibold text-slate-100">✏️ Construtor de mensagem</h2>
            <button
              onClick={() => {
                setHeaderTemplate(DEFAULT_HEADER);
                setCashTemplate(DEFAULT_CASH);
                setTorneioTemplate(DEFAULT_TORNEIO);
                setBarTemplate(DEFAULT_BAR);
                setFooterTemplate(DEFAULT_FOOTER);
                try { localStorage.removeItem('wa_template_settings'); } catch { /* ignore */ }
              }}
              className="text-xs text-slate-400 hover:text-green-400 border border-emerald-900/30 hover:border-green-500 px-3 py-1 rounded-lg transition-colors"
            >
              Restaurar padrão
            </button>
          </div>

          <div className="p-5">
            <div className="flex flex-col md:flex-row gap-6 items-stretch md:items-start">
              {/* ─── Left: editor (takes more space) ─────────────────────────── */}
              <div className="w-full flex-1 min-w-0 space-y-4">
                {/* Cabeçalho */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Cabeçalho</label>
                  <textarea
                    value={headerTemplate}
                    onChange={(e) => setHeaderTemplate(e.target.value)}
                    className="font-mono text-sm border border-emerald-900/30 rounded-lg p-3 resize-y h-[67px] focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 bg-emerald-950/20 text-slate-100"
                  />
                  <p className="text-xs text-slate-400">Variável: <code className="bg-emerald-900/30 rounded px-1">&lt;nome&gt;</code></p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Cash Game */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold px-2 py-0.5 rounded text-white" style={{ background: '#059669' }}>CASH</span>
                      <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Cash Game</label>
                    </div>
                    <textarea
                      value={cashTemplate}
                      onChange={(e) => setCashTemplate(e.target.value)}
                      className="font-mono text-sm border rounded-lg p-3 resize-y h-20 focus:outline-none focus:ring-1 focus:ring-green-600"
                      style={{ background: '#d1fae5', borderColor: '#065f46', color: '#064e3b' }}
                    />
                    <p className="text-xs text-slate-400">Variável: <code className="bg-emerald-900/30 rounded px-1">&lt;gastoCashGame&gt;</code></p>
                  </div>

                  {/* Torneio */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold px-2 py-0.5 rounded text-white" style={{ background: '#2563eb' }}>TORNEIO</span>
                      <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Torneio</label>
                    </div>
                    <textarea
                      value={torneioTemplate}
                      onChange={(e) => setTorneioTemplate(e.target.value)}
                      className="font-mono text-sm border rounded-lg p-3 resize-y h-20 focus:outline-none focus:ring-1 focus:ring-blue-600"
                      style={{ background: '#dbeafe', borderColor: '#1e40af', color: '#1e3a8a' }}
                    />
                    <p className="text-xs text-slate-400">Variável: <code className="bg-emerald-900/30 rounded px-1">&lt;saldoTorneio&gt;</code></p>
                  </div>

                  {/* Bar */}
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold px-2 py-0.5 rounded text-white" style={{ background: '#9d174d' }}>BAR</span>
                      <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Bar</label>
                    </div>
                    <textarea
                      value={barTemplate}
                      onChange={(e) => setBarTemplate(e.target.value)}
                      className="font-mono text-sm border rounded-lg p-3 resize-y h-20 focus:outline-none focus:ring-1 focus:ring-pink-700"
                      style={{ background: '#fce7f3', borderColor: '#9d174d', color: '#831843' }}
                    />
                    <p className="text-xs text-slate-400">Variável: <code className="bg-emerald-900/30 rounded px-1">&lt;saldoBar&gt;</code></p>
                  </div>
                </div>

                {/* Rodapé */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Rodapé</label>
                  <textarea
                    value={footerTemplate}
                    onChange={(e) => setFooterTemplate(e.target.value)}
                    className="font-mono text-sm border border-emerald-900/30 rounded-lg p-3 resize-y h-[295px] focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 bg-emerald-950/20 text-slate-100"
                  />
                  <p className="text-xs text-slate-400">Variáveis: <code className="bg-emerald-900/30 rounded px-1">&lt;saldoDia&gt;</code> <code className="bg-emerald-900/30 rounded px-1">&lt;saldoTotal&gt;</code></p>
                </div>
              </div>

              {/* ─── Right: phone-like preview ────────────────────────────────── */}
              <div className="w-full md:w-64 lg:w-72 shrink-0 flex flex-col gap-2 self-stretch">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide text-center">
                  Pré-visualização {previewContact ? `(${previewContact.name})` : '(exemplo)'}
                </p>
                {/* Phone outer casing (black frame) */}
                <div
                  className="flex-1 rounded-[28px] bg-black p-[10px] shadow-xl"
                  style={{ minHeight: '560px' }}
                >
                  {/* Phone screen (white inner area) */}
                  <div className="rounded-2xl bg-white flex flex-col h-full p-4 text-sm" style={{ minHeight: '500px' }}>
                  {/* Bolinha preta central no topo */}
                  <div className="flex justify-center">
                    <span className="w-3 h-3 bg-black rounded-full mb-3" />
                  </div>

                  {/* Conteúdo rolável */}
                  <div className="overflow-y-auto space-y-2 flex-1">
                  {/* Header: dentro de um retângulo cinza claro com cantos arredondados */}
                  <div className="bg-slate-100 text-gray-900 rounded-lg px-3 py-2 mb-2">
                    <div
                      className="text-xs leading-snug"
                      dangerouslySetInnerHTML={{
                        __html: whatsAppToHtml(headerTemplate.replace(/<nome>/g, exampleContact.name)),
                      }}
                    />
                  </div>

                  {/* Cash Game segment */}
                  <div
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-opacity"
                    style={{
                      background: hasCash || !previewContact ? '#d1fae5' : 'transparent',
                      opacity:    hasCash || !previewContact ? 1 : 0.4,
                    }}
                  >
                    <span
                      className="flex-1 text-xs leading-snug"
                      style={{ color: '#064e3b' }}
                      dangerouslySetInnerHTML={{
                        __html: whatsAppToHtml(cashTemplate.replace(/<gastoCashGame>/g, formatCurrency(exampleContact.gastoCashGame))),
                      }}
                    />
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
                    <span
                      className="flex-1 text-xs leading-snug"
                      style={{ color: '#1e3a8a' }}
                      dangerouslySetInnerHTML={{
                        __html: whatsAppToHtml(torneioTemplate.replace(/<saldoTorneio>/g, formatCurrency(exampleContact.saldoTorneio))),
                      }}
                    />
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
                    <span
                      className="flex-1 text-xs leading-snug"
                      style={{ color: '#831843' }}
                      dangerouslySetInnerHTML={{
                        __html: whatsAppToHtml(barTemplate.replace(/<saldoBar>/g, formatCurrency(exampleContact.saldoBar))),
                      }}
                    />
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0 text-white" style={{ background: '#9d174d' }}>
                      {hasBar || !previewContact ? 'BAR' : 'BAR ❌'}
                    </span>
                  </div>

                  {/* Footer */}
                  <div
                    className="text-gray-900 mt-2 text-xs leading-snug"
                    dangerouslySetInnerHTML={{
                      __html: whatsAppToHtml(
                        footerTemplate
                          .replace(/<saldoDia>/g, formatCurrency(exampleContact.saldoDia))
                          .replace(/<saldoTotal>/g, formatCurrency(exampleContact.saldoTotal)),
                      ),
                    }}
                  />
                  </div>

                  {/* Rodapé simulado: caixa de digitação + botão verde */}
                  <div className="mt-3 pt-3 border-t flex items-center gap-2">
                    <div className="flex-1 h-10 bg-slate-100 rounded-full px-4 flex items-center text-xs text-slate-500">
                      Digite uma mensagem...
                    </div>
                    <button
                      className="h-10 w-10 bg-emerald-600 hover:bg-emerald-700 rounded-full flex items-center justify-center shrink-0"
                      aria-label="Gravar áudio"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" className="w-5 h-5" aria-hidden="true">
                        <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm6.364 9.364a1 1 0 0 1 1 1A7.364 7.364 0 0 1 13 18.899V21h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.101A7.364 7.364 0 0 1 4.636 11.364a1 1 0 0 1 2 0A5.364 5.364 0 0 0 12 16.727a5.364 5.364 0 0 0 5.364-5.363 1 1 0 0 1 1-1z"/>
                      </svg>
                    </button>
                  </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabela de contatos */}
        {contacts.length > 0 && (
          <div className="bg-emerald-950/30 rounded-xl shadow-sm border border-emerald-900/30 overflow-hidden">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h2 className="font-semibold text-slate-100">
                {contacts.length} contato{contacts.length !== 1 ? 's' : ''} para envio
              </h2>
              <span className="text-xs text-slate-400">Clique em × para remover</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-emerald-900/20 text-slate-400 text-xs uppercase tracking-wide">
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
                <tbody className="divide-y divide-emerald-900/20">
                  {contacts.map((c) => (
                    <tr key={c.id} className="hover:bg-emerald-900/20 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-100">{c.name}</td>
                      <td className="px-4 py-3 text-slate-300">{c.phone}</td>
                      <td className="px-4 py-3 text-right text-slate-100">
                        {formatOptionalCurrency(c.gastoCashGame)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-100">
                        {formatOptionalCurrency(c.saldoTorneio)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-100">
                        {formatOptionalCurrency(c.saldoBar)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-100">
                        {formatOptionalCurrency(c.saldoDia)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-100">
                        {formatOptionalCurrency(c.saldoTotal)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => removeContact(c.id)}
                          className="text-slate-400 hover:text-red-500 transition-colors font-bold text-base w-7 h-7 rounded-full hover:bg-red-900/30"
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
            <div className="px-5 py-4 border-t border-emerald-900/20 bg-emerald-950/20 flex items-center justify-between">
              {!waStatus.connected && (
                <p className="text-sm text-amber-600">⚠️ Conecte o WhatsApp antes de enviar</p>
              )}
              {waStatus.connected && <p className="text-sm text-slate-400" />}
              <button
                onClick={sendMessages}
                disabled={isSending || !waStatus.connected || contacts.length === 0}
                className={`px-6 py-2.5 rounded-lg font-semibold text-sm transition-all
                  ${isSending || !waStatus.connected || contacts.length === 0
                    ? 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
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
          <div className="bg-emerald-950/30 rounded-xl shadow-sm border border-emerald-900/30 overflow-hidden">
            <div className="px-5 py-4 border-b">
              <h2 className="font-semibold text-slate-100">Resultado do envio</h2>
              <p className="text-sm text-slate-400 mt-0.5">
                ✅ {successCount} enviado{successCount !== 1 ? 's' : ''}&nbsp;&nbsp;
                {errorCount > 0 && <>❌ {errorCount} com erro</>}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-emerald-900/20 text-slate-400 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Nome</th>
                    <th className="px-4 py-3 text-left">Telefone</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-left">Detalhe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-900/20">
                  {results.map((r, i) => (
                    <tr key={i} className="hover:bg-emerald-900/20">
                      <td className="px-4 py-3 font-medium text-slate-100">{r.name}</td>
                      <td className="px-4 py-3 text-slate-300">{r.phone}</td>
                      <td className="px-4 py-3 text-center">
                        {r.success ? (
                          <span className="text-green-600 font-semibold">✅ Enviado</span>
                        ) : (
                          <span className="text-red-500 font-semibold">❌ Erro</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{r.error || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </main>
      {manualConfigTarget && (
        <ManualConfigModal
          fileName={manualConfigTarget.fileName}
          rawRows={manualConfigTarget.rawRows}
          requiredFields={requiredFieldsForManualTarget}
          onCancel={() => setManualConfigTarget(null)}
          onConfirm={applyManualConfig}
        />
      )}
    </div>
  );
}
