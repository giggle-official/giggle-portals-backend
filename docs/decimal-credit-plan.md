# 积分小数化方案

状态：**待评审，未动工。** 目标是让 widget 能直接按真实成本扣费（LLM 单次调用普遍不足 1 积分），不必自己写累积与滚动逻辑。

---

## 1. 为什么不能直接把列改成 DECIMAL 就完事

`Int` → `DECIMAL` 之后 Prisma 返回的是 `Decimal` 对象，不是 `number`。实测：

```
JSON.stringify(Decimal(100))     = {"v":"100"}    ← 整数也变字符串
JSON.stringify(Decimal(99.537))  = {"v":"99.537"}
Decimal(100) + 1                 = 1001           ← 字符串拼接，静默
```

两个后果：

- **响应类型立刻变化。** 不用等出现小数，改完列的那一刻所有余额就从 `100` 变成 `"100"`，下游按 number 处理的地方全部受影响。
- **`Decimal + number` 是拼接。** `100 + 1 = 1001`，不报错，发生在钱上。

所以方案的核心不是列类型，而是**把 `Decimal` 挡在 JSON 之外**。

## 2. 四条设计原则

1. **老列一个字不动。** 不 `MODIFY` 任何现有列的类型。新增 `*_precise` 列承载真值，老的 `INT` 列降级为它的**向下取整投影**，靠一条不变式维护：`老列 = FLOOR(新列)`，同事务内写入。
2. **老接口一个字不动。** 字段名、类型、语义、取值全部不变。老接入方不改一行代码，看到的响应与今天逐字节相同。
3. **`Decimal` 永不进 JSON。** 所有出口显式转换，并加一道守卫在非生产环境把漏网的 `Decimal` 直接打成错误，让这条不变式可强制而不是靠自觉。
4. **业务逻辑只读写 `_precise`。** 算术全程在单列上用 `Decimal` 完成。老列不参与任何运算，只在写入末尾被重新投影一次。

### 2.1 为什么老列存投影而不是存小数部分

一个自然的想法是老列存整数部分、新列只存 `[0,1)` 的小数部分。**不要这么做**，四个理由：

- **漏改一处是静默错值。** 真值变成 `int + frac`，每个读点都要相加；漏一处拿到的是个合法的数，永远差不到 1 分钱，没有任何信号。而投影方案漏一处拿到的是 `FLOOR` 后的正确整数，本来就是老接口的语义。
- **借位让原子更新变成读改写。** 从 `(99, 0.02)` 扣 `0.037` 要借位成 `(98, 0.983)`，`{ decrement }` 表达不了。而且 **MySQL 的 `SET` 从左到右求值，后面的赋值看到的是前面刚更新过的列**（与标准 SQL 不同），一条 UPDATE 里同时改两列极易写错且不报错。
- **`frac ∈ [0,1)` 是数据库管不住的约束。** 任何 bug 写进 `1.5`，真值就有歧义。
- **负数与聚合都要重做。** `-0.037` 拆成 `(0, -0.037)` 还是 `(-1, 0.963)` 都说得通，混用必然出 bug；43 处 `SUM(amount)` 要全改成两列相加，跨行小数和会超过 1，还得归一化。

投影方案把不变式从「小数部分必须落在 [0,1) 且借位处处正确」降级成**一个单向派生**，而且可以用一条 SQL 持续证明：`WHERE 老列 <> FLOOR(新列)` 必须永远为空。

## 3. 数据模型

### 3.1 加列，不改列

**没有一条 `MODIFY`。** MySQL 8+ 的 `ADD COLUMN` 走 `ALGORITHM=INSTANT`，是元数据变更、不重建表——`credit_statements` 几十万行的重建直接省掉。

