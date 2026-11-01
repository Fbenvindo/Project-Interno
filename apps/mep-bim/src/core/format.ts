// Formatação pt-BR e exportação CSV (compatível com Excel em português).

export function formatNumber(value: number, decimals = 2): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

type Cell = string | number | null | undefined;

/**
 * CSV com separador ";" e vírgula decimal, prefixado com BOM UTF-8
 * para que o Excel reconheça os acentos.
 */
export function toCsv(headers: string[], rows: Cell[][]): string {
  const cell = (v: Cell) => {
    if (v == null) return "";
    const s = typeof v === "number" ? String(Math.round(v * 1000) / 1000).replace(".", ",") : v;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers, ...rows].map((r) => r.map(cell).join(";"));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
