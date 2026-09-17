import { createServerFn } from "@tanstack/react-start";
export const testFn = createServerFn({ method: "GET" }).handler(async () => {
  return "hello from server";
});
