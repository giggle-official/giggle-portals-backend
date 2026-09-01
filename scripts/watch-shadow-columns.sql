-- 影子列持续观察。只读，按主键过滤，可以反复跑。
--
-- 用法：
--   1) 先跑「基线」那一段，记下 4 个 max id
--   2) 把它们填进下面的 SET，之后想刷多少次刷多少次
--
-- 为什么按 id 不按 created_at：这几张表的 created_at 上没有索引，按时间过滤
-- 会在 55 万行的 credit_statements 和 46 万行的 orders 上全表扫。id 是自增主键，
-- 区间扫的代价和表多大无关。

-- ============ 基线（跑一次，记下数字）============
SELECT 'credit_statements' AS t, COALESCE(MAX(id),0) AS max_id FROM credit_statements
UNION ALL SELECT 'orders',                            COALESCE(MAX(id),0) FROM orders
UNION ALL SELECT 'free_credit_issues',                COALESCE(MAX(id),0) FROM free_credit_issues
UNION ALL SELECT 'widget_subscription_credit_issues', COALESCE(MAX(id),0) FROM widget_subscription_credit_issues;


-- ============ 观察（把上面的数字填进来，反复跑）============
SET @cs   = 0;   -- credit_statements
SET @ord  = 0;   -- orders
SET @fci  = 0;   -- free_credit_issues
SET @wsci = 0;   -- widget_subscription_credit_issues

-- breaches 必须全 0。
-- new_rows = 0 的行是警告：那条写入路径这段时间没被触发，绿色不代表它对。
-- nonzero  = 0 而 new_rows > 0：影子列可能没在写（也可能这些行金额本来就是 0）。
SELECT 'credit_statements.amount' AS pair,
       COUNT(*) AS new_rows,
       SUM(COALESCE(amount,0) <> FLOOR(amount_precise)) AS breaches,
       SUM(amount_precise <> 0) AS nonzero
  FROM credit_statements WHERE id > @cs
UNION ALL SELECT 'credit_statements.balance', COUNT(*),
       SUM(COALESCE(balance,0) <> FLOOR(balance_precise)), SUM(balance_precise <> 0)
  FROM credit_statements WHERE id > @cs

UNION ALL SELECT 'orders.amount', COUNT(*),
       SUM(COALESCE(amount,0) <> FLOOR(amount_precise)), SUM(amount_precise <> 0)
  FROM orders WHERE id > @ord
UNION ALL SELECT 'orders.credit_paid_amount', COUNT(*),
       SUM(COALESCE(credit_paid_amount,0) <> FLOOR(credit_paid_amount_precise)), SUM(credit_paid_amount_precise <> 0)
  FROM orders WHERE id > @ord
UNION ALL SELECT 'orders.free_credit_paid', COUNT(*),
       SUM(COALESCE(free_credit_paid,0) <> FLOOR(free_credit_paid_precise)), SUM(free_credit_paid_precise <> 0)
  FROM orders WHERE id > @ord
UNION ALL SELECT 'orders.refunded_amount', COUNT(*),
       SUM(COALESCE(refunded_amount,0) <> FLOOR(refunded_amount_precise)), SUM(refunded_amount_precise <> 0)
  FROM orders WHERE id > @ord

UNION ALL SELECT 'free_credit_issues.amount', COUNT(*),
       SUM(COALESCE(amount,0) <> FLOOR(amount_precise)), SUM(amount_precise <> 0)
  FROM free_credit_issues WHERE id > @fci
UNION ALL SELECT 'free_credit_issues.balance', COUNT(*),
       SUM(COALESCE(balance,0) <> FLOOR(balance_precise)), SUM(balance_precise <> 0)
  FROM free_credit_issues WHERE id > @fci

UNION ALL SELECT 'wsci.issue_credits', COUNT(*),
       SUM(COALESCE(issue_credits,0) <> FLOOR(issue_credits_precise)), SUM(issue_credits_precise <> 0)
  FROM widget_subscription_credit_issues WHERE id > @wsci
UNION ALL SELECT 'wsci.current_balance', COUNT(*),
       SUM(COALESCE(current_balance,0) <> FLOOR(current_balance_precise)), SUM(current_balance_precise <> 0)
  FROM widget_subscription_credit_issues WHERE id > @wsci

