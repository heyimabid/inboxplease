import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
  primaryKey,
  foreignKey,
  check,
} from 'drizzle-orm/sqlite-core';
const id = () => text('id').primaryKey();
const time = () => ({
  createdAt: integer('created_at').notNull().$defaultFn(Date.now),
  updatedAt: integer('updated_at').notNull().$defaultFn(Date.now),
});
const workspaceId = () =>
  text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' });
export const users = sqliteTable('users', {
  id: id(),
  facebookUserId: text('facebook_user_id').notNull().unique(),
  name: text('name').notNull(),
  email: text('email'),
  avatarUrl: text('avatar_url'),
  ...time(),
});
export const workspaces = sqliteTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  timezone: text('timezone').notNull().default('Asia/Dhaka'),
  defaultLanguage: text('default_language').notNull().default('auto'),
  currency: text('currency').notNull().default('BDT'),
  ...time(),
});
export const members = sqliteTable(
  'workspace_members',
  {
    workspaceId: workspaceId(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'agent'] }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    check('valid_member_role', sql`${t.role} IN ('owner','admin','agent')`),
  ],
);
export const sessions = sqliteTable('sessions', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
});
export const onboardingSessions = sqliteTable('meta_onboarding_sessions', {
  id: id(),
  workspaceId: workspaceId(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
  consumedAt: integer('consumed_at'),
  messengerUserId: text('messenger_user_id'),
});
export const pageCandidates = sqliteTable('meta_page_candidates', {
  id: id(),
  onboardingId: text('onboarding_id')
    .notNull()
    .references(() => onboardingSessions.id, { onDelete: 'cascade' }),
  facebookPageId: text('facebook_page_id').notNull(),
  pageName: text('page_name').notNull(),
  encryptedToken: text('encrypted_token').notNull(),
  tokenKeyVersion: text('token_key_version').notNull(),
  permissionsJson: text('permissions_json').notNull(),
  tasksJson: text('tasks_json').notNull(),
});
export const pages = sqliteTable(
  'facebook_pages',
  {
    id: id(),
    workspaceId: workspaceId(),
    facebookPageId: text('facebook_page_id').notNull().unique(),
    pageName: text('page_name').notNull(),
    pagePictureUrl: text('page_picture_url'),
    encryptedPageAccessToken: text('encrypted_page_access_token'),
    tokenKeyVersion: text('token_key_version').notNull(),
    status: text('status', { enum: ['active', 'disconnected', 'error'] }).notNull(),
    webhookSubscribedAt: integer('webhook_subscribed_at'),
    aiEnabled: integer('ai_enabled', { mode: 'boolean' }).notNull().default(false),
    permissionsJson: text('permissions_json').notNull().default('[]'),
    tasksJson: text('tasks_json').notNull().default('[]'),
    messengerUserId: text('messenger_user_id'),
    connectionId: text('connection_id'),
    connectedByUserId: text('connected_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...time(),
  },
  (t) => [uniqueIndex('pages_tenant_id').on(t.workspaceId, t.id)],
);
export const products = sqliteTable(
  'products',
  {
    id: id(),
    workspaceId: workspaceId(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    slug: text('slug').notNull(),
    sku: text('sku'),
    category: text('category'),
    description: text('description').notNull().default(''),
    aliases: text('aliases').notNull().default(''),
    basePrice: integer('base_price').notNull(),
    compareAtPrice: integer('compare_at_price'),
    currency: text('currency').notNull(),
    status: text('status', { enum: ['draft', 'active', 'archived'] }).notNull(),
    isAiSearchable: integer('is_ai_searchable', { mode: 'boolean' }).notNull().default(true),
    revision: integer('revision').notNull().default(1),
    indexStatus: text('index_status', { enum: ['pending', 'indexed', 'failed'] })
      .notNull()
      .default('pending'),
    vectorId: text('vector_id'),
    ...time(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    uniqueIndex('products_tenant_id').on(t.workspaceId, t.id),
    uniqueIndex('products_slug').on(t.workspaceId, t.slug),
    index('products_lookup').on(t.workspaceId, t.normalizedName),
    check('valid_price', sql`${t.basePrice} >= 0`),
  ],
);
export const variants = sqliteTable(
  'product_variants',
  {
    id: id(),
    workspaceId: workspaceId(),
    productId: text('product_id').notNull(),
    sku: text('sku').notNull(),
    title: text('title').notNull(),
    color: text('color'),
    size: text('size'),
    attributesJson: text('attributes_json').notNull().default('{}'),
    priceOverride: integer('price_override'),
    stockOnHand: integer('stock_on_hand').notNull().default(0),
    reservedStock: integer('reserved_stock').notNull().default(0),
    status: text('status', { enum: ['active', 'inactive'] })
      .notNull()
      .default('active'),
    ...time(),
  },
  (t) => [
    uniqueIndex('variants_sku').on(t.workspaceId, t.sku),
    uniqueIndex('variants_tenant_id').on(t.workspaceId, t.id),
    foreignKey({
      columns: [t.workspaceId, t.productId],
      foreignColumns: [products.workspaceId, products.id],
    }).onDelete('cascade'),
    check(
      'valid_inventory',
      sql`${t.stockOnHand} >= 0 AND ${t.reservedStock} >= 0 AND ${t.reservedStock} <= ${t.stockOnHand}`,
    ),
    check('valid_override', sql`${t.priceOverride} IS NULL OR ${t.priceOverride} >= 0`),
  ],
);
export const images = sqliteTable(
  'product_images',
  {
    id: id(),
    workspaceId: workspaceId(),
    productId: text('product_id').notNull(),
    variantId: text('variant_id'),
    r2Key: text('r2_key').notNull().unique(),
    publicUrlOrDeliveryKey: text('public_url_or_delivery_key').notNull(),
    position: integer('position').notNull().default(0),
    altText: text('alt_text'),
    sha256: text('sha256').notNull(),
    perceptualHash: text('perceptual_hash'),
    visionDescription: text('vision_description'),
    visionAttributesJson: text('vision_attributes_json'),
    vectorId: text('vector_id'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.productId],
      foreignColumns: [products.workspaceId, products.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.workspaceId, t.variantId],
      foreignColumns: [variants.workspaceId, variants.id],
    }),
    index('images_hash').on(t.workspaceId, t.sha256),
  ],
);
export const faqs = sqliteTable(
  'product_faqs',
  {
    id: id(),
    workspaceId: workspaceId(),
    productId: text('product_id'),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    language: text('language'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    ...time(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.productId],
      foreignColumns: [products.workspaceId, products.id],
    }).onDelete('cascade'),
  ],
);
export const settings = sqliteTable('workspace_settings', {
  workspaceId: workspaceId().primaryKey(),
  autoReply: integer('auto_reply', { mode: 'boolean' }).notNull().default(false),
  tone: text('tone').notNull().default('friendly'),
  responseStyle: text('response_style').notNull().default('match_customer'),
  handoffRules: text('handoff_rules')
    .notNull()
    .default('Refund disputes, threats, payment exceptions'),
  retentionDays: integer('retention_days').notNull().default(30),
  temporaryImageHours: integer('temporary_image_hours').notNull().default(24),
  normalizationJson: text('normalization_json').notNull().default('{}'),
  updatedAt: integer('updated_at').notNull(),
});
export const deliveryZones = sqliteTable(
  'delivery_zones',
  {
    id: id(),
    workspaceId: workspaceId(),
    name: text('name').notNull(),
    fee: integer('fee').notNull(),
    currency: text('currency').notNull(),
    estimatedDays: text('estimated_days'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    ...time(),
  },
  (t) => [
    uniqueIndex('delivery_names').on(t.workspaceId, t.name),
    check('valid_delivery_fee', sql`${t.fee} >= 0`),
  ],
);
export const customers = sqliteTable(
  'customers',
  {
    id: id(),
    workspaceId: workspaceId(),
    facebookPageId: text('facebook_page_id').notNull(),
    platformCustomerId: text('platform_customer_id').notNull(),
    name: text('name'),
    phone: text('phone'),
    defaultAddress: text('default_address'),
    languagePreference: text('language_preference'),
    languageEvidence: integer('language_evidence').notNull().default(0),
    ...time(),
  },
  (t) => [
    uniqueIndex('customer_platform').on(t.workspaceId, t.facebookPageId, t.platformCustomerId),
    uniqueIndex('customers_tenant_id').on(t.workspaceId, t.id),
    foreignKey({
      columns: [t.workspaceId, t.facebookPageId],
      foreignColumns: [pages.workspaceId, pages.id],
    }),
  ],
);
export const conversations = sqliteTable(
  'conversations',
  {
    id: id(),
    workspaceId: workspaceId(),
    facebookPageId: text('facebook_page_id').notNull(),
    customerId: text('customer_id').notNull(),
    status: text('status', { enum: ['open', 'resolved', 'blocked'] })
      .notNull()
      .default('open'),
    mode: text('mode', { enum: ['ai', 'human'] })
      .notNull()
      .default('ai'),
    orderState: text('order_state').notNull().default('BROWSING'),
    lastMessageAt: integer('last_message_at').notNull(),
    lastCustomerMessageAt: integer('last_customer_message_at').notNull(),
    lastAiMessageAt: integer('last_ai_message_at'),
    unreadCount: integer('unread_count').notNull().default(0),
    ...time(),
  },
  (t) => [
    uniqueIndex('conversation_customer').on(t.workspaceId, t.facebookPageId, t.customerId),
    uniqueIndex('conversations_tenant_id').on(t.workspaceId, t.id),
    index('conversation_inbox').on(t.workspaceId, t.lastMessageAt),
    foreignKey({
      columns: [t.workspaceId, t.customerId],
      foreignColumns: [customers.workspaceId, customers.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.workspaceId, t.facebookPageId],
      foreignColumns: [pages.workspaceId, pages.id],
    }),
  ],
);
export const messages = sqliteTable(
  'messages',
  {
    id: id(),
    workspaceId: workspaceId(),
    conversationId: text('conversation_id').notNull(),
    metaMessageId: text('meta_message_id').unique(),
    direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),
    senderType: text('sender_type', { enum: ['customer', 'ai', 'human', 'system'] }).notNull(),
    messageType: text('message_type').notNull(),
    text: text('text'),
    attachmentJson: text('attachment_json'),
    language: text('language'),
    aiMetadataJson: text('ai_metadata_json'),
    deliveryStatus: text('delivery_status').notNull().default('received'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete('cascade'),
    index('message_history').on(t.workspaceId, t.conversationId, t.createdAt),
  ],
);
export const webhookEvents = sqliteTable(
  'webhook_events',
  {
    id: id(),
    workspaceId: workspaceId(),
    metaEventId: text('meta_event_id').notNull().unique(),
    eventType: text('event_type').notNull(),
    payloadJson: text('payload_json').notNull(),
    status: text('status', { enum: ['received', 'processing', 'processed', 'failed'] })
      .notNull()
      .default('received'),
    attemptCount: integer('attempt_count').notNull().default(0),
    errorMessage: text('error_message'),
    receivedAt: integer('received_at').notNull(),
    processedAt: integer('processed_at'),
    queuedAt: integer('queued_at'),
  },
  (t) => [index('webhook_pending').on(t.status, t.queuedAt)],
);
export const orderDrafts = sqliteTable(
  'order_drafts',
  {
    id: id(),
    workspaceId: workspaceId(),
    conversationId: text('conversation_id').notNull(),
    customerId: text('customer_id').notNull(),
    state: text('state').notNull(),
    customerName: text('customer_name'),
    phone: text('phone'),
    deliveryAddress: text('delivery_address'),
    deliveryArea: text('delivery_area'),
    notes: text('notes'),
    currency: text('currency').notNull(),
    subtotal: integer('subtotal'),
    deliveryFee: integer('delivery_fee'),
    total: integer('total'),
    revision: integer('revision').notNull().default(1),
    reviewHash: text('review_hash'),
    selectionJson: text('selection_json'),
    lastUpdatedAt: integer('last_updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('draft_tenant_id').on(t.workspaceId, t.id),
    uniqueIndex('one_draft').on(t.workspaceId, t.conversationId),
    foreignKey({
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.workspaceId, t.customerId],
      foreignColumns: [customers.workspaceId, customers.id],
    }).onDelete('cascade'),
  ],
);
export const draftItems = sqliteTable(
  'order_draft_items',
  {
    id: id(),
    workspaceId: workspaceId(),
    orderDraftId: text('order_draft_id').notNull(),
    productId: text('product_id').notNull(),
    variantId: text('variant_id').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceSnapshot: integer('unit_price_snapshot').notNull(),
  },
  (t) => [
    uniqueIndex('draft_variant').on(t.workspaceId, t.orderDraftId, t.variantId),
    foreignKey({
      columns: [t.workspaceId, t.orderDraftId],
      foreignColumns: [orderDrafts.workspaceId, orderDrafts.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.workspaceId, t.productId],
      foreignColumns: [products.workspaceId, products.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.variantId],
      foreignColumns: [variants.workspaceId, variants.id],
    }),
    check('positive_draft_quantity', sql`${t.quantity} > 0`),
  ],
);
export const orders = sqliteTable(
  'orders',
  {
    id: id(),
    workspaceId: workspaceId(),
    conversationId: text('conversation_id').notNull(),
    customerId: text('customer_id').notNull(),
    orderNumber: text('order_number').notNull().unique(),
    status: text('status', {
      enum: ['confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
    }).notNull(),
    customerName: text('customer_name').notNull(),
    phone: text('phone').notNull(),
    deliveryAddress: text('delivery_address').notNull(),
    deliveryArea: text('delivery_area').notNull(),
    currency: text('currency').notNull(),
    subtotal: integer('subtotal').notNull(),
    deliveryFee: integer('delivery_fee').notNull(),
    total: integer('total').notNull(),
    notes: text('notes'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    confirmedAt: integer('confirmed_at').notNull(),
    ...time(),
  },
  (t) => [
    uniqueIndex('orders_tenant_id').on(t.workspaceId, t.id),
    foreignKey({
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.workspaceId, t.customerId],
      foreignColumns: [customers.workspaceId, customers.id],
    }).onDelete('cascade'),
    check(
      'valid_order_total',
      sql`${t.total} = ${t.subtotal} + ${t.deliveryFee} AND ${t.subtotal} >= 0 AND ${t.deliveryFee} >= 0`,
    ),
  ],
);
export const orderItems = sqliteTable(
  'order_items',
  {
    id: id(),
    workspaceId: workspaceId(),
    orderId: text('order_id').notNull(),
    productId: text('product_id').notNull(),
    variantId: text('variant_id').notNull(),
    productNameSnapshot: text('product_name_snapshot').notNull(),
    variantNameSnapshot: text('variant_name_snapshot').notNull(),
    skuSnapshot: text('sku_snapshot').notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: integer('unit_price').notNull(),
    lineTotal: integer('line_total').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.orderId],
      foreignColumns: [orders.workspaceId, orders.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.workspaceId, t.productId],
      foreignColumns: [products.workspaceId, products.id],
    }),
    foreignKey({
      columns: [t.workspaceId, t.variantId],
      foreignColumns: [variants.workspaceId, variants.id],
    }),
    check(
      'valid_line',
      sql`${t.quantity} > 0 AND ${t.unitPrice} >= 0 AND ${t.lineTotal} = ${t.quantity} * ${t.unitPrice}`,
    ),
  ],
);
export const handoffs = sqliteTable(
  'handoff_sessions',
  {
    id: id(),
    workspaceId: workspaceId(),
    conversationId: text('conversation_id').notNull(),
    reason: text('reason').notNull(),
    summary: text('summary'),
    status: text('status').notNull(),
    assignedUserId: text('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete('cascade'),
  ],
);
export const catalogJobs = sqliteTable(
  'catalog_jobs',
  {
    id: id(),
    workspaceId: workspaceId(),
    productId: text('product_id').notNull(),
    revision: integer('revision').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    errorCategory: text('error_category'),
    queuedAt: integer('queued_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('catalog_revision').on(t.workspaceId, t.productId, t.revision),
    foreignKey({
      columns: [t.workspaceId, t.productId],
      foreignColumns: [products.workspaceId, products.id],
    }).onDelete('cascade'),
  ],
);
export const localVectors = sqliteTable(
  'local_vectors',
  {
    id: id(),
    workspaceId: workspaceId(),
    productId: text('product_id').notNull(),
    document: text('document').notNull(),
    valuesJson: text('values_json').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.productId],
      foreignColumns: [products.workspaceId, products.id],
    }).onDelete('cascade'),
  ],
);
export const temporaryImages = sqliteTable(
  'temporary_images',
  {
    id: id(),
    workspaceId: workspaceId(),
    customerId: text('customer_id').notNull(),
    r2Key: text('r2_key').notNull().unique(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.customerId],
      foreignColumns: [customers.workspaceId, customers.id],
    }).onDelete('cascade'),
  ],
);
export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: id(),
    workspaceId: workspaceId(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    resourceId: text('resource_id'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('audit_time').on(t.workspaceId, t.createdAt)],
);
export const rateLimits = sqliteTable('rate_limits', {
  id: id(),
  count: integer('count').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
export const deletionReceipts = sqliteTable('deletion_receipts', {
  id: id(),
  status: text('status').notNull(),
  createdAt: integer('created_at').notNull(),
});
