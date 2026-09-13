import { env } from 'cloudflare:workers';
import { database } from '../../src/worker/db/client';
import {
  workspaces,
  pages,
  products,
  variants,
  settings,
  deliveryZones,
} from '../../src/worker/db/schema';
import { encrypt } from '../../src/worker/services/encryption';
export async function createStore() {
  const w = crypto.randomUUID(),
    page = crypto.randomUUID(),
    product = crypto.randomUUID(),
    variant = crypto.randomUUID();
  const db = database(env);
  await db.insert(workspaces).values({ id: w, name: 'Fixture store', slug: w });
  await db.insert(settings).values({ workspaceId: w, autoReply: true, updatedAt: Date.now() });
  await db.insert(pages).values({
    id: page,
    workspaceId: w,
    facebookPageId: page,
    pageName: 'Fixture Page',
    encryptedPageAccessToken: await encrypt(env, 'mock-token', `${w}:${page}`),
    tokenKeyVersion: env.TOKEN_KEY_VERSION,
    status: 'active',
    aiEnabled: true,
    webhookSubscribedAt: Date.now(),
    permissionsJson: JSON.stringify([
      'pages_show_list',
      'pages_manage_metadata',
      'pages_messaging',
    ]),
    tasksJson: JSON.stringify(['MESSAGING']),
    connectionId: crypto.randomUUID(),
  });
  await db.insert(products).values({
    id: product,
    workspaceId: w,
    name: 'Black hoodie',
    normalizedName: 'black hoodie',
    slug: product,
    basePrice: 149000,
    currency: 'BDT',
    status: 'active',
  });
  await db.insert(variants).values({
    id: variant,
    workspaceId: w,
    productId: product,
    sku: `HOODIE-${product}`,
    title: 'Black / XL',
    color: 'black',
    size: 'XL',
    stockOnHand: 5,
  });
  await db.insert(deliveryZones).values({
    id: crypto.randomUUID(),
    workspaceId: w,
    name: 'Dhakar vitore',
    fee: 8000,
    currency: 'BDT',
  });
  return { w, page, product, variant };
}
