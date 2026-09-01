-- 影子列验证。全部只读。
--
-- 「不变式全绿」在一张没被写过的表上什么也不证明：回填之后历史行本来就一致。
-- 所以每一行同时报「一致性」和「这段时间实际写了多少」——breaches 必须为 0，
-- 而 rows_since 为 0 的那一行说明这条路径根本没被验证过。

SET @since = '2026-08-28 00:00:00';   -- ← 改成影子列实际上线的时间

-- ============ 1. 11 个列对 ============
-- breaches_total / breaches_since 必须全是 0
-- rows_since = 0 的行：这条写入路径这段时间没被触发，绿色不代表它是对的
-- nonzero_since = 0 而 rows_since > 0：影子列可能压根没在写（也可能真的都是 0）

SELECT 'users.current_credit_balance' AS pair,
       COUNT(*)                                                            AS rows_total,
       SUM(COALESCE(current_credit_balance,0) <> FLOOR(current_credit_balance_precise)) AS breaches_total,
       NULL AS rows_since, NULL AS breaches_since,
       SUM(current_credit_balance_precise <> 0)                            AS nonzero_now
  FROM users

UNION ALL SELECT 'credit_statements.amount', COUNT(*),
       SUM(COALESCE(amount,0) <> FLOOR(amount_precise)),
       SUM(created_at >= @since),
       SUM(created_at >= @since AND COALESCE(amount,0) <> FLOOR(amount_precise)),
       SUM(created_at >= @since AND amount_precise <> 0)
  FROM credit_statements
UNION ALL SELECT 'credit_statements.balance', COUNT(*),
       SUM(COALESCE(balance,0) <> FLOOR(balance_precise)),
       SUM(created_at >= @since),
       SUM(created_at >= @since AND COALESCE(balance,0) <> FLOOR(balance_precise)),
       SUM(created_at >= @since AND balance_precise <> 0)
  FROM credit_statements

UNION ALL SELECT 'free_credit_issues.amount', COUNT(*),
       SUM(COALESCE(amount,0) <> FLOOR(amount_precise)),
       SUM(created_at >= @since),
       SUM(created_at >= @since AND COALESCE(amount,0) <> FLOOR(amount_precise)),
       SUM(created_at >= @since AND amount_precise <> 0)
  FROM free_credit_issues
UNION ALL SELECT 'free_credit_issues.balance', COUNT(*),
       SUM(COALESCE(balance,0) <> FLOOR(balance_precise)),
       SUM(created_at >= @since),
       SUM(created_at >= @since AND COALESCE(balance,0) <> FLOOR(balance_precise)),
       SUM(created_at >= @since AND balance_precise <> 0)
  FROM free_credit_issues

UNION ALL SELECT 'orders.amount', COUNT(*),
       SUM(COALESCE(amount,0) <> FLOOR(amount_precise)),
       SUM(created_at >= @since),
       SUM(created_at >= @since AND COALESCE(amount,0) <> FLOOR(amount_precise)),
       SUM(created_at >= @since AND amount_precise <> 0)
  FROM orders
UNION ALL SELECT 'orders.credit_paid_amount', COUNT(*),
       SUM(COALESCE(credit_paid_amount,0) <> FLOOR(credit_paid_amount_precise)),
       SUM(created_at >= @since),
       SUM(created_at >= @since AND COALESCE(credit_paid_amount,0) <> FLOOR(credit_paid_amount_precise)),
       SUM(created_at >= @since AND credit_paid_amount_precise <> 0)
  FROM orders
UNION ALL SELECT 'orders.free_credit_paid', COUNT(*),
       SUM(COALESCE(free_credit_paid,0) <> FLOOR(free_credit_paid_precise)),
       SUM(created_at >= @since),
       SUM(created_at >= @since AND COALESCE(free_credit_paid,0) <> FLOOR(free_credit_paid_precise)),
       SUM(created_at >= @since AND free_credit_paid_precise <> 0)
  FROM orders
UNION ALL SELECT 'orders.refunded_amount', COUNT(*),
       SUM(COALESCE(refunded_amount,0) <> FLOOR(refunded_amount_precise)),
       SUM(created_at >= @since),
       SUM(created_at >= @since AND COALESCE(refunded_amount,0) <> FLOOR(refunded_amount_precise)),
       SUM(created_at >= @since AND refunded_amount_precise <> 0)
  FROM orders

UNION ALL SELECT 'wsci.issue_credits', COUNT(*),
       SUM(COALESCE(issue_credits,0) <> FLOOR(issue_credits_precise)),
       SUM(created_at >= @since),
       SUM(created_at >= @since AND COALESCE(issue_credits,0) <> FLOOR(issue_credits_precise)),
       SUM(created_at >= @since AND issue_credits_precise <> 0)
  FROM widget_subscription_credit_issues
UNION ALL SELECT 'wsci.current_balance', COUNT(*),
       SUM(COALESCE(current_balance,0) <> FLOOR(current_balance_precise)),
       SUM(created_at >= @since),
       SUM(created_at >= @since AND COALESCE(current_balance,0) <> FLOOR(current_balance_precise)),
       SUM(created_at >= @since AND current_balance_precise <> 0)
  FROM widget_subscription_credit_issues;


-- ============ 2. 破坏的样本 ============
-- 上面有任何 breaches 时，用这个看具体是哪些行。全绿时返回空。

SELECT 'credit_statements' AS t, id, created_at, amount, amount_precise, balance, balance_precise
  FROM credit_statements
 WHERE COALESCE(amount,0)  <> FLOOR(amount_precise)
    OR COALESCE(balance,0) <> FLOOR(balance_precise)
 ORDER BY id DESC LIMIT 10;

SELECT 'orders' AS t, id, created_at, amount, amount_precise,
       credit_paid_amount, credit_paid_amount_precise,
       free_credit_paid, free_credit_paid_precise,
       refunded_amount, refunded_amount_precise
  FROM orders
 WHERE COALESCE(amount,0)             <> FLOOR(amount_precise)
    OR COALESCE(credit_paid_amount,0) <> FLOOR(credit_paid_amount_precise)
    OR COALESCE(free_credit_paid,0)   <> FLOOR(free_credit_paid_precise)
    OR COALESCE(refunded_amount,0)    <> FLOOR(refunded_amount_precise)
 ORDER BY id DESC LIMIT 10;


-- ============ 3. 授信两张表（#31 已改成 DECIMAL，没有影子列）============
-- 这里查的是「还不该出现小数」，以及授信自己那条跨行不变式。

SELECT 'credit-line: 出现了小数（应为 0）' AS check_name,
       (SELECT COUNT(*) FROM user_credit_lines
         WHERE credit_limit <> FLOOR(credit_limit) OR used <> FLOOR(used))
     + (SELECT COUNT(*) FROM credit_line_statements
         WHERE amount <> FLOOR(amount) OR used_after <> FLOOR(used_after)) AS n
UNION ALL
SELECT 'credit-line: used 不等于最后一条流水的 used_after（应为 0）', COUNT(*)
  FROM user_credit_lines l
  LEFT JOIN (SELECT user, widget_tag, used_after,
                    ROW_NUMBER() OVER (PARTITION BY user, widget_tag ORDER BY id DESC) rn
               FROM credit_line_statements) s
    ON s.user = l.user AND s.widget_tag = l.widget_tag AND s.rn = 1
 WHERE l.used <> COALESCE(s.used_after, 0);