```sql
ALTER TABLE users
  ADD COLUMN current_credit_balance_precise DECIMAL(18,6) NOT NULL DEFAULT 0,
  ALGORITHM=INSTANT;

ALTER TABLE credit_statements
  ADD COLUMN amount_precise  DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN balance_precise DECIMAL(18,6) NOT NULL DEFAULT 0,
  ALGORITHM=INSTANT;

ALTER TABLE orders
  ADD COLUMN amount_precise             DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN credit_paid_amount_precise DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN free_credit_paid_precise   DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN refunded_amount_precise    DECIMAL(18,6) NOT NULL DEFAULT 0,
  ALGORITHM=INSTANT;

ALTER TABLE free_credit_issues
  ADD COLUMN amount_precise  DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN balance_precise DECIMAL(18,6) NOT NULL DEFAULT 0,
  ALGORITHM=INSTANT;

ALTER TABLE widget_subscription_credit_issues
  ADD COLUMN issue_credits_precise   DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN current_balance_precise DECIMAL(18,6) NOT NULL DEFAULT 0,
  ALGORITHM=INSTANT;
```

带上 `ALGORITHM=INSTANT` 是为了**让它在不支持时立刻报错**，而不是悄悄退化成重建表。

`DECIMAL(18,6)`：12 位整数部分约 1 万亿积分，8 字节。

### 3.2 回填

加完列后把历史值抄过去，分批执行：

```sql
-- 每张表一条，按主键分批，直到 affected rows = 0
UPDATE users SET current_credit_balance_precise = COALESCE(current_credit_balance, 0)
 WHERE id BETWEEN ? AND ?;
```

回填后不变式立即成立：`老列 = FLOOR(新列)`，且此刻两者精确相等（全是整数）。

也可以不回填、读取时用 `COALESCE(precise, old)`，但那样不变式要分「回填过的」和「没回填的」两种情况讨论。**按当前量级（几十万行，分批秒级）不值得为此牺牲不变式的单一性。**

### 3.3 授信两张表：随 #20 一起加列

> **2026-08-27 更正。** 本节原先写的是「DDL 尚未在生产执行，建表时顺便带上新列即可，零成本，窗口过了要多走一遍 §3.1 和 §3.2」。经查生产环境，**两张表已经存在**（`giggle_ipos`，各 0 行），那个窗口早就关了。而且既然是空表，现在 `ADD COLUMN` 和以后 `ADD COLUMN` 成本完全相同——都是瞬时，都不需要回填。**不存在窗口，也不存在紧迫性。**

`user_credit_lines` / `credit_line_statements` 共 4 个金额列需要精确列：

| 表 | 列 |
|---|---|
| `user_credit_lines` | `credit_limit`、`used` |
| `credit_line_statements` | `amount`、`used_after` |

**不要提前加。** 加列本身不需要改代码（Prisma 只读写它 schema 里声明过的列，`NOT NULL DEFAULT 0` 的列在 INSERT 时不点名也能满足，线上授信功能一行不用改）——但这恰恰说明提前加没有意义：代码不写新列，新列就停在 0 而老列在正常变动，一旦有人用授信这两列立刻对不上。加出来的是一组会误导人的死列。

正确做法是和「授信服务改走写入原语」**同时落地**，即 #20。列和维护它的代码一起上，不变式从第一天起没有空档。

预计 #20 执行时表里已有少量数据，所以 #20 要比原计划多一步回填。小表，分钟级，不影响判断。

⚠️ `user_credit_lines.used` 允许为负（退款晚于还款时的溢缴，见 schema 注释）。`FLOOR` 向负无穷取整，所以这一列和 §3.5 的负余额是同一类问题，#20 要一并处理。

### 3.5 负余额：75 个真实用户

生产环境清点（2026-08-27，MariaDB 10.11.13）：6,259 个用户里 **75 个 `current_credit_balance` 为负**。`user_credit_lines.used` 同样允许为负。

现在全是整数，`FLOOR` 等于原值，没有任何差别。**但小数放开之后**：一个 -5 的用户被扣 0.5，精确值是 -5.5，整数列变成 `FLOOR(-5.5) = -6`。

所以读老列的地方会把欠款**最多多算 1 个积分**。

选 `FLOOR` 而不是 `ROUND` 或 `TRUNC`，正是为了让误差永远落在这个方向：

