# AI Provider 配置速查

MistVault 第一版 AI 讲解使用 OpenAI-compatible Chat Completions 接口。

设置页中需要填写：

- 启用 AI 配置：勾选
- Provider：选择服务商
- Base URL：填写 provider 的 API base，不需要手动加 `/chat/completions`
- Model：填写 provider 官方模型 ID，不能填简称
- API Key：填写对应 provider 控制台创建的 API Key

MistVault 会自动在 Base URL 后拼接 `/chat/completions`。如果误填完整 endpoint，例如 `https://api.deepseek.com/chat/completions`，当前实现也会兼容，不会重复拼接。

## 常用配置

| Provider | Base URL | Model 示例 | 说明 |
|---|---|---|---|
| DeepSeek | `https://api.deepseek.com` | `deepseek-v4-flash` 或 `deepseek-v4-pro` | 不要填 `v4pro` 这类简称。`deepseek-chat` / `deepseek-reasoner` 是旧兼容名，官方标注会废弃。 |
| Qwen / 阿里千问 | `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | `{WorkspaceId}` 换成百炼业务空间 ID。旧域名 `https://dashscope.aliyuncs.com/compatible-mode/v1` 可能仍可用，但官方建议使用业务空间域名。 |
| Kimi / Moonshot | `https://api.moonshot.cn/v1` | `kimi-k2.6` | 使用 Moonshot / Kimi 开放平台的 API Key。 |
| OpenAI | `https://api.openai.com/v1` | 以账号可用模型为准，例如 `gpt-5.4-mini`、`gpt-5.5` | 必须选择账号可用且支持 Chat Completions 的模型。 |
| Doubao / 火山方舟 | `https://ark.cn-beijing.volces.com/api/v3` | 通常填写推理接入点 ID，例如 `ep-...` | 火山方舟常见不是填写“豆包模型营销名”，而是填写控制台创建或开通后的 Endpoint ID。 |
| Claude | 不适用 | 不适用 | MistVault 第一版暂不支持，会返回 unsupported。 |
| Gemini | 不适用 | 不适用 | MistVault 第一版暂不支持，会返回 unsupported。 |

## DeepSeek 示例

如果你要使用 DeepSeek v4 pro，按下面填写：

```text
Provider: DeepSeek
Base URL: https://api.deepseek.com
Model: deepseek-v4-pro
API Key: 你的 DeepSeek API Key
```

如果只是先测试通路，可以优先用：

```text
deepseek-v4-flash
```

## 常见错误

### AI provider 返回异常，请稍后再试

常见原因：

- Model 填了简称，例如 `v4pro`，应改为 `deepseek-v4-pro`
- Base URL 填错或多了无关路径
- API Key 无权限调用所填模型
- provider 账户余额不足、模型未开通或区域不匹配
- provider 返回了非标准响应结构

### AI API Key 未配置

设置页的 API Key 输入框留空表示保留原 key。如果之前没有配置过 key，需要输入新 key 后保存。

### 该 provider 第一版暂未支持

当前选择了 Claude 或 Gemini。第一版先只支持 OpenAI-compatible provider，Claude / Gemini 后续再做独立 adapter。

## 安全边界

MistVault 第一版 AI 请求只发送当前错题的文本上下文：

- question
- keywords
- answerAnalysis
- note
- nodePath
- 附件 metadata：文件名、类型、所属字段、大小

不会发送：

- API Key 给 renderer
- 附件原文件
- 附件内容
- 本地绝对路径
- attachment relativePath
- data directory
- 整个错题库
- 其他无关错题

## 参考

- DeepSeek API Docs: https://api-docs.deepseek.com/
- 阿里云百炼 OpenAI 兼容文档: https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope
- Kimi API 文档: https://platform.moonshot.cn/docs/guide/start-using-kimi-api
- OpenAI Chat Completions API: https://platform.openai.com/docs/api-reference/chat/create
