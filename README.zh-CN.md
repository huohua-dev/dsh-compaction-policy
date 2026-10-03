# dsh-compaction-policy

[English](<README.md>) · [开发与宿主测试](<CONTRIBUTING.md>) · [安全说明](<SECURITY.md>)

**DeepSeek Harness 的实验性全局压缩策略。** 保留官方 Basic 摘要、checkpoint 记录、工具配对、token meter、UI 事件协议、原生 `/compact` 和溢出恢复；只调整主动压缩预算、范围与无进展重试，**不必切换特殊预设**。

**实验性 v0.2.0。** 精确兼容 DSH Basic/compaction **`0.2.0-rc.2`**、Cordis **`4.0.4`**，并校验五个 Basic 方法的哈希。真实宿主组件上的合成会话、脚本化模型响应测试已通过，**不代表已验证实际 GUI 行为，也不证明原生 Windows／真实模型会话的摘要质量**。不宣称无损摘要或扩大模型窗口。

## 安装会改变什么

默认 bundle 安装两个**根插件**：

```yaml
- id: compaction-policy-global
  name: dsh-compaction-policy/global
  config: {}
- id: compaction-policy-legacy
  name: dsh-compaction-policy/legacy
  config: {}
```

- **全局策略：**作用于**同一 Cordis runtime** 内符合条件的现有及未来官方 Basic 实例，包括普通预设。不新增压缩引擎或自动压缩监听器，也不切换预设。
- **旧会话兼容：**保留历史 `compaction-policy` 预设身份，让 v0.1 会话仍可恢复，但使用原生 Basic。正常情况下该行不出现在选择列表中；新版默认 bundle **不新增可见、可选的特殊预设**。
- **当前默认 provider 和预设保持不变。** 不改主请求输出上限、思考档位、provider/model 选择或 token 计量。

只接管精确钉住的官方 Basic 实现；跳过自定义 backend、子类及带有实例方法覆盖的引擎。没有 compaction 的预设（包括不带压缩的 minimal 组合）不受影响。“全局”不表示机器上所有 DSH 进程或 profile。

## 默认策略：90%，不重复扣余量

模型允许较大输出时，原生 Basic 可能很早触发：

```text
原生触发点 = floor(min(W × 0.8, W − 主请求输出上限 − 65536))

主动预留 = min(主请求输出上限, outputReserveCap)
策略触发点 = floor(min(W × thresholdRatio, W − 主动预留 − headroomTokens))
近期保留目标 = floor((W − 主动预留) × retainRatio)
```

默认 **`thresholdRatio: 0.9`、`outputReserveCap: 0`、`headroomTokens: 0`**，主动触发点就是 **`floor(W × 0.9)`**。剩余 10% 已是安全余量，**不会再扣一次**。262,144-token 窗口、131,072-token 输出上限对应的触发点从 65,536 变为 **235,929 token**。这是算术结果，不是性能实测。

**`pruneToolResults: false` 仅约束新策略的主动 pressure 路径。** 该路径不先剪工具结果，旧内容交给 Basic 摘要；它不会禁用原生 pruner 服务，也不改变 stock 模式、手动或已确认溢出的行为。

> **输出上限不等于可用空间保证。** 256K 窗口装入 90% 的输入后，不可能同时容纳完整 128K 输出。适配器／服务端仍须处理实际剩余容量；严格校验 `input + max_tokens` 的服务可能更早拒绝，届时仍走原生溢出恢复。本插件不是 HTTP 输出预算裁剪器。

### 范围与失败保护

- 近期保留为 **16% 的软目标**。完整消息和工具调用／结果单元保持原子性；最新单元始终原样保留，过大时允许超过目标。
- 可以将较早的大消息纳入摘要，避免反复只压它前面的短 checkpoint。system 节点受保护；历史中途出现的 system 节点是范围屏障。
- 所选范围至少包含 **2,048 token 的非旧检查点内容**，才发起主动摘要。
- 每个 pressure 步骤最多**一次摘要事务**，不立即再次压缩刚生成的 checkpoint。
- 失败后按 **60 秒、120 秒、240 秒……最多 10 分钟**退避。到期只允许下一次压力检查探测一次，不会后台调用模型。候选内容实质变化可提前重试；追加无关尾部不会清除退避。
- 保留原生手动及已确认溢出路径的重试上限、事务结束和实际进展校验；它们绕过主动策略的失败保护。

