import { TodoItem } from '../shared/types';

function sortableDate(value?: string): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}

/** Display order only: retain input order when the pin and date are equal. */
export function sortOpenTasks(tasks: TodoItem[]): TodoItem[] {
  return tasks.map((task, index) => ({ task, index, due: sortableDate(task.dueDate) }))
    .sort((a, b) => {
      if (!!a.task.pinned !== !!b.task.pinned) return a.task.pinned ? -1 : 1;
      if (a.due !== b.due) {
        if (!a.due) return 1;
        if (!b.due) return -1;
        return a.due < b.due ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map(({ task }) => task);
}

/** Newest short tasks first within the pinned and unpinned groups. */
export function sortShortTasks(tasks: TodoItem[]): TodoItem[] {
  return tasks.map((task, index) => ({ task, index }))
    .sort((a, b) => Number(!!b.task.pinned) - Number(!!a.task.pinned)
      || b.task.createdAt.localeCompare(a.task.createdAt)
      || a.index - b.index)
    .map(({ task }) => task);
}
