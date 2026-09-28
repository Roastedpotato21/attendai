import { definePlugin } from "nitro";

import { runCommunicationSchedule } from "../../src/lib/server/communication-scheduler.ts";

export default definePlugin((nitro) => {
  nitro.hooks.hook("cloudflare:scheduled", async () => {
    await runCommunicationSchedule((request) => Promise.resolve(nitro.fetch(request)));
  });
});
