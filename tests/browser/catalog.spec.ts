import { test, expect } from '@playwright/test';
import { encode } from 'fast-png';
test('seller manages a product, variant, image and FAQ through the dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Explore local workspace' }).click();
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption('demo-store');
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  const name = `Browser catalog ${Date.now()}`;
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Product name', { exact: true }).fill(name);
  await dialog.getByLabel('SKU', { exact: true }).fill(`SKU-${Date.now()}`);
  await dialog.getByLabel('Base price (BDT)').fill('399');
  await dialog.getByRole('combobox', { name: /^Status/ }).selectOption('active');
  await dialog.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Add variant', exact: true }).click();
  const variant = page.getByRole('dialog').last();
  await variant.getByLabel('Title', { exact: true }).fill('Blue / M');
  await variant.getByLabel('Unique SKU').fill(`VAR-${Date.now()}`);
  await variant.getByLabel('Color', { exact: true }).fill('blue');
  await variant.getByLabel('Size', { exact: true }).fill('M');
  await variant.getByLabel('Stock on hand').fill('3');
  await variant.getByRole('button', { name: 'Save variant', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(dialog.getByText('Blue / M', { exact: true })).toBeVisible();
  const png = encode({ width: 2, height: 2, channels: 4, data: new Uint8Array(16).fill(180) });
  await dialog
    .locator('input[type=file]')
    .setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await expect(dialog.locator('.image-grid img')).toHaveCount(1);
  await expect
    .poll(() => dialog.locator('.image-grid img').evaluate((e: HTMLImageElement) => e.naturalWidth))
    .toBeGreaterThan(0);
  await dialog.getByLabel('Question', { exact: true }).fill('Can it be washed?');
  await dialog.getByLabel('Verified answer', { exact: true }).fill('Wash cold.');
  await dialog.getByRole('button', { name: 'Add FAQ', exact: true }).click();
  await expect(dialog.getByText('Wash cold.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Archive product', exact: true }).click();
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: 'Archive product', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Edit ${name}`, exact: true })).toHaveCount(0);
});