## 安装

通过 GitHub 分发，尚未发布 npm 包。安装 **v0.2.0 发布标签**：

```text
github:huohua-dev/dsh-compaction-policy#v0.2.0
```

### Desktop 管理的 profile

**必须通过 Desktop 插件管理器 UI** 添加上述 GitHub 来源，按提示重新加载／重启现有 Desktop 宿主。CLI 会拒绝修改 Desktop 管理的插件；不要用 `--profile desktop` 绕过。

加载后继续使用现有普通预设，不需要选择特殊预设。在会话中运行 `/compaction-policy-global status` 查看覆盖情况和实际策略。安装不会替你更换默认 provider 或预设。

### 仅限非 Electron 管理的 web profile

如果 web profile **不由 Electron／Desktop 管理**，才使用：

```sh
dsh plugin --profile web add github:huohua-dev/dsh-compaction-policy#v0.2.0
```

然后重新加载／重启该现有宿主。这个 CLI 示例不是 Desktop 的替代安装方式。

## 配置全局条目

在用户 profile 覆盖中修改 **`compaction-policy-global`**，策略字段放在 **`config.policy`** 下。row config 是整项替换，不是深合并；需要保留的自定义值必须重述。修改后重新加载 profile。

例如：其余路由保持原生，仅在一个精确路由启用新策略：

```yaml
- id: compaction-policy-global
  config:
    policy:
      mode: stock
      modelPolicies:
        - provider: your-local-provider
          model: your-model-id
          mode: policy
          thresholdRatio: 0.9
          outputReserveCap: 0
          headroomTokens: 0
          pruneToolResults: false
```

provider/model 精确匹配、区分大小写。不使用这类按路由启用的配置时，默认策略作用于所有符合条件的 Basic 实例。

| 策略字段 | 默认值 | 说明 |
|---|---:|---|
| `mode` | `policy` | `policy` 使用新主动策略；`stock` 委托 Basic。 |
| `thresholdRatio` | `0.9` | 主动触发窗口比例，仍受剩余容量分支约束。 |
| `outputReserveCap` | `0` | 主动输出预留封顶，**不是** API 输出上限。 |
| `headroomTokens` | `0` | 额外主动扣减；默认 10% 余量已包含在比例中。 |
| `pruneToolResults` | `false` | 新主动路径是否先调用原生工具结果剪枝器。 |
| `retainRatio` | `0.16` | `(W − 主动预留)` 的近期尾部软目标比例。 |
| `retainTokens` | 不设 | 绝对软目标，与 `retainRatio` 互斥。 |
| `minFreshTokens` | `2048` | 所选非旧检查点内容的最低 token 权重。 |
| `retryAfterTokens` | `4096` | 冷却到期前允许重试所需的候选变化量。 |
| `retryCooldownMs` | `60000` | 首次失败冷却时间。 |
| `maxRetryCooldownMs` | `600000` | 指数退避上限，不能小于首次冷却。 |
| `modelPolicies` | `[]` | 精确 `{ provider, model, ...policyFields }` 覆盖。 |
| `dryRun` | `false` | 新主动路径只观测、不剪枝或摘要；stock、手动和溢出路径仍正常运行。 |

除 `modelPolicies`、`dryRun` 外的策略字段均可按路由覆盖。未知键或非法值被拒绝；主动预算无效时给出诊断，不虚构更大的模型窗口。

### 主输出与摘要配置仍然独立

全局条目**没有 `basic` 字段**，`config.policy` 下也没有。每个引擎保留其**原有 Basic 配置**：摘要 provider/model、摘要输出预算、思考行为、自动启用状态，以及 stock／手动／溢出设置。需要修改时，请在该引擎已有的 Basic 行上配置，不要放进全局插件。

使用上游默认值时，**65,536-token 摘要上限保持不变**。策略 headroom 为 `0` 不会把摘要上限改成零。主请求输出上限、思考配置同样不变。Basic 的 `auto: false` 仍按原生语义关闭自动 pressure 和 overflow 监听，手动 `/compact` 保留。

## 状态与恢复

```text
/compaction-policy-global [status|reset]
/compact
```

