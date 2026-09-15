import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

test('local seller connects a Page, completes a confirmed order and takes over', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Explore local workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Your inbox.' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption('demo-store');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Connect a Page', exact: true }).click();
  await page.getByRole('button', { name: 'Your local shop', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Enable AI for Your local shop', exact: true }).click();
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await expect(page.getByRole('button', { name: /Black Oversized Hoodie Soft/ })).toBeVisible();
  await page.getByRole('link', { name: 'Inbox', exact: true }).click();
  const customer = `browser-${crypto.randomUUID()}`;
  const conversation = createHash('sha256').update(`mock-page-1:${customer}`).digest('hex');
  const send = async (text: string) => {
    await page.getByRole('button', { name: 'Try a conversation', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Local customer ID').fill(customer);
    await dialog.getByRole('textbox', { name: /^Customer message/ }).fill(text);
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/mock/message') && r.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Send local message' }).click();
    expect((await response).ok()).toBeTruthy();
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.goto(`/inbox?conversation=${conversation}`);
  };
  await send('black hoodie XL quantity 1 order korbo');
  await expect(page.locator('.message.outbound').last()).toContainText(
    /kar name|what name|কার নামে/i,
  );
  await send('name Browser Buyer phone 01712345678 address Mirpur 10, Dhaka area Dhakar vitore');
  await expect(page.locator('.message.outbound').last()).toContainText(/Order(?:-er)? summary/);
  await expect(page.locator('.message.outbound').last()).toContainText('1,570');
  await expect(page.locator('.message.outbound').last()).toContainText('Confirm');
  await send('confirm');
  await expect(page.locator('.message.outbound').last()).toContainText('is confirmed');
  await page.getByRole('button', { name: 'Take over', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume AI', exact: true })).toBeVisible();
  await page.getByLabel('Reply to customer').fill('I’ll arrange your delivery.');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(page.locator('.message.outbound').last()).toContainText(
    'I’ll arrange your delivery.',
  );
  await page.screenshot({ path: 'test-results/local-inbox.png', fullPage: true });
  await page.getByRole('link', { name: 'Orders', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Orders.', exact: true })).toBeVisible();
  await expect(
    page.getByRole('table').getByText('Browser Buyer', { exact: true }).first(),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('table')).toBeVisible();
  await page.screenshot({ path: 'test-results/local-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('creates and switches to an empty workspace without showing the previous catalog', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Explore local workspace' }).click();
  await page.getByRole('button', { name: 'New workspace', exact: true }).click();
  const name = `Browser store ${Date.now()}`;
  await page.getByLabel('Store name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await expect(page.getByText('Your catalog starts here', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption('demo-store');
  await expect(page.getByText('Black Oversized Hoodie', { exact: true })).toBeVisible();
});
