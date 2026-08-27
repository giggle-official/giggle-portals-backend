-- Does this server's arithmetic behave the way decimal credit needs it to?
--
-- READ ONLY, AND NEEDS NO PRIVILEGES BEYOND SELECT. There is no table here at
-- all — not even a temporary one. Every check is an expression, so this runs on
-- a locked-down production account.
--
--     mysql -h <host> -u <user> -p <db> < scripts/mariadb-semantics-probe.sql
--
-- Every row must read PASS. Paste the whole output back.
--
--
-- What this does NOT check, and why that is fine
--
-- The projection keeps each old integer money column as the FLOOR of a new
-- DECIMAL(18,6) one, maintained in a single statement:
--
--     SET whole   = FLOOR(precise + ?),
--         precise = precise + ?
--
-- Whether a server evaluates those two assignments in an order that makes this
-- correct cannot be established without an UPDATE, and an UPDATE needs a table
-- we are not allowed to create. So it is not checked here.
--
-- It does not need to be. The statement is written so the projection comes
-- first and repeats the arithmetic, which is correct under the SQL standard —
-- where every right-hand side sees the pre-statement row — and equally correct
-- under MySQL's and MariaDB's left-to-right evaluation. And `adjustProjected`
-- re-reads the row it just wrote and throws unless the integer column really is
-- the floor of the precise one, on every single write. A server that does
-- something neither standard nor documented produces a rejected request and a
-- rolled-back transaction, not a wrong balance.
--
-- What is checked below is everything that arithmetic alone decides, which is
-- the rest of the design.

SELECT VERSION() AS server_version;

SELECT check_name, expected, actual, IF(expected = actual, 'PASS', 'FAIL') AS result
FROM (
    -- 1. FLOOR rounds toward negative infinity, not toward zero.
    --    75 production users already carry a negative balance. Once fractional
    --    charges land, the integer column of a user at -5.5 must read -6, not
    --    -5: overstating a debt is safe, understating one is not.
    SELECT 'FLOOR(-0.5) is -1' AS check_name,
           '-1' AS expected,
           CAST(FLOOR(CAST(-0.5 AS DECIMAL(18,6))) AS CHAR) AS actual
    UNION ALL
    SELECT 'FLOOR(-5.5) is -6',
           '-6',
           CAST(FLOOR(CAST(-5.5 AS DECIMAL(18,6))) AS CHAR)
    UNION ALL
    -- The smallest possible debt still projects to a whole one.
    SELECT 'FLOOR(-0.000001) is -1',
           '-1',
           CAST(FLOOR(CAST(-0.000001 AS DECIMAL(18,6))) AS CHAR)
    UNION ALL
    SELECT 'FLOOR(6.5) is 6',
           '6',
           CAST(FLOOR(CAST(6.5 AS DECIMAL(18,6))) AS CHAR)
    UNION ALL

    -- 2. The exact expression the write primitive emits, minus the SET around
    --    it. Balance 10, charge 3.5: the integer column must land on 6.
    SELECT 'FLOOR(precise + delta) is 6',
           '6',
           CAST(FLOOR(CAST(10 AS DECIMAL(18,6)) + CAST(-3.5 AS DECIMAL(18,6))) AS CHAR)
    UNION ALL

    -- 3. DECIMAL arithmetic is exact where floating point is not. 0.1 + 0.2 is
    --    0.30000000000000004 in IEEE 754, which is why the columns are DECIMAL.
    SELECT 'DECIMAL 0.1 + 0.2 is exact',
           '0.300000',
           CAST(CAST(0.1 AS DECIMAL(18,6)) + CAST(0.2 AS DECIMAL(18,6)) AS CHAR)
    UNION ALL
    -- A hundred charges of 0.07, the value used in the primitive's own test,
    -- because 0.07 has no exact double.
    SELECT '100 x 0.07 is exactly 7',
           '7.000000',
           CAST(CAST(0.07 AS DECIMAL(18,6)) * 100 AS CHAR)
    UNION ALL

    -- 4. The column holds its documented range: twelve integer digits, about a
    --    trillion credits.
    SELECT 'DECIMAL(18,6) range',
           '999999999999.999999',
           CAST(CAST(999999999999.999999 AS DECIMAL(18,6)) AS CHAR)
    UNION ALL

    -- 5. Values finer than the scale round rather than truncate. Immaterial to
    --    any real amount, but it decides whether the column silently truncates.
    SELECT 'sub-scale rounds up',
           '0.000001',
           CAST(CAST(0.0000005 AS DECIMAL(18,6)) AS CHAR)
    UNION ALL
    SELECT 'sub-scale rounds down',
           '0.000000',
           CAST(CAST(0.0000004 AS DECIMAL(18,6)) AS CHAR)
    UNION ALL

    -- 6. A negative sub-scale value rounds away from zero, so the pair of
    --    checks above is symmetric and a tiny refund cannot round to a credit.
    SELECT 'negative sub-scale rounds away from zero',
           '-0.000001',
           CAST(CAST(-0.0000005 AS DECIMAL(18,6)) AS CHAR)
) AS checks;
