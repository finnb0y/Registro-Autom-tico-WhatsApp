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
const FIELD_COLORS = [
  {
    dot: 'bg-sky-400',
    button: 'border-sky-500/40 bg-sky-500/10 text-sky-100 hover:bg-sky-500/20',
    buttonActive: 'ring-2 ring-sky-300 border-sky-400/70 bg-sky-500/20',
    column: 'bg-sky-500/18',
    columnHover: 'hover:bg-sky-500/12',
  },
  {
    dot: 'bg-violet-400',
    button: 'border-violet-500/40 bg-violet-500/10 text-violet-100 hover:bg-violet-500/20',
    buttonActive: 'ring-2 ring-violet-300 border-violet-400/70 bg-violet-500/20',
    column: 'bg-violet-500/18',
    columnHover: 'hover:bg-violet-500/12',
  },
  {
    dot: 'bg-amber-400',
    button: 'border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20',
    buttonActive: 'ring-2 ring-amber-300 border-amber-400/70 bg-amber-500/20',
    column: 'bg-amber-500/18',
    columnHover: 'hover:bg-amber-500/12',
  },
  {
    dot: 'bg-emerald-400',
    button: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20',
    buttonActive: 'ring-2 ring-emerald-300 border-emerald-400/70 bg-emerald-500/20',
    column: 'bg-emerald-500/18',
    columnHover: 'hover:bg-emerald-500/12',
  },
  {
    dot: 'bg-rose-400',
    button: 'border-rose-500/40 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20',
    buttonActive: 'ring-2 ring-rose-300 border-rose-400/70 bg-rose-500/20',
    column: 'bg-rose-500/18',
    columnHover: 'hover:bg-rose-500/12',
  },
  {
    dot: 'bg-cyan-400',
    button: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20',
    buttonActive: 'ring-2 ring-cyan-300 border-cyan-400/70 bg-cyan-500/20',
    column: 'bg-cyan-500/18',
    columnHover: 'hover:bg-cyan-500/12',
  },
];

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
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(requiredFields[0]?.key ?? null);

  useEffect(() => {
    setHeaderRowIndex(0);
    setColumnMap({});
    setActiveFieldKey(requiredFields[0]?.key ?? null);
  }, [fileName, requiredFields]);

  const previewRows = useMemo(() => rawRows.slice(0, PREVIEW_ROWS), [rawRows]);

  const previewColumnCount = useMemo(() => {
    const max = previewRows.reduce((acc, row) => Math.max(acc, row.length), 0);
    return Math.max(1, max);
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

  useEffect(() => {
    if (requiredFields.length === 0) {
      setActiveFieldKey(null);
      return;
    }

    if (!activeFieldKey || !requiredFields.some((field) => field.key === activeFieldKey)) {
      setActiveFieldKey(requiredFields[0].key);
    }
  }, [activeFieldKey, requiredFields]);

  const fieldStyles = useMemo(
    () =>
      Object.fromEntries(
        requiredFields.map((field, index) => [field.key, FIELD_COLORS[index % FIELD_COLORS.length]]),
      ),
    [requiredFields],
  );

  const fieldByColumn = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(columnMap)
          .filter(([, value]) => Boolean(value))
          .map(([fieldKey, value]) => [value, fieldKey]),
      ),
    [columnMap],
  );

  function handleColumnSelection(columnIndex: number) {
    if (!activeFieldKey) return;
    const selectedColumn = columnOptions[columnIndex];
    if (!selectedColumn) return;

    const nextMap = requiredFields.reduce<Record<string, string>>((acc, field) => {
      const previousValue = columnMap[field.key] ?? '';
      if (field.key === activeFieldKey) {
        acc[field.key] = selectedColumn.value;
        return acc;
      }
      acc[field.key] = previousValue === selectedColumn.value ? '' : previousValue;
      return acc;
    }, {});

    setColumnMap(nextMap);
    const nextField = requiredFields.find((field) => !nextMap[field.key])?.key ?? activeFieldKey;
    setActiveFieldKey(nextField);
  }

  function clearFieldSelection(fieldKey: string) {
    setColumnMap((prev) => ({ ...prev, [fieldKey]: '' }));
    setActiveFieldKey(fieldKey);
  }

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
            <p className="text-xs text-slate-400">
              Escolha um campo abaixo e depois clique em qualquer célula da coluna correspondente na pré-visualização.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {requiredFields.map((field) => {
                const styles = fieldStyles[field.key];
                const isActive = activeFieldKey === field.key;
                const selectedValue = columnMap[field.key];

                return (
                  <div
                    key={field.key}
                    className={`rounded-xl border px-3 py-3 transition-all ${
                      isActive ? `${styles.button} ${styles.buttonActive}` : styles.button
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveFieldKey(field.key)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${styles.dot}`} />
                        <span className="text-sm font-semibold">{field.label}</span>
                      </div>
                      <p className="text-xs mt-2 opacity-90">
                        {selectedValue ? `Coluna selecionada: ${selectedValue}` : 'Clique para escolher a coluna'}
                      </p>
                    </button>
                    {selectedValue && (
                      <button
                        type="button"
                        onClick={() => clearFieldSelection(field.key)}
                        className="mt-3 text-xs text-slate-200/80 hover:text-slate-100 underline underline-offset-2"
                      >
                        Limpar seleção
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="overflow-x-auto border border-emerald-900/40 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-emerald-900/30 text-slate-300">
                  <tr>
                    {Array.from({ length: previewColumnCount }).map((_, colIndex) => {
                      const option = columnOptions[colIndex];
                      const fieldKey = option ? fieldByColumn[option.value] : undefined;
                      const styles = fieldKey ? fieldStyles[fieldKey] : undefined;

                      return (
                        <th
                          key={colIndex}
                          onClick={() => handleColumnSelection(colIndex)}
                          className={`px-2 py-2 text-left min-w-[140px] border-l border-emerald-900/20 first:border-l-0 cursor-pointer transition-colors ${
                            styles ? styles.column : activeFieldKey ? 'hover:bg-emerald-900/30' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span>Coluna {colIndex + 1}</span>
                            {fieldKey && <span className={`h-2 w-2 rounded-full ${styles?.dot}`} />}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-400 font-normal truncate">
                            {option?.value || `Coluna ${colIndex + 1}`}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-t border-emerald-900/20">
                      {Array.from({ length: previewColumnCount }).map((__, colIndex) => {
                        const option = columnOptions[colIndex];
                        const fieldKey = option ? fieldByColumn[option.value] : undefined;
                        const styles = fieldKey ? fieldStyles[fieldKey] : undefined;

                        return (
                          <td
                            key={colIndex}
                            onClick={() => handleColumnSelection(colIndex)}
                            className={`px-2 py-2 text-slate-200 max-w-[200px] truncate cursor-pointer transition-colors border-l border-emerald-900/20 first:border-l-0 ${
                              styles ? styles.column : activeFieldKey ? 'hover:bg-emerald-900/20' : ''
                            }`}
                          >
                            {cellToText(row[colIndex]) || '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
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
