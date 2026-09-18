export type TokenParts = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type TokenStats = {
  input: number;
  output: number;
  cache: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  hitRate: number | null;
};

export function toTokenStats(parts: TokenParts): TokenStats {
  const input = Math.max(0, parts.inputTokens || 0);
  const output = Math.max(0, parts.outputTokens || 0);
  const cacheRead = Math.max(0, parts.cacheReadTokens || 0);
  const cacheWrite = Math.max(0, parts.cacheWriteTokens || 0);
  const prompt = input + cacheRead + cacheWrite;
  return {
    input,
    output,
    cache: cacheRead + cacheWrite,
    cacheRead,
    cacheWrite,
    total: prompt + output,
    hitRate: prompt > 0 ? (cacheRead / prompt) * 100 : null,
  };
}

export function addTokenStats(rows: TokenParts[]): TokenStats {
  return toTokenStats(
    rows.reduce(
      (acc, row) => ({
        inputTokens: acc.inputTokens + (row.inputTokens || 0),
        outputTokens: acc.outputTokens + (row.outputTokens || 0),
        cacheReadTokens: acc.cacheReadTokens + (row.cacheReadTokens || 0),
        cacheWriteTokens: acc.cacheWriteTokens + (row.cacheWriteTokens || 0),
      }),
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ),
  );
}
