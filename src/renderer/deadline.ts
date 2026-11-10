/** Calendar-day comparison in the user's local time zone, independent of DST. */
export function deadlineLabel(value?: string, now = new Date()): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const [year, month, day] = value.split('-').map(Number);
  const due = Date.UTC(year, month - 1, day);
  const check = new Date(due);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return '';
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((due - today) / 86400000);
  if (diff < 0) return `已逾期 ${-diff} 天`;
  if (diff === 0) return '今天截止';
  if (diff === 1) return '明天截止';
  return `还剩 ${diff} 天`;
}
