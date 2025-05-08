WITH `t1` AS (
  SELECT
    `a`.`user` AS `user`,
    `a`.`token` AS `token`,
    sum(`a`.`rewards`) AS `rewards`,
    sum(`a`.`locked_rewards`) AS `locked`,
    sum(`a`.`released_rewards`) AS `released`
  FROM
    `uss_db`.`user_rewards` `a`
  WHERE
    (`a`.`ticker` <> 'usdc')
  GROUP BY
    `a`.`user`,
    `a`.`token`
),
`t2` AS (
  SELECT
    `b`.`user` AS `user`,
    `b`.`token` AS `token`,
    sum(IFNULL(`b`.`withdrawn`, 0)) AS `withdrawn`
  FROM
    `uss_db`.`user_rewards_withdraw` `b`
  WHERE
    (`b`.`status` IN ('pending', 'completed'))
  GROUP BY
    `b`.`user`,
    `b`.`token`
),
`t3` AS (
  SELECT
    `a`.`user` AS `user`,
    `a`.`token` AS `token`,
    `a`.`rewards` AS `rewards`,
    `a`.`locked` AS `locked`,
    `a`.`released` AS `released`,
    IFNULL(`b`.`withdrawn`, 0) AS `withdrawn`
  FROM
    (
      `t1` `a`
      LEFT JOIN `t2` `b` ON(
        (
          (`b`.`user` = `a`.`user`)
          AND (`b`.`token` = `a`.`token`)
        )
      )
    )
)
SELECT
  md5(((`a`.`user` + `a`.`token`) + `b`.`ticker`)) AS `id`,
  `a`.`user` AS `user`,
  `a`.`token` AS `token`,
  `a`.`rewards` AS `rewards`,
  `a`.`locked` AS `locked`,
  `a`.`released` AS `released`,
  `a`.`withdrawn` AS `withdrawn`,
  `b`.`ticker` AS `ticker`,
  `b`.`token_info` AS `token_info`
FROM
  (
    `t3` `a`
    LEFT JOIN `uss_db`.`ip_library` `b` ON((`b`.`token_mint` = `a`.`token`))
  )