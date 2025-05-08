WITH `t1` AS (
  SELECT
    `a`.`user` AS `user`,
    `a`.`token` AS `token`,
    `a`.`ticker` AS `ticker`,
    sum(`a`.`rewards`) AS `rewards`,
    sum(`a`.`locked_rewards`) AS `locked`,
    sum(`a`.`released_rewards`) AS `released`,
    sum(IFNULL(`b`.`withdrawn`, 0)) AS `withdrawn`
  FROM
    (
      `uss_db`.`user_rewards` `a`
      LEFT JOIN `uss_db`.`user_rewards_withdraw` `b` ON(
        (
          (`a`.`token` = `b`.`token`)
          AND (`a`.`user` = `b`.`user`)
          AND (`b`.`status` IN ('pending', 'completed'))
        )
      )
    )
  WHERE
    (`a`.`ticker` <> 'usdc')
  GROUP BY
    `a`.`user`,
    `a`.`token`,
    `a`.`ticker`
)
SELECT
  md5(((`a`.`user` + `a`.`token`) + `a`.`ticker`)) AS `id`,
  `a`.`user` AS `user`,
  `a`.`token` AS `token`,
  `a`.`ticker` AS `ticker`,
  `a`.`rewards` AS `rewards`,
  `a`.`locked` AS `locked`,
  `a`.`released` AS `released`,
  `a`.`withdrawn` AS `withdrawn`,
  `b`.`token_info` AS `token_info`
FROM
  (
    `t1` `a`
    LEFT JOIN `uss_db`.`ip_library` `b` ON((`b`.`token_mint` = `a`.`token`))
  )