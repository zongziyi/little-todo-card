import dayjs from 'dayjs';
import { randomUUID } from 'node:crypto';
import { TodoItem } from '../shared/types';

const TASK_LINE_REGEX = /^- \[( |x|X)\]\s+(.*)$/;
const TIMESTAMP_SUFFIX_REGEX = /\((\d{4}-\d{2}-\d{2} \d{2}:\d{2})\)\s*$/;
const DUE_SUFFIX_REGEX = /\s*<!-- due:(\d{4}-\d{2}-\d{2}) -->\s*$/;
const PIN_SUFFIX_REGEX = /\s*<!-- pinned -->\s*$/;
const METADATA_PREFIX_REGEX = /\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)(?:\s*<!-- due:\d{4}-\d{2}-\d{2} -->)?\s*$/;

export function parseMarkdownTasks(content: string): TodoItem[] {
  const lines = content.split(/\r?\n/);
  const tasks: TodoItem[] = [];

  for (const line of lines) {
    const match = line.match(TASK_LINE_REGEX);
    if (!match) {
      continue;
    }

    const completed = match[1].toLowerCase() === 'x';
    const rawWithPin = match[2].trim();
    const withoutPin = rawWithPin.replace(PIN_SUFFIX_REGEX, '');
    const pinned = withoutPin !== rawWithPin && METADATA_PREFIX_REGEX.test(withoutPin);
    const rawWithDue = pinned ? withoutPin : rawWithPin;
    const dueMatch = rawWithDue.match(DUE_SUFFIX_REGEX);
    const rawText = dueMatch ? rawWithDue.replace(DUE_SUFFIX_REGEX, '') : rawWithDue;
    const timestampMatch = rawText.match(TIMESTAMP_SUFFIX_REGEX);

    let createdAt = dayjs().format('YYYY-MM-DD HH:mm');
    let text = rawText;

    if (timestampMatch) {
      createdAt = timestampMatch[1];
      text = rawText.replace(TIMESTAMP_SUFFIX_REGEX, '').trim();
    }

    tasks.push({
      id: randomUUID(),
      text,
      completed,
      createdAt,
      ...(pinned ? { pinned: true } : {}),
      ...(dueMatch ? { dueDate: dueMatch[1] } : {})
    });
  }

  return tasks;
}

export function stringifyMarkdownTasks(tasks: TodoItem[]): string {
  return tasks
    .map((task) => {
      const checked = task.completed ? 'x' : ' ';
      return `- [${checked}] ${task.text} (${task.createdAt})${task.dueDate ? ` <!-- due:${task.dueDate} -->` : ''}${task.pinned ? ' <!-- pinned -->' : ''}`;
    })
    .join('\n')
    .trim();
}

export function createTaskFromText(text: string): TodoItem {
  return {
    id: randomUUID(),
    text: text.replace(/\s+/g, ' ').trim(),
    completed: false,
    createdAt: dayjs().format('YYYY-MM-DD HH:mm')
  };
}
