SELECT
  `uss_db`.`ip_library`.`id` AS `id`,
  `uss_db`.`ip_library`.`current_token_info` AS `current_token_info`,
  coalesce(
    cast(
      json_extract(
        `uss_db`.`ip_library`.`current_token_info`,
        '$.price'
      ) AS decimal(65, 12)
    ),
    0
  ) AS `price`,
  coalesce(
    cast(
      json_extract(
        `uss_db`.`ip_library`.`current_token_info`,
        '$.bondingCurveProgress'
      ) AS decimal(65, 12)
    ),
    0
  ) AS `bonding_curve_progress`,
  coalesce(
    cast(
      json_extract(
        `uss_db`.`ip_library`.`current_token_info`,
        '$.change1h'
      ) AS decimal(65, 12)
    ),
    0
  ) AS `change1h`,
  coalesce(
    cast(
      json_extract(
        `uss_db`.`ip_library`.`current_token_info`,
        '$.change5m'
      ) AS decimal(65, 12)
    ),
    0
  ) AS `change5m`,
  coalesce(
    cast(
      json_extract(
        `uss_db`.`ip_library`.`current_token_info`,
        '$.change24h'
      ) AS decimal(65, 12)
    ),
    0
  ) AS `change24h`,
  coalesce(
    cast(
      json_extract(
        `uss_db`.`ip_library`.`current_token_info`,
        '$.marketCap'
      ) AS decimal(65, 12)
    ),
    0
  ) AS `market_cap`,
  coalesce(
    cast(
      json_extract(
        `uss_db`.`ip_library`.`current_token_info`,
        '$.totalSupply'
      ) AS decimal(10, 0)
    ),
    0
  ) AS `total_supply`,
  coalesce(
    cast(
      json_extract(
        `uss_db`.`ip_library`.`current_token_info`,
        '$.tradeVolume'
      ) AS decimal(65, 12)
    ),
    0
  ) AS `trade_volume`
FROM
  `uss_db`.`ip_library`