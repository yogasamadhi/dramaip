import { defineExtension } from "@dramaip/plugin-api";

export default defineExtension({
  async activate(context) {
    context.handle("sample.echo", async (payload) => ({ payload }));
    context.handle("sample.increment", async () => {
      const current = await context.capability<{ value: { value: number } } | null>(
        "storage.read",
        { collection: "counters", documentId: "main" },
      );
      const value = (current?.value.value ?? 0) + 1;
      await context.capability("storage.write", {
        collection: "counters",
        documentId: "main",
        value: { value },
      });
      return { value };
    });
    context.subscribe("sample.project-package", async (event) => {
      await context.capability("notification.show", {
        title: "项目包已提交",
        body: `隔离扩展收到领域事件 ${String((event as { type?: unknown }).type ?? "unknown")}`,
      });
      return null;
    });
    await context.effect("sample.activation", async () => () => undefined);
  },
});
