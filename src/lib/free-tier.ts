export const FREE_RESULT_LIMIT = 25;
export function freeBatchSize(remaining: number) {
  return Math.min(3, Math.max(0, Math.floor(remaining)));
}
