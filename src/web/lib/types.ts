import type * as db from '../../worker/db/schema';
export type Product = typeof db.products.$inferSelect;
export type Variant = typeof db.variants.$inferSelect;
export type ProductDetail = import('../../worker/repositories/products').ProductDetail;
export type Settings = {
  config: typeof db.settings.$inferSelect;
  policies: (typeof db.faqs.$inferSelect)[];
  delivery: (typeof db.deliveryZones.$inferSelect)[];
  team: { userId: string; name: string; role: string }[];
};
export type Session = {
  user: { id: string; name: string; email: string | null };
  workspaces: { id: string; name: string; currency: string; role: string }[];
  workspaceId: string | null;
  mode: string;
};
export type Conversation = typeof db.conversations.$inferSelect & {
  customerName: string | null;
  customerPicture: string | null;
  platformCustomerId: string;
  pageName: string;
  preview: string | null;
};
export type Message = typeof db.messages.$inferSelect;
export type Order = typeof db.orders.$inferSelect;
