// Drives the running dev app's webview over the Chrome DevTools Protocol (see "Debugging the running app" in AGENTS.md).
// pnpm cdp eval "<expression>"   evaluates in the page; `window.__app` is { svc, processes } from ServicesProvider
// pnpm cdp shot <file.png>       saves a screenshot of the window
import { writeFileSync } from "node:fs";
import * as z from "@zod/mini";

const [command, arg] = process.argv.slice(2);
const PORT = process.env.CDP_PORT ?? "9222";

// Finds the ServicesProvider value by walking React fibers from #root, waiting up to 10 s for the first render.
const FIND_APP = `(async () => {
  for (let attempt = 0; attempt < 50 && !window.__app; attempt++) {
    const root = document.getElementById("root");
    const key = Object.keys(root).find((k) => k.startsWith("__reactContainer$"));
    const stack = [root[key]];
    while (stack.length && !window.__app) {
      const fiber = stack.pop();
      if (!fiber) continue;
      if (fiber.memoizedProps?.value?.svc?.scheduler) window.__app = fiber.memoizedProps.value;
      stack.push(fiber.child, fiber.sibling);
    }
    if (!window.__app) await new Promise((resolve) => setTimeout(resolve, 200));
  }
})()`;

const Targets = z.array(z.looseObject({ type: z.string(), url: z.string(), webSocketDebuggerUrl: z.string() }));
const Reply = z.looseObject({ id: z.optional(z.number()), result: z.optional(z.unknown()) });
const Evaluated = z.looseObject({
  result: z.looseObject({ value: z.optional(z.unknown()) }),
  exceptionDetails: z.optional(z.unknown()),
});
const Screenshot = z.looseObject({ data: z.string() });

const targets = Targets.parse(await (await fetch(`http://127.0.0.1:${PORT}/json`)).json());
const page = targets.find((t) => t.type === "page" && t.url.includes("localhost:1420"));
if (!page) throw new Error(`No dev app page on port ${PORT}. Start it with the debug port (see AGENTS.md).`);

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
let nextId = 0;
function send(method: string, params: object): Promise<unknown> {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      const message = Reply.parse(JSON.parse(String(event.data)));
      if (message.id !== id) return;
      socket.removeEventListener("message", onMessage);
      resolve(message.result);
    };
    socket.addEventListener("message", onMessage);
  });
}
const evaluate = async (expression: string) =>
  Evaluated.parse(await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }));

if (command === "eval" && arg) {
  await evaluate(FIND_APP);
  const { result, exceptionDetails } = await evaluate(arg);
  console.log(JSON.stringify(exceptionDetails ?? result.value, null, 1));
} else if (command === "shot" && arg) {
  const { data } = Screenshot.parse(await send("Page.captureScreenshot", { format: "png" }));
  writeFileSync(arg, Buffer.from(data, "base64"));
  console.log(arg);
} else {
  console.log('Usage: pnpm cdp eval "<expression>" | pnpm cdp shot <file.png>');
}
socket.close();