- 余额为正时，`FLOOR` 让可用额只少不多——不会让人花掉没有的钱
- 余额为负时，`FLOOR` 让欠款只多不少——不会让人少还钱

两种情况下误差都朝着平台安全的方向。`TRUNC` 会在负数上反过来（`TRUNC(-5.5) = -5`，欠款少算），这也是 §4.1 里余额用 `Math.floor` 而变动额用 `Math.trunc` 的原因：变动额是有符号的流水，取整方向应该对称；余额不是。

⚠️ **这是对外可见的行为变化，需要明确点头，不能默认通过。** 影响面：欠款展示最多偏 1 个积分，方向保守。

顺带：这 75 个负余额是怎么产生的，值得单独查一次，不在本方案范围内。

### 3.4 不动的表

- `reward_pools` / `reward_pool_statement` / `user_rewards` / `web3_orders` —— 本来就是 `Decimal`，与积分无关
- `stripe_orders` / `ip_license_orders` / `ip_license_income` —— `src` 里合计只有 3 处引用，死表

## 4. 序列化规则（方案的支点）

### 4.0 写入侧：一条语句同时改两列，保持原子

投影必须知道新值，而 Prisma 的 `{ increment }` / `{ decrement }` 不读旧值。但 MySQL 可以在**一条 UPDATE 里**做到，而且仍然原子：

```sql
UPDATE users
   SET current_credit_balance_precise = current_credit_balance_precise - ?,
       current_credit_balance         = FLOOR(current_credit_balance_precise)
 WHERE username_in_be = ?;
```

⚠️ **这条语句的正确性依赖 MySQL 的一个非标准行为：`SET` 从左到右求值，后面的赋值看到的是前面刚更新过的列。** 所以第二行的 `FLOOR(...)` 取的是刚减完的新值。换成标准 SQL 语义（用旧值）就是错的。

这正是 §2.1 里警告过的那个坑——在拆列方案里它是陷阱，在投影方案里它恰好是我们要的语义。**代码里必须写明这一点**，并且有一条专门的测试锁住它（见 §9.4）。

收益：

- **保持原子**，不需要先读后写，也就不需要给现有路径新增行锁
- **只有一处**：封装成一个 `adjustCredit(tx, user, delta)` helper，30 处扣加余额都调它
- 主扣款路径（`consumeCredit`，`credit.service.ts:478`）本来就持有 `SELECT ... FOR UPDATE` 的用户行锁，与这条语句叠加没有冲突

代价：这是 `$executeRaw`，仓库里目前一处都没有，属于新引入的模式；且 MySQL 方言锁定。考虑到只此一处、且已被测试覆盖，可接受。

### 4.1 读取与序列化

每个返回金额的 DTO 都经过一个显式 mapper，用统一的两个函数产出成对字段：

```ts
/** 余额、额度、可用额：向下取整，绝不高报可花的钱 */
const asIntBalance = (d: Decimal | null): number => Math.floor(Number(d ?? 0))

/** 有符号的变动额：向零截断，绝不夸大变动幅度 */
const asIntMovement = (d: Decimal | null): number => Math.trunc(Number(d ?? 0))

/** 精确值出口，6 位小数在 IEEE754 内可精确表示 */
const asPrecise = (d: Decimal | null): number => Number(d ?? 0)
```

两条取整规则各自对应字段的含义，不能混用：

| 字段性质 | 取整 | 理由 |
|---|---|---|
| 余额 / 额度 / 可用额 | `floor` | 高报会让调用方以为能扣却扣不动 |
| 有符号变动额（消费、退款、还款） | `trunc` | `floor(-0.037) = -1`，把 0.037 的消费夸大 27 倍 |

### 4.2 守卫

加一个全局响应拦截器：遍历响应体，遇到 `Decimal` 实例时——

- 非生产环境：抛错，让测试立刻红
- 生产环境：转成 number 并打 `logger.error`，不让用户受影响，但留下痕迹

守卫是安全网不是机制。**正常路径必须走 mapper**，守卫用来保证「漏了一处」是可发现的，而不是变成一个字符串悄悄流到下游。

### 4.3 ESLint 规则

