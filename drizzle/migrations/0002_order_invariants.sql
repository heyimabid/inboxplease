-- These invariants execute inside the D1 batch transaction, including concurrent confirmations.
-- Parenthesize CASE expressions so D1's remote SQL splitter preserves each trigger body.
CREATE TRIGGER order_catalog_guard BEFORE INSERT ON order_items
WHEN NOT EXISTS (SELECT 1 FROM order_items WHERE id=NEW.id)
BEGIN
 SELECT (CASE WHEN NOT EXISTS (
  SELECT 1 FROM product_variants v JOIN products p ON p.id=v.product_id AND p.workspace_id=v.workspace_id
  WHERE v.id=NEW.variant_id AND v.workspace_id=NEW.workspace_id AND p.id=NEW.product_id
   AND p.status='active' AND p.deleted_at IS NULL AND p.is_ai_searchable=1 AND v.status='active'
   AND v.stock_on_hand-v.reserved_stock>=NEW.quantity
   AND COALESCE(v.price_override,p.base_price)=NEW.unit_price
   AND p.name=NEW.product_name_snapshot AND v.title=NEW.variant_name_snapshot AND v.sku=NEW.sku_snapshot
 ) THEN RAISE(ABORT,'ORDER_CATALOG_CHANGED') END);
END;
--> statement-breakpoint
CREATE TRIGGER order_stock_decrement AFTER INSERT ON order_items
BEGIN
 UPDATE product_variants SET stock_on_hand=stock_on_hand-NEW.quantity, updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER)
 WHERE workspace_id=NEW.workspace_id AND id=NEW.variant_id;
 UPDATE products SET index_status='pending',revision=revision+1 WHERE workspace_id=NEW.workspace_id AND id=NEW.product_id;
END;
--> statement-breakpoint
CREATE TRIGGER order_delivery_guard BEFORE INSERT ON orders
WHEN NOT EXISTS (SELECT 1 FROM orders WHERE id=NEW.id)
BEGIN
 SELECT (CASE WHEN NOT EXISTS (
 SELECT 1 FROM delivery_zones z JOIN order_drafts d ON d.workspace_id=z.workspace_id
 WHERE z.workspace_id=NEW.workspace_id AND z.name=NEW.delivery_area AND z.currency=NEW.currency AND z.fee=NEW.delivery_fee AND z.is_active=1
 AND d.id=NEW.idempotency_key AND d.state='AWAITING_CONFIRMATION' AND d.customer_id=NEW.customer_id AND d.conversation_id=NEW.conversation_id
 AND d.customer_name=NEW.customer_name AND d.phone=NEW.phone AND d.delivery_address=NEW.delivery_address AND d.total=NEW.total
 AND d.subtotal=(SELECT sum(quantity*unit_price_snapshot) FROM order_draft_items i WHERE i.workspace_id=NEW.workspace_id AND i.order_draft_id=d.id)
 ) THEN RAISE(ABORT,'ORDER_REVIEW_CHANGED') END);
END;
--> statement-breakpoint
CREATE TRIGGER immutable_order_item BEFORE UPDATE ON order_items BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ORDER_SNAPSHOT'); END;
--> statement-breakpoint
CREATE TRIGGER immutable_order_snapshot BEFORE UPDATE OF customer_name,phone,delivery_address,delivery_area,currency,subtotal,delivery_fee,total,idempotency_key ON orders BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ORDER_SNAPSHOT'); END;
--> statement-breakpoint
CREATE TRIGGER restore_cancelled_inventory AFTER UPDATE OF status ON orders
WHEN NEW.status='cancelled' AND OLD.status IN ('confirmed','processing')
BEGIN
 UPDATE product_variants SET stock_on_hand=stock_on_hand+COALESCE((SELECT sum(quantity) FROM order_items WHERE workspace_id=NEW.workspace_id AND order_id=NEW.id AND variant_id=product_variants.id),0)
 WHERE workspace_id=NEW.workspace_id AND id IN (SELECT variant_id FROM order_items WHERE workspace_id=NEW.workspace_id AND order_id=NEW.id);
 UPDATE products SET index_status='pending',revision=revision+1 WHERE workspace_id=NEW.workspace_id AND id IN (SELECT product_id FROM order_items WHERE workspace_id=NEW.workspace_id AND order_id=NEW.id);
END;
