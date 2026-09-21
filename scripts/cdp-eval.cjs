#!/usr/bin/env node
/** Small mounted-verification helper: evaluate one expression in a CDP page. */
const port = process.argv[2];
const urlNeedle = process.argv[3];
const expression = process.argv[4];
if (!port || !urlNeedle || !expression) {
  console.error('usage: cdp-eval.cjs <port> <url-substring> <expression>');
  process.exit(2);
}
(async () => {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(item => item.type === 'page' && item.url.includes(urlNeedle));
  if (!target) throw new Error(`No CDP page contains ${urlNeedle}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const id = 1;
  socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  const message = await new Promise((resolve, reject) => {
    socket.onmessage = event => {
      const value = JSON.parse(event.data);
      if (value.id === id) resolve(value);
    };
    socket.onerror = reject;
  });
  socket.close();
  if (message.error || message.result?.exceptionDetails) throw new Error(JSON.stringify(message.error ?? message.result.exceptionDetails));
  console.log(JSON.stringify(message.result?.result?.value));
})().catch(error => { console.error(error); process.exit(1); });