禁止对 `Decimal` 类型用 `+ - < > <= >=`。`Decimal(100) + 1 = 1001` 这类错误只有静态检查能拦住，code review 拦不住。

## 5. 请求侧

### 5.1 规则

- 新增 `*_precise` 可选字段，与老字段**互斥**
- 两个都传 → `400 Provide either <field> or <field>_precise, not both`。不做「precise 优先」这类隐式规则，传两个说明调用方没想清楚，静默挑一个就是在钱上猜
- `*_precise` 同时接受 number 和 string（`0.037` 或 `"0.037"`），在意浮点的接入方可以完全绕开 IEEE754
- 超过 6 位小数 → `400`，**不静默取整**。悄悄改掉别人的价格比报错糟

### 5.2 字段清单

| DTO | 老字段 | 新增 |
|---|---|---|
| `CreateOrderDto` | `amount` | `amount_precise` |
| `OrderCostsAllocationDto` | `amount` | `amount_precise` |
| `RefundOrderDto` | `refund_amount` | `refund_amount_precise` |
| `TopUpDto` / `PayTopUpOrderDto` | `amount` | `amount_precise` |
| `IssueFreeCreditDto` | `amount` | `amount_precise` |
| `SubscriptionCreditDto` | `amount` | `amount_precise` |
| `UpdateWidgetSubscriptionsDto` | `paid_amount` | `paid_amount_precise` |
| `GrantCreditLineDto` | `credit_limit` | `credit_limit_precise` |
| `RepayCreditLineDto` | `amount` | `amount_precise` |

```jsonc
// 老接入方，一字不改
{ "amount": 100, "item": "chat" }

// 新接入方，报真实成本
{ "amount_precise": 0.037, "item": "chat" }
```

## 6. 响应侧

| DTO | 老字段（整数，保持不变） | 新增（精确） |
|---|---|---|
| `UserCreditBalanceDto` | `total_credit_balance`, `free_credit_balance` | 各加 `_precise` |
| `CreditStatementDto` | `amount`, `balance` | 各加 `_precise` |
| `OrderDto` | `amount`, `credit_paid_amount`, `free_credit_paid`, `refunded_amount` | 各加 `_precise` |
| `OrderRefundedDetailDto` | `amount`, `order_amount_after_refund` | 各加 `_precise` |
| `CreditLineDto` | `credit_limit`, `used`, `available` | 各加 `_precise` |
| `WidgetCreditLineDto` | `credit_balance` | `credit_balance_precise` |
| `RepayCreditLineResponseDto` | `repaid`, `credit_line_used`, `credit_line_available`, `credit_balance` | 各加 `_precise` |
| `CreditLineStatementDto` | `amount`, `used_after` | 各加 `_precise` |

```jsonc
{
  "total_credit_balance": 99,             // floor，永远整数
  "free_credit_balance": 10,
  "total_credit_balance_precise": 99.537, // 真值
  "free_credit_balance_precise": 10
}
```

### 6.1 老字段失真的实际暴露面（比看起来小）

老字段取整会与真值有出入，但**大部分对象是按 widget 隔离的**：订单、授信额度、授信流水都只属于创建它们的那个 widget。一个从不发小数的 widget，在自己的对象上永远看不到非整数，取整是恒等操作。

真正跨 widget 可见的只有三处，需要重点验证：

1. `GET /api/v1/user/profile` 的 `current_credit_balance`（全局余额，gateway / admin 都读它）
2. `GET /api/v1/credit-line/widget` 的 `credit_balance`（返回给 widget 的用户可还余额）
3. `GET /api/v1/credit/balance` 与 `/credit/statement`（用户 JWT，只有我们自己的前端在用）

前两处是外部可见的，`floor` 在这两处正好是安全方向。

## 7. 代码改动

### 7.1 不用改的

- **SQL 聚合**：43 处 `SUM()` 现在返回的就已经是 `Decimal`（对 `INT` 列做 `SUM` 也一样），仓库里的 `toNumber` helper 一直在处理。只需把列名换成 `_precise`
- **接口层**：老字段的 DTO 定义、`@IsInt` 校验、`@ApiProperty` 全部保留不动

