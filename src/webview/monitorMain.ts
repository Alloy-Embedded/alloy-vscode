// Monitor webview entry point — separate from monitor.ts so the render helpers
// can be imported by tests without starting the DOM wiring.

import { main } from "./monitor";

main();
