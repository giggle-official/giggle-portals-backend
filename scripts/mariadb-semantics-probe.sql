-- Does this server behave the way decimal credit needs it to?
--
-- The projection design keeps each old integer money column as the FLOOR of a
-- new DECIMAL(18,6) one, maintained in a single statement:
--
--     SET whole   = FLOOR(precise + ?),
--         precise = precise + ?
--
-- Written that way on purpose. The projection comes first and repeats the
-- arithmetic, so both assignments read `precise` before anything has written
-- it — true under the SQL standard, where every right-hand side sees the
-- pre-statement row, and equally true under MySQL's and MariaDB's left-to-right
-- evaluation. The statement does not depend on which.
--
-- That matters because development runs MySQL 9.0.1 and production runs
-- MariaDB. "Same lineage, same behaviour" is an assumption, and this is money.
--
-- What still has to be checked on the real server is everything below: that
-- FLOOR, DECIMAL arithmetic and sub-scale rounding behave as the design
-- assumes, and that the production statement produces the right answer here.
--
-- SAFE TO RUN ON PRODUCTION. Everything below lives in TEMPORARY tables: they
-- are visible only to this connection, touch no real row, and disappear when
-- the session ends. There is no ALTER, no INSERT into any real table.
--
-- Run the whole file, then paste back the final result set.
--
--     mysql -h <host> -u <user> -p <db> < scripts/mariadb-semantics-probe.sql
--
-- Every row must read PASS. A FAIL on either "production statement" row means
-- the projection does not work on this server and nothing else in the decimal
-- work can ship until that is understood.

SELECT VERSION() AS server_version;

CREATE TEMPORARY TABLE zz_probe (
    id      INT PRIMARY KEY,
    whole   INT NULL,
    precise DECIMAL(18,6) NOT NULL DEFAULT 0
);

CREATE TEMPORARY TABLE zz_result (
    n        INT AUTO_INCREMENT PRIMARY KEY,
    check_name VARCHAR(64),
    expected VARCHAR(32),
    actual   VARCHAR(32)
);

-- 1. THE ONE THAT MATTERS: the exact statement shape `adjustProjected` emits.
--    Starting at 10, spend 3.5. Both columns must land on 6.5 and 6.
--
--    The projection comes first and repeats the arithmetic instead of reading
--    the already-updated column, which makes it correct under either evaluation
--    order — see the header. These two rows are the actual acceptance criteria.
DELETE FROM zz_probe;
INSERT INTO zz_probe (id, whole, precise) VALUES (1, 10, 10);
UPDATE zz_probe
   SET whole   = FLOOR(precise + CAST(-3.5 AS DECIMAL(18,6))),
       precise = precise + CAST(-3.5 AS DECIMAL(18,6))
 WHERE id = 1;
INSERT INTO zz_result (check_name, expected, actual)
    SELECT 'production statement: whole', '6', CAST(whole AS CHAR) FROM zz_probe WHERE id = 1;
INSERT INTO zz_result (check_name, expected, actual)
    SELECT 'production statement: precise', '6.500000', CAST(precise AS CHAR) FROM zz_probe WHERE id = 1;

-- 2. Informational, not a gate: which way does this server evaluate SET?
--
--    Updating `precise` first and projecting with a bare `FLOOR(precise)` gives
--    6 on an engine that evaluates left to right (MySQL, MariaDB) and 10 on one
--    that follows the standard. The code no longer depends on the answer, but
--    it is worth knowing which engine we are on, and a surprise here would mean
--    something about this server is worth a closer look.
--
--    Recorded as PASS either way — read the `actual` column, not the verdict.
DELETE FROM zz_probe;
INSERT INTO zz_probe (id, whole, precise) VALUES (1, 10, 10);
UPDATE zz_probe SET precise = precise - 3.5, whole = FLOOR(precise) WHERE id = 1;
INSERT INTO zz_result (check_name, expected, actual)
    SELECT 'SET order (6=left-to-right, 10=standard)',
           CAST(whole AS CHAR), CAST(whole AS CHAR)
      FROM zz_probe WHERE id = 1;

-- 3. FLOOR rounds toward negative infinity, not toward zero. A user half a
--    credit in the red must project to -1, which is the conservative direction
--    for every balance check still reading the integer column.
DELETE FROM zz_probe;
INSERT INTO zz_probe (id, whole, precise) VALUES (1, 0, 0);
UPDATE zz_probe SET precise = precise - 0.5, whole = FLOOR(precise) WHERE id = 1;
INSERT INTO zz_result (check_name, expected, actual)
    SELECT 'FLOOR(-0.5) is -1', '-1', CAST(whole AS CHAR) FROM zz_probe WHERE id = 1;

-- 4. DECIMAL arithmetic is exact. 0.1 + 0.2 is 0.30000000000000004 in IEEE 754,
--    which is why these columns are DECIMAL and not DOUBLE.
DELETE FROM zz_probe;
INSERT INTO zz_probe (id, whole, precise) VALUES (1, 0, 0.1);
UPDATE zz_probe SET precise = precise + 0.2 WHERE id = 1;
INSERT INTO zz_result (check_name, expected, actual)
    SELECT 'DECIMAL 0.1 + 0.2 is exact', '0.300000', CAST(precise AS CHAR) FROM zz_probe WHERE id = 1;

-- 5. The column holds its full documented range: twelve integer digits, about a
--    trillion credits.
DELETE FROM zz_probe;
INSERT INTO zz_probe (id, whole, precise) VALUES (1, 0, 999999999999.999999);
INSERT INTO zz_result (check_name, expected, actual)
    SELECT 'DECIMAL(18,6) range', '999999999999.999999', CAST(precise AS CHAR) FROM zz_probe WHERE id = 1;

-- 6. Values finer than the scale round rather than truncate. Immaterial to any
--    real amount, but it decides whether the column is a silent truncator.
DELETE FROM zz_probe;
INSERT INTO zz_probe (id, whole, precise) VALUES (1, 0, 0);
UPDATE zz_probe SET precise = precise + 0.0000005 WHERE id = 1;
INSERT INTO zz_result (check_name, expected, actual)
    SELECT 'sub-scale value rounds up', '0.000001', CAST(precise AS CHAR) FROM zz_probe WHERE id = 1;

DELETE FROM zz_probe;
INSERT INTO zz_probe (id, whole, precise) VALUES (1, 0, 0);
UPDATE zz_probe SET precise = precise + 0.0000004 WHERE id = 1;
INSERT INTO zz_result (check_name, expected, actual)
    SELECT 'sub-scale value rounds down', '0.000000', CAST(precise AS CHAR) FROM zz_probe WHERE id = 1;

SELECT check_name,
       expected,
       actual,
       IF(expected = actual, 'PASS', 'FAIL') AS result
  FROM zz_result
 ORDER BY n;

DROP TEMPORARY TABLE zz_result;
DROP TEMPORARY TABLE zz_probe;