### 7.2 必须改的

| 位置 | 改动 | 规模 |
|---|---|---|
| 新增 `adjustCredit(tx, user, delta)` | 封装 §4.0 那条 UPDATE，成为**唯一**改动积分列的入口 | 1 处 |
| 所有加减余额的调用点 | 从 `{ increment }` / `{ decrement }` 改为调 `adjustCredit`，delta 用 `Decimal` | ~30 处 |
| `credit.service.ts` 的 `spendBalanceBuckets` | **分桶遍历的加减必须全程 `Decimal`**，不能中途转 number 再转回。这是唯一会累积误差的地方 | 1 处，最需要小心 |
| `credit-line.service.ts:110/320/596` | 三处 `Number.isInteger` 硬守卫，现在会把 `0.5` 当非法值拒掉 | 3 处 |
| 各 DTO mapper | 按 §4.1 产出成对字段 | 8 个 DTO |
| 各 DTO 新字段 | `@IsNumber` + `@MaxDecimalPlaces(6)`，**老字段的 `@IsInt` 保留** | 9 请求 / 19 响应 |
| 文档字符串 | `credit.dto.ts:28`、`order.dto.ts:512/547` 的「must be integer」「only accept integer」补充说明新字段 | 3 处 |

### 7.3 日报（结算口径）

`getCreditStatictics` 的聚合本来就走 `Decimal` + `toNumber`，口径不变。需要确认的是**小数消费在跨过 1 积分之前对报表是否可见**——精确求和会把它们算进去，这是正确行为，但要在 §6 的报表文档里说明。

## 8. 上线顺序

分三步。**前两步对外完全不可见。**

**第一步：加列 + 回填 + 内部改造（对外零变化）**
执行 §3.1 的 `ADD COLUMN` 与 §3.2 的回填，业务逻辑改为读写 `_precise`、按 §4.0 维护投影。所有响应仍然只返回老字段。此时行为与现在**逐字节相同**。

**第二步：加接口字段（纯增量）**
上 `*_precise` 请求与响应字段。老接入方读不到新字段，行为不变。

**第三步：开闸**
让某个 widget 开始发 `*_precise`。**这是第一笔小数产生的时刻。**

### 8.1 老列永久保留，不做下线

老列是 `FLOOR(_precise)` 的冗余投影，占 11 列 × 4 字节，没有任何维护成本。**不安排下线**，因为删掉它没有收益，却要承担一次「确认全仓库无人读」的排查风险。

留着反而有两个好处：

- **永久的兜底**：任何没有审到、或将来新写的代码直接读老列，拿到的仍是 `FLOOR` 后的正确整数——正好是老接口的语义，不会拿到错值或字符串
- **永久的对账锚点**：`WHERE 老列 <> FLOOR(新列)` 可以一直跑下去，是这个方案唯一需要持续监控的不变式

### 8.2 回滚

| 阶段 | 回滚方式 | 是否无损 |
|---|---|---|
| 第一步后 | `DROP COLUMN` 新列 | 无损。老列从头到尾没被碰过 |
| 第二步后 | 下掉新接口字段 | 无损 |
| 第三步后 | 把发小数的 widget 切回整数 | **业务上可逆，数据上不可逆**——已落库的小数不能还原成整数 |

关键性质：**前两步的回滚只是 `DROP COLUMN` 新列，老列自始至终没有被修改过**，这比「`ALTER` 回 `INT`」安全一个量级。

## 9. 测试方案

第三步开闸不可逆，所以测试要按「每一步各自的放行条件」来组织，而不是笼统跑一遍。

### 9.0 先决条件：必须有真实 MySQL 的集成测试

现在仓库里的 jest 把 prisma 整个 mock 掉，**这类测试在本方案里几乎没有价值**——它验证不了 `DECIMAL` 的存取往返，而精度损失恰恰只在往返时发生。mock 出来的「`0.037` 存进去又拿出来还是 `0.037`」是同义反复。