`status` 提供覆盖情况与主动策略诊断，不输出会话原文。`reset` 只清理当前会话的主动失败保护，不压缩、不重写历史、不改模型。手动压缩仍使用原生 `/compact`。有缩减但仍超阈值时报告 `compacted-still-above-threshold`，不会谎报已回到预算内。失败状态按 live session 保存在内存，重启后不保留。

卸载运行中的全局策略时，先将其标记为**不活跃**，再等待正在执行的工作完成，安全恢复原方法。不覆盖其他插件的 wrapper：若其他插件已包装被修改的方法，本插件的 wrapper 会**保持惰性，直到可安全恢复或重启**。禁用不会强制重新绑定运行中的 agent。

## 从 v0.1 升级与旧会话兼容

1. 删除旧的**用户自建覆盖 `id: compaction-policy-preset`**，并检查仍引用旧入口的自定义路由和组合。安装包**不会偷偷修改用户 profile**。
2. 通过对应的插件管理器加载新版默认 bundle。新聊天选择**已有普通预设**；如果以前把旧预设设成默认，请显式修改默认项。
3. 还需要恢复 v0.1 日志时，保持 `compaction-policy-legacy` 启用。

兼容插件注册**完全相同的历史 `compaction-policy` id**，基于宿主随包 standard 构建，并使用**原生 Basic**，不是高级策略 backend。经过版本固定、限定作用域、可撤销的选择列表过滤器只隐藏该兼容行，不删除已注册预设。如果当前默认项就是旧 id，或该兼容条目本身损坏，则保留该行，**不会悄悄隐藏当前默认项或加载失败诊断**。旧会话标题仍可能显示历史 `compaction-policy` 身份，这不代表新增了可选预设。

会话身份、日志和子 agent 保持原样，不重写、不自动迁移。已经运行中的 v0.1 策略实例，需要**自然恢复或重启**才会获得旧身份对应的原生 Basic 组合；不会强制重绑运行中的 agent。

旧的独立 **`dsh-compaction-policy/preset` 导出与根 `dsh-compaction-policy` backend 仍是高级旧版入口**，不是默认安装方式。自主管理的组合仍必须保证 compaction 隔离组内只有一个 backend；全局插件不是替代 backend。Headless 使用**全局入口**需要宿主的 **`commands` 和 `agentPresets` 服务**；缺少这些服务的无预设注册表组合不能原样加载它。

## 禁用或卸载

- 只停用新全局策略、保留旧会话兼容：**仅禁用 `compaction-policy-global`**，保留 `compaction-policy-legacy`；或设置 `config.policy.mode: stock`，并移除仍启用 policy 模式的路由覆盖。
- 完全卸载前，结束／停止相关任务，新会话选择已有普通预设；若默认仍指向旧 id，请显式修正。删除自己添加的插件覆盖和自定义预设引用。
- **Desktop：**使用 Desktop 插件管理器 UI 移除 bundle，然后重新加载／重启现有宿主。
- **仅非 Electron 管理的 web：**执行 `dsh plugin --profile web remove dsh-compaction-policy`，然后重新加载／重启该宿主。

已经提交的原生 checkpoint 卸载后仍可读。**v0.1 旧日志若按原预设身份恢复运行，仍需安装旧会话兼容插件**。没有自动日志迁移、身份重写，也不会把全部压缩前历史重新塞回活动上下文。

## 限制与验证

摘要质量和服务端容量仍取决于模型／上游。计量采用宿主估算；插件不篡改 token 计数，不降低主请求思考，不新增压缩服务，不包装全局 `fetch`，不补丁修改 ASAR，也不另带 DSH 内核。宿主插件拥有宿主权限，**模型工具审批不会沙箱化插件代码**。

版本和五方法哈希固定是安全门槛，不代表向前兼容承诺。升级宿主需要重新审查和测试，不能只放宽版本范围。真实宿主合成测试不能证明实际 UI 或原生 Windows 摘要质量。

```sh
npm test
npm run check
npm run pack:check
```

合成真实宿主测试见[开发与宿主测试说明](<CONTRIBUTING.md>)；这些检查不等于真实模型验收。

## 许可与参考

MIT © 2026 huohua-dev。上游契约及相关工作见 [NOTICE](<NOTICE.md>)。不内置第三方插件实现或 DSH 内核。
