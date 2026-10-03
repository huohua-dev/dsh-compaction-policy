# dsh-compaction-policy

[English](README.md) · [开发与宿主测试](CONTRIBUTING.md) · [安全说明](SECURITY.md)

**一个很薄、主动选择启用的 DeepSeek Harness 压缩策略插件。** 保留官方模型摘要、checkpoint 事务、工具配对、token meter、`/compact` 与上下文溢出恢复；只调整主动压缩的预算、范围和无进展重试。

**实验性 v0.1.0，仅支持 DSH `0.2.0-rc.2`。** 已用真实宿主核心组件、合成内存会话和脚本化假模型测试；**尚未完成实际 GUI 安装会话及真实模型长任务验收**。不宣称无损压缩，不扩大模型窗口。

## 解决什么

官方 Basic 的主动触发点为：

```text
floor(min(窗口 × 0.8, 窗口 − 主请求最大输出 − 65536))
```

因此 262144 窗口、131072 输出上限，实际到 **65536（25%）** 就触发。另一个问题是巨大早期思考被整块保留后，只剩前面的小检查点可压；模型写出的摘要不比它短，下一工具步骤又重复请求。

本插件将“最大允许输出”与“何时压缩的预留量”分开：

```text
预留 = min(主请求输出上限, outputReserveCap)
触发点 = floor(min(窗口 × thresholdRatio, 窗口 − 预留 − headroomTokens))
近期保留目标 = floor((窗口 − 预留) × retainRatio)
```

默认 `outputReserveCap=20000`、`headroomTokens=13000`、`thresholdRatio=0.85`，上述模型对应 **222822 token（85%）**。这是计算结果，不是真实模型性能测试。

**不会改写主请求的 maxTokens、思考档位、provider、model 或 token 计量。** 默认也不关闭摘要思考，不换摘要模型。

> **预留不是容量保证。** 约22万输入之后，不可能再完整输出13万并同时塞进26万窗口。实际发送仍需要适配器/服务端根据剩余容量处理；严格校验 `input + max_tokens` 的服务可能更早报超窗，此时仍走官方恢复。本插件不是 HTTP 预算裁剪代理。

## 行为

- 策略本身不截断单条消息、思考块或工具结果；已有官方工具结果剪枝器仍按原规则工作，旧内容仍由官方模型生成语义摘要。
- 近期保留是**软目标**，不是硬下限：可向后扩大待压前缀，将老的大消息纳入，而不是只压它前面的短摘要。最新完整工具单元始终保留，过大时允许超过目标。
- 待压范围至少有2048个**非旧检查点**的token权重才请求摘要。
- 每个 pressure 步骤最多一次摘要事务，不立即重压自己刚生成的摘要。
- 失败后按60秒、120秒、240秒……退避，上限10分钟；到期也只在下一次压力检查时尝试一次。候选内容实质变化可以提前重试，单纯追加未选中的尾部不会清除退避。
- 手动 `/compact` 和服务端已确认的 context overflow **绕过主动退避**，继续使用官方安全边界、重试上限及实际进展校验。
- `/compaction-policy status` 查看真实阈值与跳过原因；`reset` 清当前会话退避。不往模型上下文塞额外状态提示。

没有额外模型服务、Python代理、全局fetch包装、ASAR补丁或另一套DSH内核。

## 安装并启用

目前仅通过 GitHub 分发，**尚未发布 npm 包**：

```sh
dsh plugin --profile desktop add github:huohua-dev/dsh-compaction-policy#v0.1.0
```

把 `desktop` 换成实际使用的profile，例如 `web`。初次安装后重新加载/重启**现有** DSH：

1. 新开一个会话。
2. 第一条消息前选择 **Compaction Policy (standard)** 预设。
3. 完成一次模型步骤后，运行 `/compaction-policy status` 验证实际策略。

**安装只新增一个可选预设，不修改默认预设、原standard、模型路由或已有会话。** 不要将“包安装成功”当作“当前会话已使用新引擎”。

预设在内存中读取**当前宿主随包的standard**，只替换compaction组里的backend，保留 `/compact` 和pruner；没有复制一整份会过时的工具列表。它不会继承用户另外编辑的standard工具表；这类需求请在自己的preset中挂backend。版本或结构不符合预期时明确报错。

## 只对指定模型启用

在当前profile的 `cordis.patch.yml` 中覆盖插件的预设条目：

```yaml
- id: compaction-policy-preset
  config:
    id: compaction-policy
    name: Compaction Policy (standard)
    policy:
      mode: stock
      modelPolicies:
        - provider: your-local-provider
          model: your-model-id
          mode: policy
          thresholdRatio: 0.85
          outputReserveCap: 20000
          headroomTokens: 13000
```

`provider` 和 `model` 精确匹配、区分大小写；其他路由委托官方Basic。原standard预设始终不变。DSH的row config是**整项替换**，不是深合并，要重述需要保留的值。修改后重新加载profile并新开测试会话；首版不承诺已有运行中preset实例热更新。

## 配置表

