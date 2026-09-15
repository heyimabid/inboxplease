import { test, expect } from '@playwright/test';

test('public landing works without a session service and remembers the selected language', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/auth/**', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('ইনবক্সের ব্যস্ততা কমুক');
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Less inbox busywork');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(errors).toEqual([]);
});

test('demo, FAQs, plan estimator and plan-to-login path work', async ({ page }) => {
  await page.route('**/auth/session', (route) =>
    route.fulfill({ json: { success: true, data: null } }),
  );
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { success: true, data: { mode: 'production' } } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('button', { name: 'Ask about delivery', exact: true }).click();
  await expect(page.locator('.lp-assistant')).toContainText('outside Dhaka');
  await page.getByRole('button', { name: 'Place an order', exact: true }).click();
  await expect(page.locator('.lp-assistant')).toContainText('What name and delivery address');
  await page.getByText('Do I need to pay with bKash or Nagad now?', { exact: true }).click();
  await expect(
    page.getByText('No payments are collected yet. bKash, Nagad and card checkout', {
      exact: false,
    }),
  ).toBeVisible();
  const slider = page.getByRole('slider');
  await slider.focus();
  await slider.press('End');
  await expect(page.locator('.lp-estimator')).toContainText('larger, tailored plan');
  await slider.press('Home');
  await expect(page.locator('.lp-estimator')).toContainText('Starter');
  await page.getByRole('link', { name: 'Get started — Growth', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?lang=en&plan=growth/);
  await expect(page.getByRole('status')).toContainText('৳2,499');
  await expect(page.getByRole('button', { name: 'Continue with Facebook' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to home' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Less inbox busywork');
});

test('mobile menu and Bengali layout remain usable on small screens', async ({ page }) => {
  await page.goto('/');
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'মেনু', exact: true }).click();
  await expect(page.locator('#landing-nav')).toBeVisible();
  await page.locator('#landing-nav').getByRole('link', { name: 'খরচ', exact: true }).click();
  await expect(page).toHaveURL(/#pricing$/);
  await expect(page.getByRole('button', { name: 'মেনু', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.screenshot({ path: 'test-results/landing-mobile-bn.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.screenshot({ path: 'test-results/landing-desktop-bn.png', fullPage: true });
});
