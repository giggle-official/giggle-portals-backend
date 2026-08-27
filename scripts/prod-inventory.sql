-- What the decimal credit work needs to know about a server before touching it.
--
-- READ ONLY. Every statement below is a SELECT against information_schema or a
-- system variable. Nothing is created, altered, inserted or deleted.
--
--     mysql -h <host> -u <user> -p <db> < scripts/prod-inventory.sql
--
-- Paste the whole output back. Each section says what the answer decides.

-- 1. Which engine and version.
--    Decides: whether ALGORITHM=INSTANT is available at all (MariaDB needs
--    10.3+), and which manual applies to everything else.
SELECT VERSION() AS version, @@version_comment AS comment;

-- 2. Clock and timezone.
--    Decides: whether the app server and the database agree on what "now" is.
--    The settlement reports filter `created_at < now` with a `now` computed in
--    Node, so a disagreement here shifts every daily and monthly figure.
SELECT @@global.time_zone AS global_tz, @@session.time_zone AS session_tz, NOW() AS db_now;

-- 3. SQL mode.
--    Decides: whether a value finer than DECIMAL(18,6) is a rounded write or a
--    hard error, and how strictly the DDL will be applied.
SELECT @@sql_mode AS sql_mode;

-- 4. Do the credit line tables exist yet.
--    Decides: whether their DECIMAL columns can be included in CREATE TABLE for
--    free, or whether they need their own ADD COLUMN and backfill later. This
--    window closes the moment they are created without the decimal columns.
SELECT table_name, ENGINE, row_format, table_rows
  FROM information_schema.TABLES
 WHERE table_schema = DATABASE()
   AND table_name IN ('user_credit_lines', 'credit_line_statements');

-- 5. Size and format of the five tables that need new columns.
--    Decides: how long the backfill takes, and whether ADD COLUMN is likely to
--    be instant. `table_rows` is an InnoDB estimate, not a count — it is close
--    enough to tell a hundred thousand from ten million, which is the only
--    distinction that changes the plan.
SELECT table_name,
       ENGINE,
       row_format,
       table_rows                                            AS approx_rows,
       ROUND((data_length + index_length) / 1024 / 1024) AS size_mb
  FROM information_schema.TABLES
 WHERE table_schema = DATABASE()
   AND table_name IN ('users', 'orders', 'credit_statements',
                      'free_credit_issues', 'widget_subscription_credit_issues')
 ORDER BY data_length DESC;

-- 6. The exact definition of every money column, old and new.
--    Decides: the exact DDL. Production may have drifted from the local schema
--    — a column that is NOT NULL here and nullable there changes both the
--    ALTER and the invariant. Also shows whether any *_precise column already
--    exists, so the DDL is not run twice.
SELECT table_name, column_name, column_type, is_nullable, column_default, ordinal_position
  FROM information_schema.COLUMNS
 WHERE table_schema = DATABASE()
   AND table_name IN ('users', 'orders', 'credit_statements',
                      'free_credit_issues', 'widget_subscription_credit_issues')
   AND (column_name LIKE '%\_precise'
        OR column_name IN ('current_credit_balance', 'amount', 'balance',
                           'credit_paid_amount', 'free_credit_paid', 'refunded_amount',
                           'issue_credits', 'current_balance'))
 ORDER BY table_name, ordinal_position;

-- 7. Is the integer column ever already negative or null in practice.
--    Decides: whether FLOOR's direction on negative values matters for existing
--    rows, and whether the invariant has to tolerate nulls from day one.
SELECT 'users.current_credit_balance' AS col,
       SUM(current_credit_balance IS NULL) AS nulls,
       SUM(current_credit_balance < 0)     AS negatives,
       COUNT(*)                            AS rows_total
  FROM users;