| 字段 | 默认 | 说明 |
|---|---:|---|
| `mode` | `policy` | `policy`新策略；`stock`主动压缩委托官方 |
| `thresholdRatio` | 0.85 | 窗口比例；仍受预留/余量分支限制 |
| `outputReserveCap` | 20000 | 主动压缩预留封顶，不是API输出上限 |
| `headroomTokens` | 13000 | 主动策略额外余量 |
| `retainRatio` | 0.16 | `(窗口−封顶预留)`的近期尾部软目标比例 |
| `retainTokens` | 不设 | 尾部绝对软目标，与retainRatio互斥 |
| `minFreshTokens` | 2048 | 可压范围里非旧检查点内容的最低权重 |
| `retryAfterTokens` | 4096 | 冷却未到期时允许重试所需的候选变化量 |
| `retryCooldownMs` | 60000 | 首次失败冷却 |
| `maxRetryCooldownMs` | 600000 | 指数退避上限，不能小于首次值 |
| `modelPolicies` | `[]` | 精确provider/model覆盖 |
| `dryRun` | false | 新主动策略只观测，不剪枝/摘要；**stock路由、手动、overflow仍正常运行** |
| `basic` | `{}` | 独立的官方Basic配置，负责摘要、手动/overflow及stock路由 |

除 `modelPolicies`、`basic`、`dryRun` 外的策略字段均可按路由覆盖。未知键或非法值拒绝；窗口太小需相应减小预留/余量/尾部目标，不能虚报窗口。无有效主动预算时报告 `invalid-pressure-budget`，不会关闭overflow恢复。

### 三种预算互相独立

1. 主输出上限：在现有模型配置里，插件不改。
2. 主动压缩预留：`policy.outputReserveCap`。
3. 摘要上限：`policy.basic.maxTokens`。

Basic默认摘要上限 **65536** 保持不变；策略headroom设13000不会偷偷把摘要上限降到13000。如果希望另设摘要模型和预算，可明确配置：

```yaml
    policy:
      basic:
        summarizationProvider: your-summary-provider
        summarizationModel: your-summary-model
        maxTokens: 16384
```

这只是显式配置示例，不是要求减少摘要预算。provider/model必须成对。`basic.compactionRetries`仍管stock行为，新主动路径固定每步一事务；`basic.maxOverflowRetries`仍管overflow。`basic.auto: false`依官方语义会同时关闭自动pressure和overflow监听，手动命令保留。

## 自定义预设和 headless

在**会话自己的compaction隔离组**内，用独立id的 `dsh-compaction-policy` 替代 `@deepseek-ai/dsh-compaction-basic`，保留 `command-compact` 和 `tool-result-pruner`。同一组只能有一个backend，不能叠装两个。完整片段见[英文说明](README.md#custom-presets--headless-compositions)。

顶层profile patch的同名id不会自动穿透另一个preset内部。无preset registry的headless应直接挂根backend，不挂需要web registry的 `/preset` 装配入口。

## 状态和回退

```text
/compaction-policy status
/compaction-policy reset
/compact
```

`reset`只清理当前会话失败退避，不修改模型或历史。压缩有进展但仍高于阈值会记录 `compacted-still-above-threshold`，不会谎报已经低于预算。日志只包含预算、计数、序号和原因，不保存原文。

卸载前：结束/停止使用本预设的任务；新会话切回standard；若手动设置了默认预设，先改回；删除自己添加的插件覆盖条目或自定义preset引用，再执行：

```sh
dsh plugin --profile desktop remove dsh-compaction-policy
```

重载现有host。插件没有另建数据仓库，已经产生的checkpoint是普通DSH事件，卸载后仍可读。但旧session仍记录原preset身份，恢复运行可能需要重装插件，或显式交接到standard新会话；卸载不会偷偷改session身份或恢复全部压缩前原文。

## 限制与安全

- 不是无损压缩；摘要质量仍由模型决定，大输入＋摘要输出预算也可能超窗。
- 计量来自宿主，未做精确tokenizer承诺；不篡改token meter。
- 出现在历史中途的system节点是硬屏障，主动范围不会跨过它；必要时手动处理，而不是偷偷压掉system。
- 退避按live Session对象保存在内存，重启后不保留；不会设后台计时器或主动唤醒模型。
- 新策略dry-run不关闭手动/overflow/stock行为；不是完全禁止修改历史的总开关。
- Host插件与DSH宿主同权限，**模型工具审批不会沙箱化插件代码**；安装前审源码、钉版本。
- 首版依赖rc.2可动态派发的Basic方法，并在其提交前同步计量点补检查取消；升级必须重新测试，不能只放宽版本范围。

## 验证与开发

```sh
npm test
npm run check
npm run pack:check
```

单测无需安装依赖；真实宿主测试另见[CONTRIBUTING.md](CONTRIBUTING.md)。它使用真实Cordis、Session、TokenMeter和Basic事务、脚本化假LLM，检查realm代理、标准预设、工具配对、溢出恢复以及摘要结束后12个microtask边界的取消。测试不启动服务、不读取真实会话、不发送网络推理。

MIT © 2026 huohua-dev。参考与边界见[NOTICE.md](NOTICE.md)。
