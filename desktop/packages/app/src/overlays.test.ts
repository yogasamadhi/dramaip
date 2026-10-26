import { expect, test } from "vitest";
import { Dialog, Drawer } from "@dramaip/ui-shared";

test("弹窗与抽屉不共享可变的组件对象，不能互相覆盖 Content", () => {
  expect(Dialog).not.toBe(Drawer);
  expect(Dialog.Content).not.toBe(Drawer.Content);
  // Stateless primitives may be reused without replacing either composition.
  expect(Dialog.Title).toBe(Drawer.Title);
  expect(Dialog.Close).toBe(Drawer.Close);
});
