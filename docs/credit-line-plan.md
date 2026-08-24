# 授信积分（Credit Line）实施方案

状态：**#2 #3 #4 #5 #6 已合并，只剩 #7（支付通道）。上线 DDL 见[§14](#14-上线-ddl-清单)，尚未在生产执行。**
最后更新：2026-08-21

授信积分让用户可以先消费后付款，类似信用卡。授信额度由 widget 授予、**只能在该 widget 内使用和还款**；还款是一个**显式的原子接口**，不随充值自动发生，门禁由 widget 来做。授信支付是一条**独立的支付通道**，与积分支付互斥，一个订单要么走授信、要么走积分，不存在混合支付。

本版**不做月账单、不做还款日、不计息、不做逾期处理**，详见[不在本期范围](#不在本期范围)。

---

## 1. 已确认的决策

**D1 — 授信不进 `users.current_credit_balance`。**
这一列是用户的**真实可花余额**（免费 + 订阅 + 付费），全平台都在读它。授信是独立的负债账户：`credit_limit`、`used`（当前欠款）、`available = limit - used`。`current_credit_balance` 永远不为负，也永远不包含授信。

**D2 — 授信是独立支付通道，与积分支付互斥。**
一个订单要么**全额**用授信支付，要么走普通积分（订阅／付费／免费）。不混合、不找零、不用积分补差额。授信走独立接口和独立的 `PaymentMethod`，`consumeCredit` 完全不涉及授信。授信额度不足就是支付失败，不会退化成部分授信 + 部分积分。

**D3 — 授信额度按 `(用户, widget)` 隔离。**
widget A 授予的额度，只能支付 widget A 的订单，也只能由针对 widget A 的还款来抵消。不存在跨 widget 的额度共享，也不存在全局额度。

**D4 — 授信订单的退款回到授信账户。**
不进真实余额。退款金额直接冲减该 widget 授信账户的 `used`。

**D5 — 还款是一个显式的原子接口，不随充值自动发生。**
早期版本设想「付费充值时自动抵消同 widget 的欠款」，这个设计有个必然漏洞：**余额是全局的，授信是按 widget 隔离的。** 用户只要去一个没有授信权限的 widget 充值，钱就进了全局余额，而有授信的那个 widget 里欠款纹丝不动。结果是：

- 开发者侧困惑——同一个用户「有余额」和「欠着授信没还」同时成立，看不出为什么
- 用户侧可利用——固定在没有授信权限的 widget 充值，就能永远不还款，授信变成白拿

所以还款必须是显式发起的一次原子调用：`POST /api/v1/credit-line/repay`，从可还余额里扣、冲减该 widget 的 `used`，一个事务里完成。

**门禁由 widget 来做**：widget 查到「这个用户有余额、且欠着我的授信」时，可以强制他先走还款接口再继续使用。平台只保证接口是原子的、金额是对的，不替 widget 决定什么时候催。

widget 也可以**代用户发起还款**，不需要用户当场操作。理由是 widget 都是可信开发者：额度是它授予的，消费也发生在它的场景里，它本来就有权处置这笔债对应的积分。所以还款接口同时开放用户 JWT 和 widget JWT 两条入口。

**只有免费积分不能用于还款**，赠送的积分不该拿去还负债。订阅积分在我们的语境里属于付费积分，可以还款——这与结算口径是一致的，日报里订阅消耗本来就计在付费桶（`is_free_credit = 0`）。

**D6 — widget 权限只有一个位：`CAN_GRANT_CREDIT_LINE`。**
widget 只能给自己授信（`widget_tag` 取自 widget JWT，不由请求体指定），因此「谁能授信」和「额度能在哪花」自动一致，不需要第二个权限位。

**D7 — 授信消耗在**还款时**才计入付费口径，而不是花的时候。**
否则给供应商结算的日报会在钱还没到账时就报「付费消耗涨了」，平台等于拿自己的钱结算。收入确认口径因此是**流入该授信账户的现金**，而不是刷卡额。

**D8 — 授信订单以 `COMPLETED` 为终点，没有任何后置流程。**
用户还没有真实消费，所以支付完成之后不该再发生任何事。具体是：

- 不调用 `releaseRewards`，不产生 `user_rewards` 和 `reward_pool_statement`，状态永远不会流转到 `rewards_released`
- 不调用 `updateBindRewards`
- 不进入回购（`buyback_after_paid` 恒为 `false`）
- 不进入 settle（settle 由奖励池流水触发，天然到不了）
- 不被 `releaseAllOrders` 捞起来（注意它的 `@Cron` 目前是注释掉的，并没有在跑，但接口层仍可被触发，所以照样要挡）

唯一保留的是 `processCallback`。它不是后置流程，是**支付结果通知**——widget 靠它知道订单已付、可以发货，去掉整个功能就没了意义。

「终点」指的是正向流程。退款仍然可以发生，见[§5](#5-退款)。

**D9 — 因此这几类订单禁止授信支付。**
带 `related_reward_id` / `rewards_model_snapshot` / `buyback_after_paid = true` 的订单，以及 `is_credit_top_up` 的充值订单，一律拒绝授信支付。前者是因为授信订单不发奖也不回购，把矛盾提前到支付前暴露，避免用户下单时看到奖励预估、付完却拿不到；后者是因为用授信充值等于把负债直接换成可花余额，而这笔充值又会立刻回头抵消同一笔负债，是个没有意义的循环。

**D10 — 普通积分的消费顺序改为 `订阅 → 付费 → 免费`。**
与授信无关，是独立的一处调整。核心目标是**让免费积分尽量晚烧**：给供应商结算的日报只把消耗二分为免费（`is_free_credit = 1`）和付费（`is_free_credit = 0`），免费积分是唯一会缩小付费数字的桶，所以它排最后。

订阅和付费都落在付费桶里，两者谁先谁后对结算数字没有任何影响。订阅排在前面是保守选择：目前订阅积分实际按「无过期」发放，先烧哪个都不会浪费；但万一以后恢复有限期，先烧订阅就不会造成作废，而反过来会。顺序是一个常量数组，真要调也是改一行。

**这一条与授信毫无耦合，单独一个 PR 先走。**

**D11 — 授信和积分是两个严格独立的账户，各有各的账本和账单接口。**
类比信用卡账户与借记账户：它们不共用一张对账单。因此**授信的消费和退款完全不写进 `credit_statements`**，而是记在授信账户自己的账本 `credit_line_statements` 里；`GET /credit/statement` 只反映积分账户，里面不会出现任何授信消费记录。

唯一同时触碰两个账户的动作是**还款**——它就是「从借记账户还信用卡」，两条腿各记各的账：积分账户记一笔支出（用户的余额确实少了，必须让他看见），授信账户记一笔还款。

说清楚哪些进积分账单、哪些不进，这是最容易搞混的一点：

| 动作 | `credit_statements`（积分账单） | `credit_line_statements`（授信账单） |
| --- | --- | --- |
| 授信支付 | **不写** —— 积分余额没动 | 写 `consume` |
| 授信订单退款 | **不写** —— 积分余额没动 | 写 `refund` |
| 还款 | **要写** `repay_credit_line` —— 花的是真实积分，余额确实少了，不记用户会看到余额平白蒸发 | 写 `repay` |

判据只有一条：**积分余额有没有变**。变了就必须在积分账单留痕，没变就不该出现。

这条决策把早期版本里「给 `credit_statements` 加 `widget_tag` 列，让一张表同时承载两个账户的归属」的做法推翻了。附带的好处是[§7](#7-报表与供应商结算口径)不再需要改动任何一条现有查询——授信消费根本不在那张表里，自然不会污染付费口径。

---

## 2. 数据模型

授信账户有自己的账本（[D11](#1-已确认的决策)），所以 `orders` 不加列，`credit_statements` 也不加列——只加一个流水类型，用来记还款在积分账户这一侧的支出腿。

```prisma
enum credit_line_status {
  active
  frozen
}

model user_credit_lines {
  id           Int                @id @default(autoincrement())
  user         String             @db.VarChar(32)
  widget_tag   String             @db.VarChar(32)
  credit_limit Int                @default(0)
  used         Int                @default(0)   // 当前欠款，可为负（溢缴款，见 §5）
  status       credit_line_status @default(active)
  note         String?            @db.VarChar(1024)
  operator     String?            @db.VarChar(32)   // 最后一次改额度的主体，见下
  created_at   DateTime?          @default(now()) @db.Timestamp(0)
  updated_at   DateTime?          @default(now()) @db.Timestamp(0)

  @@unique([user, widget_tag], map: "user_widget")
}

enum credit_line_statement_type {
  consume     // 授信支付
  repay       // 还款
  refund      // 授信订单退款
}

model credit_line_statements {
  id          Int                        @id @default(autoincrement())
  user        String                     @db.VarChar(32)
  widget_tag  String                     @db.VarChar(32)
  type        credit_line_statement_type
  amount      Int                        // 符号表示对用户的资金方向，见下
  used_after  Int                        // 本次之后的欠款快照
  order_id    String?                    @db.VarChar(64)   // consume / refund：对应订单
  request_id  String?                    @db.VarChar(64)   // repay：幂等键
  created_at  DateTime?                  @default(now()) @db.Timestamp(0)

  @@index([user, widget_tag])
  @@index([widget_tag, created_at])
}
```

### 符号约定

**`amount` 的符号表示这笔钱对用户的方向（负 = 支出，正 = 收入），`type` 决定它对 `used` 的作用方向。** 两者独立，不要用符号去推 `used` 的增减。

| type | amount | 对 `used` | 说明 |
| --- | --- | --- | --- |
| `consume` | **负** | `+` | 用户花掉授信额度 |
| `repay` | **负** | `−` | 用户花掉真实积分还债——还款也是一种消费 |
| `refund` | **正** | `−` | 钱退回来 |

`repay` 取负是刻意的：日报的付费消耗汇总的是 `credit_statements.amount`，而消费在那张表里存的就是负数（模板层再 `* -1` 转正显示）。授信账本的 `repay` 保持同号，[§7](#7-报表与供应商结算口径)才能直接把两边相加，不用在代码里翻符号——**翻符号是这种统计里最容易出错、又最不容易被发现的一步**。

`used_after` 是快照，不是派生值。有了它，授信账单可以直接展示每笔之后的欠款，而且做月账单和日计息时能按时间回放 `used(t)`，不用重算。

`widget_tag` 用 `VarChar(32)`，与 `orders.widget_tag` 对齐——报表要拿这两列比对归属，列宽不一致会带来隐式转换和截断风险。（`widgets.tag` 声明的是 `VarChar(255)`，但订单侧早就按 32 存了。）

`credit_statement_type` 新增 `repay_credit_line`，**只用于还款在积分账户这一侧的支出腿**。授信的消费和退款不进这张表。
`PaymentMethod` 新增 `CREDIT_LINE = "credit-line"`（`order.dto.ts` 的普通 TS 枚举，无 DDL）。

还款的幂等键存在授信账本的 `request_id` 上，语义与 `createOrder` 处理 `order_id` 的既有写法完全一致（`order.service.ts:126-140`）：**不传就服务端 `uuidv4()` 生成，传了就查重、撞上直接抛 `BadRequestException`。** 不自创一套。

于是每条还款流水都必然有 `request_id`，账本可追溯；而重复提交得到的是一个明确的错误，不是静默成功。

**去重范围取 `(user, widget_tag, request_id)` 三元组，不是 `request_id` 单列。** `request_id` 是客户端给的，不能假设它是 UUID——开发者完全可能拿自己的订单号、自增序号甚至 `"1"` 来当键，这些跨用户必然重复；单列去重会让用户 B 收到一个莫名其妙的「重复请求」错误。三元组成本为零，顺带让查重走在 `[user, widget_tag]` 索引上。

**不要加唯一索引**，也不需要为 `request_id` 单独建索引：查重靠事务里的「先查后插」，授信账户行的 `FOR UPDATE` 已经把同一个 `(用户, widget)` 的还款串行化了，锁内的存在性检查不存在竞态。

`operator` 记**最后一次改额度的主体**：widget 开额度时写 `developer_info.tag`（不是 `req.user`——那是 widget 作者，见[§6](#6-widget-权限)的警告），将来管理端调额度时写管理员的 `username_in_be`。本期不做管理端，所以实际只会出现 widget tag 和手工改库两种来源。

`user_credit_lines.user` 不声明 Prisma 关联，与 `credit_statements.user` 保持一致（那一列也是裸 `VarChar`）。

```sql
CREATE TABLE user_credit_lines (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user         VARCHAR(32)  NOT NULL,
  widget_tag   VARCHAR(32)  NOT NULL,
  credit_limit INT          NOT NULL DEFAULT 0,
  used         INT          NOT NULL DEFAULT 0,
  status       ENUM('active','frozen') NOT NULL DEFAULT 'active',
  note         VARCHAR(1024) NULL,
  operator     VARCHAR(32)  NULL,
  created_at   TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY user_widget (user, widget_tag)
);

CREATE TABLE credit_line_statements (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user       VARCHAR(32) NOT NULL,
  widget_tag VARCHAR(32) NOT NULL,
  type       ENUM('consume','repay','refund') NOT NULL,
  amount     INT NOT NULL,
  used_after INT NOT NULL,
  order_id   VARCHAR(64) NULL,
  request_id VARCHAR(64) NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_widget (user, widget_tag),
  KEY idx_widget_created (widget_tag, created_at)
);

-- 必须追加在枚举列表末尾：末尾追加是 in-place 的元数据变更，
-- 插在中间会重建整张 credit_statements（大表）。
ALTER TABLE credit_statements
  MODIFY COLUMN type ENUM(
    'issue_free_credit','expire_free_credit',
    'issue_subscription_credit','expire_subscription_credit',
    'top_up','consume','refund',
    'repay_credit_line'
  );
```

对 `credit_statements` 的改动只剩末尾追加一个枚举值，是纯元数据变更，不重建表。两张新表都是空表。

仓库没有 `prisma/migrations` 目录，DDL 手工执行或走 `db push`。

---

## 3. 授信支付

独立通道，`consumeCredit` 一行不改。

新增 `POST /api/v1/order/pay-with-credit-line`，与现有的 `/pay-with-credit` 对称：**收 `CreateOrderDto`，建单并支付**（内部 `createOrder` 之后调 `payCreditLineOrder`），不是收一个已存在的 `order_id`。

### 支付方式白名单

互斥性靠订单的支付方式声明来保证，但这条链路和文档早期的描述不一样，实现前先看清楚：

- `allowPayOrder` 校验的是订单表的 **`supported_payment_method`** 列，**不是** `allowed_payment_methods`（后者只是 `CreateOrderDto` 的入参字段）。
- 建单时 `allowed_payment_methods` 会先被静态白名单 `OrderService.defaultPaymentMethod` 过滤，过滤结果才写进 `supported_payment_method`；全被滤掉就抛 `Unsupported payment method`。
- **`CREDIT_LINE` 必须加进 `defaultPaymentMethod`**，否则 widget 就算显式声明了也会被静默丢弃，功能根本用不起来。

代价要清楚：`allowed_payment_methods` 没传时，`supported_payment_method` 直接等于整个白名单，所以**没有显式声明支付方式的订单也会变成可授信支付**。敞口是可控的——只有在该 widget 下真的被授予过额度的用户才付得成，而[D9](#1-已确认的决策)的前置拒绝仍然挡住奖励类和充值类订单。

⚠️ 另外别照抄 `payCreditOrder` 的一处历史不一致：它 `allowPayOrder(orderId, userProfile, PaymentMethod.WALLET)` 校验、却落库 `paid_method = PaymentMethod.CREDIT`。新接口两处都必须是 `CREDIT_LINE`，否则[§7](#7-报表与供应商结算口径)和 `view_ip_incomes` 靠 `paid_method` 做的排除会全部失效。

支付校验（全部在事务内、`SELECT ... FOR UPDATE` 锁住授信账户行之后）：

```
line = user_credit_lines(user = orderRecord.owner, widget_tag = orderRecord.widget_tag)

line 不存在                                   -> 拒绝
line.status !== active                        -> 拒绝
widget 已不再持有 CAN_GRANT_CREDIT_LINE        -> 拒绝（权限回收即时生效的开关）
max(0, credit_limit - used) < order.amount    -> 拒绝，不退化成混合支付
```

订单没有 `widget_tag` 就不可能匹配到任何授信账户，因此平台侧订单天然无法用授信，不需要特判。

**授信账户完全由订单本身（`owner` + `widget_tag`）定位，不看调用方是谁。** 调用方身份只用于「这个人有没有资格支付这笔订单」，那是 `allowPayOrder` 已有的职责。这样无论是用户自己的 JWT、widget session token、还是 widget 代付（`user_jwt`），走到扣款时定位到的都是同一个账户，不存在错扣到别人头上的可能。widget 代付的入口按现有 `payCreditOrder` 的写法照抄即可（`if (userInfo.developer_info) { 验 user_jwt → getProfile }`）。

支付动作：

- `line.used += order.amount`
- **不动** `users.current_credit_balance`
- 订单更新为 `current_status = COMPLETED`、`paid_method = CREDIT_LINE`、`paid_time = now`
- 写一条 `credit_line_statements`：`type = consume`、`amount = -order.amount`、`used_after = line.used`、`order_id` 为本单

⚠️ **不写 `credit_statements`。** 授信消费是授信账户的事，积分账户的余额没有任何变化，往积分账单里塞一条「消费」记录会让用户以为积分被扣了（[D11](#1-已确认的决策)）。这也意味着[§7](#7-报表与供应商结算口径)的现有查询完全不用改——授信消费根本不在那张表里。

订单类型的前置拒绝（[D9](#1-已确认的决策)）：

```
orderRecord.related_reward_id 非空        -> 拒绝
orderRecord.rewards_model_snapshot 非空   -> 拒绝
orderRecord.buyback_after_paid === true   -> 拒绝
orderRecord.is_credit_top_up === true     -> 拒绝
```

这个检查必须放在支付时而不是建单时：`buyback_after_paid` 在建单时确定，而支付方式要到支付时才选定，widget 完全可以建一个既绑奖励池、又把 `CREDIT_LINE` 放进 `allowed_payment_methods` 的订单。

支付完成后**只调用 `processCallback`**，不调用 `updateBindRewards`，不调用 `releaseRewards`（[D8](#1-已确认的决策)）。与现有的 `payCreditOrder` 相比，尾部那三步后置流程只保留通知这一步。

`releaseRewards` 内部还要再加一道 `paid_method === CREDIT_LINE` 直接返回的判断。判断写在**方法内部**而不是调用点：目前有 9 处会触发它（`order.service.ts` 六处、`payment-asia`、`paypal`、链上奖励池服务，其中包括 widget 主动调用的 `/order/release-rewards` 和 `releaseAllOrders`），只在授信支付路径里不调用等于没挡住——widget 拿着订单号调一次发奖接口就绕过去了。`releaseRewards` 本来就会自己重查订单并跑一串前置校验，新判断和它们并排放即可。

---

## 4. 还款

**`issueCredit` 一行不改，充值不触发任何抵消**（[D5](#1-已确认的决策)）。还款是独立的原子接口。

### 接口

```
POST /api/v1/credit-line/repay
```

两种调用方，与 `/pay-with-credit` 的既有写法保持一致：

| 调用方 | 鉴权 | 目标 widget | 目标用户 |
| --- | --- | --- | --- |
| 用户自己 | 用户 JWT | 请求体 `widget_tag` | 调用者本人 |
| widget 代发起 | widget JWT + `CAN_GRANT_CREDIT_LINE` | `developer_info.tag` | 请求体 `email` |

请求体：

```ts
{
    widget_tag?: string   // 用户 JWT 调用时必填；widget 调用时忽略，一律用自己的 tag
    email?: string        // widget 调用时必填；用户 JWT 调用时忽略
    amount?: number       // 省略则按 min(可用余额, 欠款) 全额还
    request_id?: string   // 幂等键，不传服务端生成，见下
}
```

### 执行

一个事务，先 `SELECT ... FOR UPDATE` 锁住 `users` 行和 `user_credit_lines` 行，再：

1. `可还余额 = current_credit_balance − 账面上还挂着的全部免费积分`（即订阅 + 付费）。
   这个减项**必须用不带过期过滤的合计**，理由与[§11](#11-实施步骤) #2 那段完全相同：已过期、但还没被 `expireFreeCredit` 扫掉的免费积分依然计在 `current_credit_balance` 里，用带过滤的合计去减会把它误算成可还余额。
2. `repayable = min(amount ?? ∞, max(0, line.used), 可还余额)`
3. `repayable <= 0` → 直接返回当前状态，不报错（幂等友好）
4. **积分账户这一腿**：从真实余额里按 **订阅 → 付费** 的顺序扣掉 `repayable`，与[D10](#1-已确认的决策)的消费顺序一致，只是跳过免费桶；流水写 `credit_statements`，`type = repay_credit_line`
5. **授信账户这一腿**：`line.used -= repayable`，写**一条** `credit_line_statements`，`type = repay`、`amount = -repayable`（符号约定见[§2](#符号约定)）、`used_after = line.used`、`request_id` 记幂等键

两条腿的流水粒度不一样，这是刻意的：积分腿跨几个桶就写几条（和消费流水一致，能对上具体是哪笔订阅/付费被花掉），授信腿**只写一条汇总**——因为 `used` 只减了一次，而[§9](#9-不变式与并发)要求「每一笔 `used` 变动对应一条账本记录」。

还款是唯一同时触碰两个账户的动作，两条腿各记各的账（[D11](#1-已确认的决策)）——就是「从借记账户还信用卡」：借记账单上看到一笔支出，信用卡账单上看到一笔还款。

⚠️ **第 4 步必须真的从桶里扣，不能只把 `current_credit_balance` 减掉。** 订阅积分挂在 `widget_subscription_credit_issues.current_balance` 上，只减总余额会让这两个数对不上，后续的付费余额推导（总余额 − 免费 − 订阅）就会失真，越滚越偏。

实现上把 `consumeCredit` 里的桶遍历抽成一个共用的私有方法，参数化「是否允许动免费桶」和「写哪种流水类型」，`consumeCredit` 和 `repay` 都调它。money 相关的桶扣减逻辑只应该有一份。

### 幂等

与 `createOrder` 处理 `order_id` 的既有写法一致（见[§2](#2-数据模型)）：

- **不传** —— 服务端 `uuidv4()` 生成一个，正常执行。这类调用天然不去重，重复提交会真的还两次；接入方要幂等就自己传。
- **传了** —— 按 `(user, widget_tag, request_id)` 查重，命中已有记录直接抛 `BadRequestException`，不执行第二次扣款。

撞车返回的是明确错误而不是「假装成功」，调用方能自己判断是重放还是键选得不好。这也省掉了「重放时怎么还原当时的余额」这个问题——不存在重放。

### 返回

```ts
{
    repaid: number            // 本次实际还掉的金额
    credit_line_used: number  // 还款后该 widget 下的剩余欠款
    credit_line_available: number
    credit_balance: number    // 还款后的真实可花余额
}
```

用户视角：欠 300、可还余额 1000 → 调一次还款接口 → 余额 700、欠款清零，账单里是 `repay_credit_line` 记录（跨两个桶就是两条，和消费流水的粒度一致）。

---

## 5. 退款

**授信订单的退款规则与积分订单完全一致**，只是钱退回的地方不同。`refundOrder` 的所有前置校验原封不动地适用：

- 订单状态必须是 `COMPLETED` 或 `PARTIAL_REFUNDED`
- `paid_time` 必须在 **10 天**以内
- 支持**部分退款**：`refund_amount` 可选，上限是 `amount - refunded_amount`

这些校验本来就在 `paid_method` 分支之前执行，所以不用为授信另写一套。实现上只是在那个 `switch` 里多一个 `case PaymentMethod.CREDIT_LINE`，落到 `_refundCreditLineOrder(orderId, refundAmount)`，内部镜像 `_refundCreditOrder`：锁订单行、按退款额推进 `PARTIAL_REFUNDED` / `REFUNDED` 状态、累加 `refunded_amount`。

差别只在钱去哪：不走 `CreditService.refundCredit()`，而是调 `CreditLineService.refund()`——

- `line.used -= 退款金额`
- `current_credit_balance` 不动
- 写一条 `credit_line_statements`：`type = refund`、`amount` 取正、`used_after = line.used`、`order_id` 为原订单
- **不写 `credit_statements`**——积分余额没动（[D11](#1-已确认的决策)）

部分退款就是多次调用同一条路径，每次写一条 `refund` 账本记录，`used` 逐次递减。

**`used` 允许为负**，即信用卡的溢缴款：欠款已被还清之后再退款，账户上就会留下一笔预存，`available = credit_limit - used` 自然大于额度，可以继续消费。这符合[D4](#1-已确认的决策)「退款回授信账户」的字面含义，也避免了往真实余额里塞钱破坏互斥。

这对收入确认是自洽的，不需要额外的冲销逻辑：假设借 100 → 用户调还款接口还清（确认 100 付费消耗，结算给供应商）→ 退款 100（`used = -100`）。这 100 确实收到过现金，确认没错。之后用户用这笔溢缴款再消费 100（`used` 回到 0），不需要还款因而不产生还款流水，也就不再确认——总计确认 100，对应实际到账的 100。**按现金流入确认，长期自动平账。**

普通积分订单的退款逻辑完全不变（但见[§11](#11-实施步骤)第 1 步：`refundCredit` 的遍历顺序要随[D10](#1-已确认的决策)一起改成倒序）。

---

## 6. widget 权限

`widget-casl-ability.factory.ts` 的 `WIDGET_PERMISSIONS_LIST` 新增：

```ts
CAN_GRANT_CREDIT_LINE = "can_grant_credit_line",
```

与其它权限一样存在 `widgets.request_permissions`。

- **开额度接口** —— `@UseGuards(IsWidgetGuard, WidgetPoliciesGuard)` 加 `@CheckWidgetPolicies((a) => a.can(WIDGET_PERMISSIONS_LIST.CAN_GRANT_CREDIT_LINE))`，与 `POST /credit/issue-free-credit` 完全一致。`widget_tag` 取自 widget JWT 的 `developer_info.tag`，请求体不接受该字段，widget 无法给别人开额度。

> ⚠️ **在 `IsWidgetGuard` 保护的接口里，`req.user` 是 widget 作者，不是终端用户。**
> `jwt.strategy.ts` 判断到 `iss` 以 `wgt_ak_` 开头时，按 `widgets.access_key` 找到 widget，再用 `widgets.author` 去 `users` 表取记录返回。所以 `req.user.usernameShorted` / `email` 是**开发者自己的账号**，只有 `developer_info.tag` 是 widget 身份。
> 开额度接口里**必须**从请求体的 `email` 解析目标用户（与 `issueFreeCredit` 一致），照着 `req.user` 写会变成 widget 给自己的作者账号开额度——而且因为作者通常也是这个 widget 的合法用户，这个 bug 不会报错，只会静默地开错人。
- **支付时** —— 除了账户匹配，再用 `WidgetCaslAbilityFactory.createForWidget(order.widget_tag)` 校验权限位仍在，作为权限回收的即时开关。

widget 开出的额度受 `CREDIT_LINE_WIDGET_GRANT_MAX`（新增环境变量）封顶，**默认 1000000，不配也能跑**。默认值给得宽，是因为前期用授信的都是大 B 端合作客户，而且权限位本身就是手工维护的白名单——这个上限是用来兜住误操作的，不是主要管控手段。本期没有管理端接口，需要突破它只能改 env 或直接改库。

⚠️ **它封的是「单个 widget 给单个用户」的额度，不是 widget 的总敞口。** 一个 widget 完全可以给一万个用户各开一个顶格额度，代码里没有任何一处会拦。今天约束总量的只有「谁拿到 `CAN_GRANT_CREDIT_LINE`」。要加总敞口上限的话，开额度时需要多一条按 `widget_tag` 的 `SUM(credit_limit)` 校验，而 `user_credit_lines` 的唯一键是 `(user, widget_tag)`、`widget_tag` 打头用不上它，得再加索引——**要动 DDL，另行决定**。在那之前先靠[§7](#7-报表与供应商结算口径)里那个「未偿还授信合计」指标把敞口看见。

---

## 7. 报表与供应商结算口径

`CreditService.getCreditStatictics` 把消耗二分为 `is_free_credit = 1`（免费）和 `is_free_credit = 0`（付费），这份日报是给供应商结算用的。

因为[D11](#1-已确认的决策)把授信消费挪出了 `credit_statements`，**现有的四条查询一个字都不用改**——授信消费根本不在那张表里，自然进不了付费桶，D7 想要的效果自动成立。

只需要做加法：**把还款单独加回付费口径**。

另写一条独立的聚合查询，从 `credit_line_statements` 里按 `widget_tag` 取 `type = 'repay'` 的合计（同样按日／月／总三个区间），在代码里加到付费消耗上。归属天然正确，因为授信账本本来就是按 widget 分的。

**两边同号，直接相加，不要翻符号。** 现有的 `*_paid_consume` 汇总的是 `credit_statements.amount`，消费存的是负数；[§2 符号约定](#符号约定)已经把 `repay` 也定成负数，正是为了这里能直接相加。新增的「当日授信消费额」指标同理——`consume` 在账本里也是负数，展示时按现有模板的习惯 `* -1` 转正即可。

⚠️ **不要试图把还款并进现有那几条 SQL。** 那些查询是 `INNER JOIN orders o ON cs.order_id = o.order_id`，而还款在积分账户那一腿没有订单可挂；为了兼容它去改成 `LEFT JOIN`，会顺带把 `issueFreeCredit` 塞进 `order_id` 的随机 uuid（`orders` 表里根本没有对应行，现在全靠 `INNER JOIN` 挡着）一起放进统计，日报数字会莫名其妙地变。独立查询 + 代码里相加，零风险。

⚠️ **别把还款算两遍。** 还款在 `credit_statements` 里有一条 `repay_credit_line` 的支出腿，但它的 `type` 不在现有查询的 `IN ('consume','refund')` 里，所以不会被现有逻辑捞到；付费口径只从授信账本这一侧加一次。如果哪天有人把 `repay_credit_line` 加进那个 `IN` 列表，就会双计。

最终效果：授信消费在还款前不计入付费口径，还款发生时才计入，日期落在钱真正到账那天，归属到消费实际发生的 widget。

新增一个指标把敞口显性化：该 widget 下的**未偿还授信**，即 `user_credit_lines` 中该 `widget_tag` 下 `used > 0` 的合计，外加当日授信消费额（从 `credit_line_statements` 取）。取数加在 `getCreditStatictics` 里，展示加在 `formatCreditStatsForTemplate` 里（`generateCreditStatictics` 只是发邮件的 cron，不要往那里加取数逻辑）。

### 实现时定下的三件事

**授信消耗按 `type IN ('consume','refund')` 净额统计，不是只取 `consume`。** 与付费口径完全同构——那边也是 `consume` 和 `refund` 一起汇总的净额。只取 `consume` 会让退款后的敞口虚高，和同一封邮件里的「未偿还授信」对不上。日／月／总三个区间都出，成本与只出当日相同。

**「未偿还授信」只加正数（`used > 0`），不做净额。** 退款晚于还款到账时 `used` 会是负数（[§9](#9-不变式与并发)允许的透支状态）。把某个用户的 -200 拿去冲抵另一个用户的 3000，报出来的 2800 不是任何人欠的钱，敞口会被系统性低估。

**Top 10 榜单和「付费积分消耗人数」不含授信。** 它们统计的是消费行为而不是收入确认，口径来源仍然只有 `credit_statements`。如果哪天要把授信用户并进榜单，得按 `user` 关联两本账，属于另一件事。日报正文的付费消耗数字**已经含还款**，两者口径不同是有意的——邮件里「授信还款（已计入付费积分）」那一行就是给这个差额留的对账钩子。

### 一个已知的慢查询（暂不处理）

未偿还授信查的是 `user_credit_lines WHERE widget_tag = ? AND used > 0`，而这张表只有 `(user, widget_tag)` 的联合唯一键，前缀是 `user`，帮不上按 `widget_tag` 过滤，所以是全表扫。日报一天一次、表只有「每个用户每个 widget 一行」的量级，现在无所谓。真要加索引的话，`INDEX (widget_tag)` 同时也是 [§6](#6-widget-权限)里「按 widget 汇总总敞口」所需要的那条，两件事一起做更划算。

### 其他会读订单金额的统计

授信支付在订单表里就是一笔 `current_status = completed` 的正常订单，任何按订单金额汇总的地方都会把它算成真实收入。全仓库排查结果如下。

| 位置 | 是否受影响 | 处理 |
| --- | --- | --- |
| **`view_ip_incomes` 视图**（`prisma/views/uss_db/view_ip_incomes.sql`） | **会被污染** | 条件是 `current_status IN ('rewards_released','completed')`，授信订单正是 `completed`，会被算进 IP 收入。dashboard 的「IP 收入」「收入趋势」全部读它。**必须加 `AND COALESCE(a.paid_method,'') <> 'credit-line'`**，同时更新 `.sql` 文件和线上视图。 |
| **`createBuyBackOrders`**（`reward-pool-on-chain.service.ts`，每 10 分钟，真实上链回购） | 结构上已排除 | 过滤条件是 `buyback_after_paid: true`，按 [D9](#1-已确认的决策) 授信订单该字段恒为 false。但这是真金白银出链，建议再加一道 `paid_method: { not: CREDIT_LINE }` 兜底，防止历史数据或将来新路径漏进来。 |
| `stats.service.genreateDailyRevenueStats` | 天然排除 | 只统计 `rewards_released` 订单产生的 `reward_pool_statement`；授信订单不发奖，永远到不了这个状态。 |
| `checkRewardPoolBalance` / `rewardToChain` | 天然排除 | 只读 `reward_pool_statement`，同上。 |
| `topup-report.service` | 无关 | 读的是 `top_up_orders` 表，与授信订单无关。 |

`view_ip_incomes` 是这次排查里**唯一**一个会被静默污染的口径，而且它喂的是用户能看到的 IP 收入面板，务必别漏。

---

## 8. 接口

授信的接口挂在**独立的 `/api/v1/credit-line/` 前缀**下，不与 `/api/v1/credit/` 混用，文档里也单独一个 `Credit Line` 标签（`main.ts` 的 `x-tagGroups` 里归在 Payment 组，private 和 public 两份都要加）。理由和 [D11](#1-已确认的决策) 一样：授信和积分是两个账户，URL 和文档分类混在一起，正好会造成这套设计想避免的那种混淆。前缀里已经有 `credit-line`，路径末段就不再重复它（`/grant` 而不是 `/grant-credit-line`）。

授信**支付**是例外，它属于订单域，跟 `/pay-with-credit` 并列放在 `/api/v1/order/` 下。

| 接口 | 鉴权 | 改动 |
| --- | --- | --- |
| `POST /api/v1/order/pay-with-credit-line` | 用户 JWT | 新增 —— 授信支付，与 `/pay-with-credit` 对称 |
| `GET /api/v1/credit-line/list` | 用户 JWT | 新增 —— 返回该用户名下各 widget 的额度／欠款／可用／状态列表 |
| `POST /api/v1/credit-line/grant` | widget JWT + `CAN_GRANT_CREDIT_LINE` | 新增 —— `{ email, credit_limit, note }`，`widget_tag` 取自 JWT；设置**绝对额度**（幂等，比增量安全），超过 `CREDIT_LINE_WIDGET_GRANT_MAX` 拒绝 |
| `GET /api/v1/credit-line/widget` | widget JWT + `CAN_GRANT_CREDIT_LINE` | 新增 —— `?email=`，返回**该 widget 下**这个用户的额度／欠款／可用／状态，外加 `credit_balance`（该用户可用于还款的付费余额），一次调用就够 widget 做门禁判断 |
| `POST /api/v1/credit-line/repay` | 用户 JWT 或 widget JWT + `CAN_GRANT_CREDIT_LINE` | 新增 —— 原子还款，见[§4](#4-还款) |
| `GET /api/v1/credit-line/statement` | 用户 JWT，或 widget JWT + `CAN_GRANT_CREDIT_LINE` | 新增 —— 授信账户自己的账单，读 `credit_line_statements`。用户 JWT 调用时用 `?widget_tag=` 指定，**widget JWT 调用时必须带 `?email=` 指定目标用户**（`req.user` 是 widget 作者，见[§6](#6-widget-权限)），widget 侧一律用自己的 tag |
| `GET /api/v1/credit/statement` | 用户 JWT | 只增加一个 `repay_credit_line` 类型（还款的支出腿）。**不出现任何授信消费记录**（[D11](#1-已确认的决策)） |

`POST /api/v1/credit/issue-credit` **不动**——充值不再触发任何抵消，它的响应也就没有抵消金额可返回。

管理端接口（按 widget／用户查额度、不受上限约束地设额度、冻结／解冻）**本期不做**。这期间调额度和冻结只能直接改 `user_credit_lines` 表。

**`GET /api/v1/credit/balance` 和 `GET /api/v1/user/profile` 都不动。** 授信是 widget 维度的，而这两个接口是全局的；把一个 widget 维度的额度挂上去，语义要靠「当前是哪个会话」来隐式决定，调用方很容易读错。widget 需要额度就走上面那个专用接口，解耦更干净。

凡是返回额度字段的接口（`/credit-line/list` 的每个列表项、`/credit-line/widget`、`/credit-line/repay` 的返回体），口径统一：

```
credit_line_limit     = line?.credit_limit ?? 0
credit_line_used      = line?.used ?? 0
credit_line_available = line && line.status === active ? max(0, credit_limit - used) : 0
```

- 账户不存在 —— 三个字段都是 0，不是 404。**尤其是 widget 侧那个按 `email` 查的接口，查不到用户也返回全 0**，否则它就变成了一个邮箱是否注册的探测接口。
- 账户是 `frozen` —— `available` 为 0，但 `limit` / `used` 照实返回；把 `used` 也抹成 0 会让用户不知道自己还欠着钱。
- `available` 的夹逼与[§9](#9-不变式与并发)一致：管理员降额后 `credit_limit - used` 可能为负，接口只能吐 0，不把负数漏给前端。

widget 侧接口按 `(email 对应的用户, 自己的 developer_info.tag)` 取，只可能读到**它自己授予的**那条额度，读不到别的 widget 的，也读不到全局数据。

`status = frozen` 只阻止新的授信支付，不影响已有欠款和还款。

---

## 9. 不变式与并发

- `user_credit_lines.used` 的变动只有三个来源：授信支付（+）、还款（−）、退款（−）。每一次都必须在该行 `SELECT ... FOR UPDATE` 之后发生，并且**必须同时写一条 `credit_line_statements`**，`used_after` 记变动后的值。`used` 与账本末笔的 `used_after` 永远一致，这是对账的锚点。`credit_limit` 的变动来自 `setLimit`，同样要拿锁。
- **积分余额变了就必须在 `credit_statements` 留痕，没变就不该出现在那里。** 授信支付和授信退款不动积分余额，因此不写；还款花的是真实积分，因此必须写。这是[D11](#1-已确认的决策)两个账户不混的判据。
- `used` 可以为负（溢缴款，见[§5](#5-退款)）。
- **`used <= credit_limit` 不是不变式，只是扣款时的前置条件。** `setLimit` 设置的是绝对额度，完全可以把额度调到低于当前欠款（比如欠 500 时降到 100，本期通过直接改库），此时 `credit_limit - used` 为负。这是允许的状态，不需要任何特殊处理：可用额度按 `available = max(0, credit_limit - used)` 计算，负数被夹到 0，任何金额的授信支付都会被拒——降额天然就是「停止授信」的开关。`available` 一律走这个夹逼后的值，不把负数暴露给接口，也不让它参与任何运算。
- **还款和退款路径绝不能引用 `credit_limit`。** 这是降额场景里唯一真正的坑：如果还款时加了任何「不能超出额度」之类的校验，把额度降到欠款以下就会让用户既不能消费、也**还不了钱**，被锁死在欠款里。还款只看 `used` 和可还余额，退款只做 `used -= 退款额`，两者都与 `credit_limit` 无关。
- 还款在积分账户侧跨几个桶就写几条 `credit_statements`，在授信账户侧**只写一条**汇总的 `credit_line_statements`——因为 `used` 只减了一次。
- 还款扣减真实余额时必须走桶（订阅 → 付费），扣完后 `current_credit_balance` 仍然等于免费 + 订阅 + 付费三个桶的合计。这条不变式是付费余额推导的基础，任何绕过桶直接改总余额的写法都会破坏它。
- `users.current_credit_balance` 永远不包含授信，永远不为负。
- 一个订单的 `paid_method` 要么是 `credit-line`、要么不是，不存在既扣了授信又扣了积分的订单。这是整套口径能靠 `paid_method` 判定的前提，也是最该被测试守住的一条。
- 授信不过期。`expireFreeCredit` 和 `expireWidgetSubscriptionCredit` 完全不动。

---

## 10. 已接受的风险

- **坏账由平台承担。** 控制手段是 `credit_limit` 加上谁持有权限位。默认没有授信账户，所以「白名单」就是「谁被开了额度谁才有」。
- **平台不催收，门禁由 widget 做。** 没有还款日、不计息、不自动扣款。用户可以充了值就是不还，平台层面拦不住；能拦的是 widget——它查到「有余额且欠着我的授信」就该拒绝继续服务，直到用户走完还款接口。这是[D5](#1-已确认的决策)把还款做成显式接口的直接后果，也是有意的分工：平台只保证接口原子、金额正确。
- **奖励与回购的敞口已经关闭**——授信订单以 `COMPLETED` 为终点，没有任何后置流程（[D8](#1-已确认的决策)）。代价是授信订单的用户拿不到奖励，即使日后还清欠款也不补发。这是有意为之：补发需要在还款时回溯触发链上发奖，会把还款路径和发奖耦合起来，复杂度远超收益。
- 供应商结算日报的**口径**是对的（按现金流入确认，见[§7](#7-报表与供应商结算口径)），但代码不是零改动：取数要加一条还款聚合查询和未偿还指标，邮件模板要加展示。

---

## 11. 实施步骤

已拆成 6 个 GitHub issue（父 issue #1，子 issue #2–#7）。**顺序是刻意的：把授信支付通道放在最后**——在它上线前系统里不存在任何授信订单，所以前面每一步都是零副作用的（下游切断的判断不命中、还款接口找不到账户、报表的还款聚合查不到数据），任何时刻合并任何一步都不会打开资金敞口，不需要 feature flag。最后一步合并即开闸。

| issue | 内容 | 依赖 |
| --- | --- | --- |
| #2 | 消费顺序 订阅 → 付费 → 免费 | 无 |
| #3 | 授信账户：数据模型、原语、权限位、开额度与查询接口 | 无 |
| #4 | 切断授信订单的所有下游流程 | 无 |
| #5 | 还款接口与退款 | #3 |
| #6 | 供应商结算报表口径 | #3 |
| #7 | 授信支付通道（开闸） | #3、#4、#5 |

**#2 —— 消费顺序（与授信无关，已实现待测）**

1. `consumeCredit` 把免费／订阅／付费三个桶重构成一个有序列表，顺序改为订阅 → 付费 → 免费（[D10](#1-已确认的决策)）；`refundCredit` 的遍历改成 `orderBy: { id: "desc" }`，保证退款按消费的逆序发生。

抽桶遍历成共用私有方法时，把「是否允许动免费桶」和「写哪种流水类型」做成参数——[§4](#4-还款) 的还款要复用它（订阅 → 付费，跳过免费，写 `repay_credit_line`）。这一步在 #2 里做好，后面就不用再碰 `consumeCredit`。

原来的实现里「付费」不是一个真实的桶，而是免费和订阅都扣完之后**剩下多少扣多少**的兜底分支，所以它天然只能排最后。把它挪到中间就必须先算出付费余额：

```
付费余额 = current_credit_balance
         − 账面上还挂着的全部免费积分
         − 账面上还挂着的全部订阅积分
```

两个减项要用**不带过期过滤**的合计，而可以消费的清单仍然只取未过期的。原因是已过期、但还没被 `expireFreeCredit` / `expireWidgetSubscriptionCredit` 扫掉的那部分，依然计在 `current_credit_balance` 里，可它不是付费的钱——用带过期过滤的合计去减，会把这部分误算进付费余额，导致付费桶多扣。这个区别在原实现里不存在（付费是兜底分支，不需要知道自己有多少），是这次重构新引入的，务必写对。

> ⚠️ **不要用把 `expire_date` 置为 NULL 的方式实现「订阅积分无过期」。** `consumeCredit` 取可消费清单用的是 `expire_date: { gte: now }`，SQL 里 `NULL >= now` 为 NULL 即不成立，这些积分会被直接排除，变成永远花不出去、却一直计在 `current_credit_balance` 里的幽灵余额。要「无过期」就发一个足够远的日期。免费积分那条查询是同样的写法，同样适用。

**#3～#7 —— 授信**

2. **Schema** —— `prisma/schema.prisma` 加 `user_credit_lines`、`credit_line_statements` 两张表和相关枚举，执行[§2](#2-数据模型)的 DDL，重新生成 client。
3. **`src/payment/credit-line/credit-line.service.ts`** —— 账户原语：`getLine`、`setLimit`、`available`、`charge`、`repay`、`refund`。全部接收 `Prisma.TransactionClient`，让调用方持有行锁。
   本期**不实现 `setStatus`**：没有管理端接口，`frozen` 只会由手工改库产生，读路径认它就够了，写路径等管理端一起做。
   每一个改动 `used` 的原语（`charge` / `repay` / `refund`）都必须同时写一条 `credit_line_statements` 并落 `used_after`，不能只改 `used`。
   `repay(tx, user, widgetTag, amount, requestId)` 对资金来源不做假设，本期由还款接口调用；将来做还款日／月账单时，主动还款单、自动扣款都直接复用它，见[§13](#13-扩展性面向月账单还款日利息逾期)。
4. **权限** —— `WIDGET_PERMISSIONS_LIST` 加新项；把 `WidgetCaslAbilityFactory` 注入用得到的 service（确认 `payment.module.ts` 引入了 casl 模块，留意循环依赖）。
5. **`PaymentMethod.CREDIT_LINE`** —— 加枚举值，并**加进 `OrderService.defaultPaymentMethod` 白名单**，否则 widget 声明了也会被静默过滤，见[§3](#支付方式白名单)。
6. **`OrderService.payCreditLineOrder` + 路由** —— [§3](#3-授信支付)。
7. **`releaseRewards`** —— 在方法内部、与现有前置校验并列的位置加上 `paid_method === CREDIT_LINE` 直接返回（[D8](#1-已确认的决策)）。一处覆盖全部 9 个触发点。
8. **`view_ip_incomes` 视图 + `createBuyBackOrders`** —— [§7](#其他会读订单金额的统计) 的两处排除。视图要同时改 `prisma/views/uss_db/view_ip_incomes.sql` 和线上视图。
9. **`refundOrder`** —— `switch (paid_method)` 里加 `case CREDIT_LINE`，落到新的 `_refundCreditLineOrder`，镜像 `_refundCreditOrder` 的订单行锁与状态流转；前置校验（状态、10 天窗口、部分退款额度）复用现有的，见[§5](#5-退款)。
10. **还款接口** —— `POST /api/v1/credit-line/repay`，两种鉴权入口，见[§4](#4-还款)。`issueCredit` **不动**。
11. **接口与 DTO** —— [§8](#8-接口) 的新增项。`getProfile`、`/credit/balance`、`/credit/issue-credit` 都不动，管理端接口本期不做。
12. **报表** —— [§7](#7-报表与供应商结算口径)：现有查询不动，只在 `getCreditStatictics` 里加还款聚合查询和未偿还指标，在 `formatCreditStatsForTemplate` 里加展示。
13. **环境变量** —— `CREDIT_LINE_WIDGET_GRANT_MAX`，默认 1000000，不配也能跑，说明见[§6](#6-widget-权限)。

## 12. 测试

扩充 `src/payment/credit/credit.service.spec.ts`，并新建 `credit-line.service.spec.ts`：

- 消费顺序：订阅先于付费，付费先于免费；授信不参与 `consumeCredit`
- 有授信额度但订单走普通积分支付时，`used` 不动
- 授信可用额度不足 → 支付失败，**不会**退化成部分授信 + 部分积分
- 订单 `widget_tag` 与授信账户不匹配 → 拒绝（含无 `widget_tag` 的订单）
- widget 权限被回收后，已有额度不能再消费
- `frozen` 状态禁止新消费但不影响还款
- **充值不触发任何抵消**：在任何 widget 充值（含 `/credit/issue-credit` 直充），`used` 都纹丝不动
- 还款只能用订阅 + 付费余额，免费积分一分不动；只有免费余额时还款返回 `repaid: 0`
- 已过期但未清扫的免费积分不被算进可还余额
- 还款扣减走桶：订阅先于付费，且 `widget_subscription_credit_issues.current_balance` 同步减少
- 还款金额被 `min(请求金额, 欠款, 可还余额)` 夹住；不传 `amount` 时按能还多少还多少
- 传了 `request_id` 重复提交：第二次抛错，不产生第二次扣款
- 不传 `request_id`：服务端生成，流水上仍有值；两次调用会真的还两次
- 不同用户用同一个 `request_id`：互不影响，都能正常还款
- 用户 JWT 和 widget JWT 两条入口，还的都是同一个 `(用户, widget)` 账户
- widget 只能发起还自己 widget 的欠款，`widget_tag` 不接受请求体指定
- widget 代用户发起还款可以成功（widget 是可信开发者，见 D5）
- 授信订单退款 → `used` 减少，真实余额不动
- 授信订单的部分退款：多次退款逐次递减 `used`，订单状态按 `PARTIAL_REFUNDED` → `REFUNDED` 推进
- 授信订单超过 10 天不可退，与积分订单一致
- 还款在积分侧跨两个桶写两条流水，在授信侧只写一条汇总
- 欠款已还清后再退款 → `used` 为负，`available > credit_limit`，且可继续消费
- 额度被降到低于当前欠款 → `available` 为 0 而不是负数，授信支付被拒，但**还款和退款仍然正常**
- 查询接口：账户不存在 / 用户不存在 / 账户 `frozen` 三种情况下 `available` 都是 0，且不抛 404
- 查询接口：widget A 查不到 widget B 授予的额度
- 授信订单没有后置流程：支付完成后不发奖；widget 直接调 `/order/release-rewards` 也不发；`releaseAllOrders` 重试扫描同样跳过；状态停在 `completed` 不会变成 `rewards_released`
- 绑奖励池／带回购／充值类订单一律拒绝授信支付
- 授信订单不出现在 `view_ip_incomes` 里，也不被 `createBuyBackOrders` 捞起
- **`/credit/statement` 里不出现任何授信消费或授信退款记录**；还款则必须出现（`repay_credit_line`），金额与积分余额的减少一致
- 授信消费和退款都出现在 `/credit-line/statement` 里
- 每一笔 `used` 变动都有对应的 `credit_line_statements` 行，且 `used` 等于末笔的 `used_after`
- 日报付费口径只把还款计一次，没有双计
- 开额度接口用请求体的 `email` 定位用户，不会误开到 widget 作者头上
- 用户自己的 JWT、widget session token、widget 代付（`user_jwt`）三条入口，扣的都是 `(order.owner, order.widget_tag)` 那一个账户
- 任何路径都不产生 `paid_method` 与流水不一致的订单

## 13. 扩展性（面向月账单／还款日／利息／逾期）

本期不做这四件事，但设计要保证它们将来是加法而不是重写。

### 已经天然支持的

- **月账单** —— 授信账户已经是 `(用户, widget)` 维度，正好是账单该有的维度，而且[D11](#1-已确认的决策)给了它一本独立账本。新增一张 `credit_line_billing_cycles`（账户 id、周期起止、账单日、到期日、期初欠款、本期新增、本期已还、期末欠款、最低还款额、状态），再给 `credit_line_statements` 加个周期外键即可。账单金额需要冻结，快照存在周期表里。
- **计息基数** —— 日计息要知道「第 X 天欠了多少」。`credit_line_statements` 每行都带 `used_after` 和时间戳，`used(t)` 直接查得到，连回放都不用算。
- **逾期** —— `credit_line_status` 加 `overdue` / `suspended`，加 `overdue_since` 列。`user_credit_lines` 是小表，改它没有代价；而且「非 active 即禁止消费」的判断已经存在，逾期自动挡住新消费。
- **利率** —— 加在 `user_credit_lines` 上，或以后单独做产品／等级表。同样是加法。
- **溢缴款** —— `used` 允许为负这一条已经把「预存／多还」的语义提前打通了，做还款日时不用回头改符号约定。

### 必须从第一版就守住的两条约束

**约束 1：`repay()` 对资金来源不做假设。**
[D5](#1-已确认的决策) 把还款做成了显式的一等公民接口，这条约束大半已经落实了。要守住的是别让 `repay()` 内部写死「钱一定来自积分余额」：将来有还款日之后，用户很可能直接用钱包／Stripe 付一笔还款单，而不是先充成积分再还。届时加一种订单类型、支付完成后调同一个原语即可，`repay()` 本身不用改。

**约束 2：利息必须是独立的流水类型，不能混进 `repay`。**
利息也是欠款、也会被还款冲抵。[§7](#7-报表与供应商结算口径)是按 `credit_line_statements` 里 `type = 'repay'` 的合计来确认付费消耗的；如果还利息的那部分也记成 `repay`，**平台收的利息会被当成消耗结算给供应商**。将来加利息时，计息记 `interest`、还利息记 `repay_interest`，报表只认 `repay`。今天没有利息，这条不改变任何行为，成本为零。

## 14. 上线 DDL 清单

生产的 DDL 攒到全部功能完成后**一次性执行**，所以这里是唯一的汇总清单。本地已全部执行并验证过。

按顺序执行，两组之间没有依赖：

```sql
-- 来自 #3。两张新表不指定 charset，继承库默认，
-- 这样 widget_tag 与 orders.widget_tag 同 collation，§7 的报表 join 不会有隐式转换。
CREATE TABLE user_credit_lines (
  id           INT          NOT NULL AUTO_INCREMENT,
  `user`       VARCHAR(32)  NOT NULL,
  widget_tag   VARCHAR(32)  NOT NULL,
  credit_limit INT          NOT NULL DEFAULT 0,
  used         INT          NOT NULL DEFAULT 0,
  status       ENUM('active','frozen') NOT NULL DEFAULT 'active',
  note         VARCHAR(1024) NULL,
  operator     VARCHAR(32)  NULL,
  created_at   TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP(0) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY user_widget (`user`, widget_tag)
);

CREATE TABLE credit_line_statements (
  id         INT          NOT NULL AUTO_INCREMENT,
  `user`     VARCHAR(32)  NOT NULL,
  widget_tag VARCHAR(32)  NOT NULL,
  type       ENUM('consume','repay','refund') NOT NULL,
  amount     INT          NOT NULL,
  used_after INT          NOT NULL,
  order_id   VARCHAR(64)  NULL,
  request_id VARCHAR(64)  NULL,
  created_at TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_widget (`user`, widget_tag),
  KEY idx_widget_created (widget_tag, created_at)
);

-- 来自 #3。枚举值必须追加在末尾：末尾追加是元数据变更，
-- 插在中间会重建整张 credit_statements。跑之前可以先带
-- , ALGORITHM=INPLACE, LOCK=NONE 试一次，能过就说明不重建也不锁写。
ALTER TABLE credit_statements
  MODIFY COLUMN type ENUM(
    'issue_free_credit','expire_free_credit',
    'issue_subscription_credit','expire_subscription_credit',
    'top_up','consume','refund','repay_credit_line'
  ) NULL;

-- 来自 #4。与线上现有定义的差异只有 COALESCE 那一行。
-- 用 COALESCE 而不是直接 a.paid_method <> 'credit-line'：后者在 NULL 时结果是 NULL，
-- 会把所有没有支付方式的历史订单一起排除掉，那是个静默的收入缩水。
CREATE OR REPLACE VIEW view_ip_incomes AS
WITH t1 AS (
  SELECT (sum(a.amount) / 100) AS amount,
         b.ip_id AS ip_id,
         cast(a.paid_time AS date) AS date
  FROM orders a
  LEFT JOIN app_bind_ips b ON a.app_id = b.app_id
  WHERE a.current_status IN ('rewards_released','completed')
    AND COALESCE(a.paid_method, '') <> 'credit-line'
    AND a.app_id IS NOT NULL
    AND b.ip_id IS NOT NULL
  GROUP BY b.ip_id, date
)
SELECT md5(concat(t1.ip_id, t1.date)) AS id, t1.amount AS amount, t1.ip_id AS ip_id, t1.date AS date
FROM t1;
```

校验：

```sql
SELECT 'tables' AS item, count(*) AS val FROM information_schema.tables
 WHERE table_schema = DATABASE() AND table_name IN ('user_credit_lines','credit_line_statements')
UNION ALL
SELECT 'enum_ok', column_type LIKE '%repay\_credit\_line%' FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'credit_statements' AND column_name = 'type'
UNION ALL
SELECT 'view_ok', view_definition LIKE '%credit-line%' FROM information_schema.views
 WHERE table_schema = DATABASE() AND table_name = 'view_ip_incomes';
```

三行都应为 `2 / 1 / 1`。

回滚：`DROP` 两张新表、枚举列表去掉最后一个值、视图用不带 `COALESCE` 那行的旧定义 `CREATE OR REPLACE` 回去。只要没有行用到 `repay_credit_line` 就无损。

**除此之外没有别的 DDL。** `PaymentMethod.CREDIT_LINE` 是普通 TS 枚举，`CREDIT_LINE_WIDGET_GRANT_MAX` 有默认值可以不配。

---

## 不在本期范围

月账单、还款日、利息、逾期费用、自动降额、跨 widget 共享额度、混合支付、授信订单的奖励释放延迟、管理端的额度查询与调整接口。website / admin 上展示额度与欠款的界面属于另一个仓库的独立工作。
