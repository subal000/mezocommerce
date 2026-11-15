/** Page window for "1-25 of 80". Pure, unit tested. */
export function pageInfo(page: number, pageSize: number, total: number) {
  const size = Math.max(1, pageSize);
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  return { pages, from, to, hasPrev: page > 1, hasNext: page < pages };
}