这次要建 `test/integration/`（独立 jest config，连真库，事务内跑完回滚）。前几个需求里这个缺口已经出现过三次（授信并发撞键、退款链路、日报聚合），本方案是让它变成必需的那一个。

### 9.1 从失败模式倒推

| # | 失败模式 | 由哪层拦住 |
|---|---|---|
| F1 | `Decimal` 漏进 JSON，响应类型静默变化 | 契约测试 + 守卫 |
| F2 | `Decimal + number` 变字符串拼接 | ESLint + 单元 |
| F3 | 中途转 `number` 导致精度丢失 | 集成（累积） |
| F4 | 分桶遍历总和对不上余额 | 集成（不变式） |
| F5 | 取整方向错，高报余额或夸大变动 | 单元 |
| F6 | 老字段契约被打破 | 黄金快照回归 |
| F7 | 迁移本身改动了值 | 迁移验证 |
| F8 | 并发小数扣款竞争 | 集成（真库并发） |
| F9 | 小数订单退款不精确 | 集成 |
| F10 | 日报口径偏移 | 集成 + 上线后核对 |

### 9.2 第一步放行条件：证明「对外零变化」

第一步的全部承诺是**行为与现在逐字节相同**，所以要机械地证明，而不是靠肉眼比对。

**黄金快照回归（最高价值的一条）**

1. 改动前，用一组固定夹具（整数金额）把每个返回金额的接口都打一遍，把响应原样存成快照文件
2. 改动后，同一组夹具重放
3. **断言逐字节一致**——包括字段顺序、数字格式（`100` 不能变成 `100.0` 或 `"100"`）

覆盖：`/credit/balance`、`/credit/statement`、`/order/pay-with-credit`、`/order/refund`、`/credit/issue-credit`、`/credit/issue-free-credit`、`/credit-line/*` 全部五个、`/user/profile`。

这一条挂了就说明第一步的承诺不成立，直接拦住上线。

**迁移验证**

在生产数据副本上执行 §3.1 的 `ADD COLUMN` 与 §3.2 的回填，然后：

1. **老列逐行未变**：前后各导出一次全部老列，`diff` 必须为空。老列在整个方案里从头到尾不应被修改过
2. **投影不变式成立**：每张表 `SELECT COUNT(*) FROM t WHERE 老列 <> FLOOR(新列)` 必须为 0
3. **`ALGORITHM=INSTANT` 真的生效**：语句没有报错即证明没有重建表；同时记录执行耗时作为佐证

**投影不变式的持续校验**

把第 2 条做成一个可随时执行的脚本（11 个列、5 张表 + 授信 2 张表）。**第一步之后它必须永远为 0**——老列不下线，所以这条检查也长期有效，是这个方案唯一需要持续监控的对账锚点。

**守卫自检**

故意在一个 mapper 里漏掉转换，非生产环境必须抛错。**这条测试保证守卫本身是活的**——一个从不失败的守卫等于没有守卫。

### 9.3 第二步放行条件：证明「纯增量」

- 老字段在新增 `*_precise` 后，值与第一步的快照仍然逐字节一致
- 只传老字段的请求，行为不变（复用 9.2 的夹具）
- 只传 `*_precise` 的请求，与传等值整数老字段的结果**在库里完全一致**（`amount: 100` 与 `amount_precise: 100` 产生同样的行）
- 互斥校验：同时传两个 → 400，且**不产生任何副作用**（订单没建、余额没动）
- 位数校验：`0.0000001`（7 位）→ 400
- string 形式：`"0.037"` 与 `0.037` 产生同样的行

### 9.4 第三步放行条件：小数端到端 + 不变式

**不变式测试（比用例测试更能抓住这类 bug）**

随机跑 N 次操作（充值 / 消费 / 退款 / 发免费积分 / 授信消费 / 还款），金额随机取 6 位小数，然后断言：

