import { z } from 'zod';
import type { pages } from '../db/schema';
export const PAGE_PERMISSIONS = [
  'pages_show_list',
  'pages_manage_metadata',
  'pages_messaging',
] as const;
export function hasPagePermissions(permissions: string[]) {
  return PAGE_PERMISSIONS.every((p) => permissions.includes(p));
}
export function hasMessagingTask(tasks: string[]) {
  return tasks.includes('MESSAGING') || tasks.includes('MESSAGE');
}
export function pageReady(page: typeof pages.$inferSelect) {
  try {
    return (
      page.status === 'active' &&
      !!page.encryptedPageAccessToken &&
      !!page.webhookSubscribedAt &&
      hasPagePermissions(z.array(z.string()).parse(JSON.parse(page.permissionsJson))) &&
      hasMessagingTask(z.array(z.string()).parse(JSON.parse(page.tasksJson)))
    );
  } catch {
    return false;
  }
}
