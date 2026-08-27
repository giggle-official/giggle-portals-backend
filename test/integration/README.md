# 集成测试

跑在**真实 MySQL** 上的测试。存在的理由很具体：`src/**/*.spec.ts` 那套单元测试把 Prisma 整个 mock 掉了，而 mock 掉的存取往返验证不了任何东西——「`0.037` 存进去又拿出来还是 `0.037`」在数据库是个 `jest.fn()` 的时候是同义反复。

精度、并发、事务边界这三类问题只能在这里测。

## 怎么跑

```bash
npm run test:integration
```

需要 `.env` 里有可用的 `DATABASE_URL`。**没有数据库时整个目录会被跳过，而不是变红**——否则第一个没有本地库的人会以为分支坏了。

调试用：

```bash
ITEST_VERBOSE=1 npm run test:integration   # 打开 Nest 的错误日志
```

Nest 在依赖注入失败时会直接退出进程，原因走的正是默认被静音的那个 logger，所以启动失败时先加这个开关。

## 黄金基线（`__golden__/`）

`money-api.itest.ts` 把每个返回金额的接口的响应存成基线文件，用来证明**改动前后逐字节一致**。

积分小数化那批改动（issue #16）的第一步承诺是「对外零变化」，这个目录就是那句承诺的机械证明。

### 重新录制

```bash
ITEST_RECORD=1 npm run test:integration
```

⚠️ **只在未改动的检出上录制。** 在改过的代码上录制，等于把它本该抓住的那个变化直接烤进基线里。

正常流程是：改动**之前**录制并提交基线 → 改动 → 重放比对。

### 比对时忽略什么

`helpers/snapshot.ts` 里的 `VOLATILE` 列出每次运行都会变的字段（id、时间戳、邮箱等）。它们被替换成**标注类型的占位符**而不是直接删掉——这样 `created_at` 从字符串变成数字仍然会被发现，尽管它的值本来就不比较。

金额字段永远不在这个列表里。`100` / `100.0` / `"100"` 的区别正是这套基线要盯的东西。

`snapshot-guard.itest.ts` 反过来测比对器本身：确认它真的能发现类型变化、数值变化、字段增减。**一个永远不会失败的基线不是基线。**

## 写新用例要知道的

- 所有夹具用 `zz_itest_` 前缀，`cleanupFixtures()` 按前缀清理。`beforeAll` 和 `afterAll` 都要清——上一次跑到一半被杀掉会留下数据，静默继承它是测试开始因为错误的原因通过的方式
- 需要真并发时用 `withRivalConnection()`。对同一个 client 调两次 `$transaction` **不会**并发，它们共用一条连接、会静默串行，把并发测试变成永远通过的顺序测试
- 服务从 `helpers/app` 导入，不要直接从 `src/...` 导入。`order.dto` 和 `order.service` 之间有 import 环，只有经 `AppModule` 进入才解得开；直接引服务模块会从另一端进环，报 `Cannot read properties of undefined (reading 'WALLET')`
- 断言刚写入的行且涉及时间窗口时，先调 `waitPastFixtureClock()`。`TIMESTAMP(0)` 列上 MySQL 对小数秒是**四舍五入**不是截断，一行可能带着最多 0.5 秒后的时间戳落库，于是刚写完就查不到