1. `users.current_credit_balance` **精确等于** 免费桶合计 + 订阅桶合计 + 付费残值
2. 最新一条 `credit_statements.balance` **精确等于** `users.current_credit_balance`
3. `user_credit_lines.used_precise` **精确等于** 最新一条 `credit_line_statements.used_after_precise`
4. 任一时刻余额不为负
5. **投影不变式**：每个老列 `= FLOOR(对应新列)`

**投影语义锁定测试**

§4.0 那条 UPDATE 依赖 MySQL「`SET` 从左到右、后面的赋值看到已更新的列」这个非标准行为。写一条测试直接打真库：余额 `100.0` 扣 `0.037` 之后，`_precise` 必须是 `99.963` 且老列必须是 `99`。

**如果 MySQL 用的是旧值，老列会算出 `100`，不变式立刻破。** 这条测试就是这个方案的地基，它挂了整个写入路径都要重做。

「精确等于」指 SQL 层比较，不经过 JS 的 number。这几条是设计里本来就有的对账锚点（`used_after` 快照就是为此存在的），现在用来当断言。

**累积精度**

连续 1000 次 `0.001` 扣款后，余额与期望值精确相等。**这一条能抓住任何在中途转 `number` 的实现**——单次转换看不出问题，累积一千次就会漂。

同样跑一遍 1000 次 `0.000001`（最小单位），确认不会被吞成 0。

**分桶**

`0.037` 跨免费 / 订阅 / 付费三个桶消费，各桶扣减与 `credit_statements` 逐条对得上，三条流水金额之和精确等于 `0.037`。

**并发**

真库双连接，同一用户两笔 `0.6` 的扣款并发（余额 `1.0`）：必须恰好一笔成功，余额精确为 `0.4`，不能出现 `0.4000001` 或两笔都成功。

**退款**

小数订单部分退款：`refunded_amount` 精确，`PARTIAL_REFUNDED` → `REFUNDED` 状态流转正确，退回的积分精确回到原桶。

**取整方向**

- 余额 `99.537` → 老字段 `99`（`floor`）
- 消费 `-0.037` → 老字段 `0`（`trunc`），**不是 `-1`**
- 可用额 `800.25` → 老字段 `800`

**日报**

同一组夹具下，`getCreditStatictics` 的付费消耗、免费消耗、充值三项在小数场景下精确；再跑一遍全整数夹具，结果与第一步快照一致。

### 9.5 上线后核对

**第一步之后**：抽查若干真实用户，`current_credit_balance` 与迁移前记录的值逐个比对；观察 24 小时错误日志里有没有守卫打出的 `Decimal` 漏网记录。

**第三步之后（开闸当天）**：

- 每小时跑一次 §9.4 的四条不变式，对**全量真实数据**执行（纯 SQL，不经过应用）
- 盯 `credit_statements` 里出现的第一批小数流水，人工核对前 20 条
- 盯下游：gateway / admin / website 的错误率

**回滚判据**：任一不变式在真实数据上不成立，立即停止开闸（把发小数的 widget 切回整数），不必等定位原因。第三步之后 DDL 不可逆，但**业务上可逆**——停止产生新的小数即可。

### 9.6 不在自动化测试覆盖内

- **外部 widget 的行为**。我们只能保证接口契约不变，接不住的是他们代码里的整数假设。缓解：上线前主动通知 + 提供一个小数场景的 sandbox 让他们自测。
- **我们自己三个仓库**已扫过，无 `parseInt` 类整数断言，全部走 `Number()` 强转，安全。

## 10. 已确认的决策

1. **精度 `DECIMAL(18,6)`**，6 位小数，最小计费单位 $1e-8。
2. **命名 `*_precise`**，请求与响应统一。
3. **`*_precise` 响应返回 `number`**，不返回 string。6 位小数在 IEEE754 内可精确表示，调用方拿到即可直接计算。

### 不在本方案范围

**gateway 的累积器与本方案无关，不由本方案改动。** `settle_pending_micro` 与 `llm_credit_settlements` 是 hopsapi 侧为了绕开「IPOS 只收整数」而写的，本方案上线后它们**失去存在理由、可以简化**，但那是 hopsapi 仓库的独立排期，既不阻塞本方案、本方案也不依赖它。
