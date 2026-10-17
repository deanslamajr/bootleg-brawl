import { GameApp } from "./app";
import { BootScene } from "./scenes/boot";

const app = new GameApp();
await app.init(document.getElementById("screen")!);
await app.setScene(new BootScene(app));

if (import.meta.hot) {
  // Dev: the content plugin re-packed; reload to pick up the new bundles.
  import.meta.hot.on("bootleg:content", () => location.reload());
}