-- users 没有可用的时间/自增游标（created_at 是注册时间，不是余额变动时间），
-- 但只有几千行，全表扫代价可以忽略。任何一次余额写入漏了影子列都会在这里出现。
UNION ALL SELECT 'users.current_credit_balance', COUNT(*),
       SUM(COALESCE(current_credit_balance,0) <> FLOOR(current_credit_balance_precise)),
       SUM(current_credit_balance_precise <> 0)
  FROM users;


-- ============ 一行摘要（最省事的那个，盯这个数就行）============
SELECT SUM(b) AS breaches_total_must_be_zero FROM (
  SELECT SUM(COALESCE(amount,0)  <> FLOOR(amount_precise))
       + SUM(COALESCE(balance,0) <> FLOOR(balance_precise)) AS b FROM credit_statements WHERE id > @cs
  UNION ALL
  SELECT SUM(COALESCE(amount,0)             <> FLOOR(amount_precise))
       + SUM(COALESCE(credit_paid_amount,0) <> FLOOR(credit_paid_amount_precise))
       + SUM(COALESCE(free_credit_paid,0)   <> FLOOR(free_credit_paid_precise))
       + SUM(COALESCE(refunded_amount,0)    <> FLOOR(refunded_amount_precise)) FROM orders WHERE id > @ord
  UNION ALL
  SELECT SUM(COALESCE(amount,0)  <> FLOOR(amount_precise))
       + SUM(COALESCE(balance,0) <> FLOOR(balance_precise)) FROM free_credit_issues WHERE id > @fci
  UNION ALL
  SELECT SUM(COALESCE(issue_credits,0)   <> FLOOR(issue_credits_precise))
       + SUM(COALESCE(current_balance,0) <> FLOOR(current_balance_precise))
    FROM widget_subscription_credit_issues WHERE id > @wsci
  UNION ALL
  SELECT SUM(COALESCE(current_credit_balance,0) <> FLOOR(current_credit_balance_precise)) FROM users
) x;


-- ============ 有破坏时看具体是哪几行 ============
SELECT 'credit_statements' AS t, id, created_at, amount, amount_precise, balance, balance_precise
  FROM credit_statements
 WHERE id > @cs AND (COALESCE(amount,0)  <> FLOOR(amount_precise)
                  OR COALESCE(balance,0) <> FLOOR(balance_precise))
 ORDER BY id DESC LIMIT 10;

SELECT 'orders' AS t, id, created_at, amount, amount_precise,
       credit_paid_amount, credit_paid_amount_precise,
       free_credit_paid, free_credit_paid_precise, refunded_amount, refunded_amount_precise
  FROM orders
 WHERE id > @ord AND (COALESCE(amount,0)             <> FLOOR(amount_precise)
                   OR COALESCE(credit_paid_amount,0) <> FLOOR(credit_paid_amount_precise)
                   OR COALESCE(free_credit_paid,0)   <> FLOOR(free_credit_paid_precise)
                   OR COALESCE(refunded_amount,0)    <> FLOOR(refunded_amount_precise))
 ORDER BY id DESC LIMIT 10;


-- ============ 授信（PR #31，已改成 DECIMAL，没有影子列）============
SELECT 'credit-line: 出现了小数（#29 之前应为 0）' AS check_name,
       (SELECT COUNT(*) FROM user_credit_lines
         WHERE credit_limit <> FLOOR(credit_limit) OR used <> FLOOR(used))
     + (SELECT COUNT(*) FROM credit_line_statements
         WHERE amount <> FLOOR(amount) OR used_after <> FLOOR(used_after)) AS n
UNION ALL
SELECT 'credit-line: used 与最后一条流水不一致（应为 0）', COUNT(*)
  FROM user_credit_lines l
  LEFT JOIN (SELECT user, widget_tag, used_after,
                    ROW_NUMBER() OVER (PARTITION BY user, widget_tag ORDER BY id DESC) rn
               FROM credit_line_statements) s
    ON s.user = l.user AND s.widget_tag = l.widget_tag AND s.rn = 1
 WHERE l.used <> COALESCE(s.used_after, 0);
