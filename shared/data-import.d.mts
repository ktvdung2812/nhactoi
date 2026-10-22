export const IMPORT_DEFAULT_LIMITS: { maxBytes: number; maxRows: number; maxLists: number; maxColumns: number };
export function parseCsv(source: string, options?: { delimiter?: string; maxRows?: number; maxColumns?: number }): { headers: string[]; rows: {line: number; cells: string[]}[] };
export function importDate(value: string | null | undefined, format?: string): string | null;
export function csvCell(value: unknown): string;
export function encodeCsv(rows: unknown[][]): string;
