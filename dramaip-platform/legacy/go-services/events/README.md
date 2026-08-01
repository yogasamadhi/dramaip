# 版本化领域事件

`events/<领域>/vN` 是 RabbitMQ payload 的唯一契约来源。消息 body 使用
protobuf JSON 格式的 `events.envelope.v1.EventEnvelope`；AMQP `Type` 与 envelope
的 `event_type` 必须一致。

- 事件名必须带版本，例如 `payment.succeeded.v1`。
- 已发布的字段只允许增加新的可选字段；删除、重编号、改类型或改语义必须建立新的
  `vN` 目录和事件名。
- consumer 使用 `pkg/events.ParseEnvelope`，该入口会忽略未知字段，以便旧 consumer
  在收到兼容新增字段时继续处理已知字段。
- 新 producer 先增加 schema、示例和测试，再调用 `pkg/events` 的生成类型构造器；不得
  直接构造 `map[string]any` 作为 RabbitMQ payload。

运行 `bash scripts/check-event-contracts.sh` 会执行格式、lint、相对 `main` 的 breaking
检查、代码生成和生成物一致性检查。
