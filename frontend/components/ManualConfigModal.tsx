'use client';

import { useEffect, useMemo, useState } from 'react';

export type SheetConfig = {
  headerRowIndex: number;
  columnMap: Record<string, string>;
};

export type ManualFieldRequirement = {
  key: string;
  label: string;
  aliases: string[];
};

type ManualConfigModalProps = {
  fileName: string;
  rawRows: unknown[][];
  requiredFields: ManualFieldRequirement[];
  onConfirm: (config: SheetConfig) => void;
  onCancel: () => void;
};

const PREVIEW_ROWS = 10;
const PREVIEW_COLS = 8;

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function cellToText(value: unknown): string {
  return String(value ?? '').trim();
}

export default function ManualConfigModal({
  fileName,
  rawRows,
  requiredFields,
  onConfirm,
  onCancel,
}: ManualConfigModalProps) {
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});

  useEffect(() => {
    setHeaderRowIndex(0);
    setColumnMap({});
  }, [fileName]);

  const previewRows = useMemo(() => rawRows.slice(0, PREVIEW_ROWS), [rawRows]);

  const previewColumnCount = useMemo(() => {
    const max = previewRows.reduce((acc, row) => Math.max(acc, row.length), 0);
    return Math.max(1, Math.min(PREVIEW_COLS, max));
  }, [previewRows]);

  const headerValues = useMemo(() => rawRows[headerRowIndex] ?? [], [rawRows, headerRowIndex]);

  const columnOptions = useMemo(() => {
    const optionCount = Math.max(headerValues.length, 1);
    return Array.from({ length: optionCount }, (_, index) => {
      const raw = cellToText(headerValues[index]);
      const value = raw || `Coluna ${index + 1}`;
      return { value, label: `${value} (#${index + 1})` };
    });
  }, [headerValues]);

  useEffect(() => {
    setColumnMap((prev) => {
      const next: Record<string, string> = {};
      const optionValues = new Set(columnOptions.map((opt) => opt.value));

      for (const field of requiredFields) {
        const kept = prev[field.key];
        if (kept && optionValues.has(kept)) {
          next[field.key] = kept;
          continue;
        }

        const auto = columnOptions.find((opt) => {
          const normalized = normalizeHeader(opt.value);
          return field.aliases.some((alias) => normalizeHeader(alias) === normalized);
        });
        next[field.key] = auto?.value ?? '';
      }
      return next;
    });
  }, [columnOptions, requiredFields]);

  const canConfirm = requiredFields.every((field) => Boolean(columnMap[field.key]));

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl max-h-[92vh] overflow-auto bg-emerald-950 border border-emerald-900/40 rounded-xl shadow-2xl">
        <div className="sticky top-0 z-10 bg-emerald-950/95 backdrop-blur border-b border-emerald-900/40 px-5 py-4">
          <h3 className="text-lg font-semibold text-slate-100">Seleção manual · {fileName}</h3>
          <p className="text-xs text-slate-400 mt-1">1) Selecione a linha de cabeçalho · 2) Escolha a coluna de cada campo obrigatório</p>
        </div>

        <div className="p-5 space-y-5">
          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-slate-100">1. Linha de cabeçalho</h4>
            <p className="text-xs text-slate-400">Clique em uma linha da pré-visualização para defini-la como cabeçalho.</p>
            <div className="overflow-x-auto border border-emerald-900/40 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-emerald-900/30 text-slate-300">
                  <tr>
                    <th className="px-2 py-2 text-left w-20">Linha</th>
                    {Array.from({ length: previewColumnCount }).map((_, i) => (
                      <th key={i} className="px-2 py-2 text-left">Coluna {i + 1}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, rowIndex) => (
                    <tr
                      key={rowIndex}
                      onClick={() => setHeaderRowIndex(rowIndex)}
                      className={`cursor-pointer border-t border-emerald-900/20 ${
                        headerRowIndex === rowIndex ? 'bg-blue-900/40' : 'hover:bg-emerald-900/20'
                      }`}
                    >
                      <td className="px-2 py-2 font-semibold text-slate-300">#{rowIndex + 1}</td>
                      {Array.from({ length: previewColumnCount }).map((__, colIndex) => (
                        <td key={colIndex} className="px-2 py-2 text-slate-200 max-w-[200px] truncate">
                          {cellToText(row[colIndex]) || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-100">2. Mapeamento de colunas</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {requiredFields.map((field) => (
                <label key={field.key} className="flex flex-col gap-1">
                  <span className="text-xs text-slate-300 font-medium">{field.label}</span>
                  <select
                    value={columnMap[field.key] ?? ''}
                    onChange={(e) => setColumnMap((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    className="bg-emerald-950/30 border border-emerald-900/40 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="">Selecione a coluna</option>
                    {columnOptions.map((option) => (
                      <option key={option.label} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>
        </div>

        <div className="sticky bottom-0 bg-emerald-950/95 backdrop-blur border-t border-emerald-900/40 px-5 py-4 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-emerald-900/40 text-slate-300 hover:text-slate-100 hover:border-emerald-700 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm({ headerRowIndex, columnMap })}
            disabled={!canConfirm}
            className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
              canConfirm ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
            }`}
          >
            Confirmar seleção
          </button>
        </div>
      </div>
    </div>
  );
}
