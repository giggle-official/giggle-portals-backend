WITH `t1` AS (
  SELECT
    (sum(`a`.`amount`) / 100) AS `amount`,
    `b`.`ip_id` AS `ip_id`,
    cast(`a`.`paid_time` AS date) AS `date`
  FROM
    (
      `uss_db`.`orders` `a`
      LEFT JOIN `uss_db`.`app_bind_ips` `b` ON((`a`.`app_id` = `b`.`app_id`))
    )
  WHERE
    (
      (
        `a`.`current_status` IN ('rewards_released', 'completed')
      )
      AND (`a`.`app_id` IS NOT NULL)
      AND (`b`.`ip_id` IS NOT NULL)
    )
  GROUP BY
    `b`.`ip_id`,
    `date`
)
SELECT
  md5(concat(`t1`.`ip_id`, `t1`.`date`)) AS `id`,
  `t1`.`amount` AS `amount`,
  `t1`.`ip_id` AS `ip_id`,
  `t1`.`date` AS `date`
FROM
  `t1`