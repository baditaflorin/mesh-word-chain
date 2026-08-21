import { createMeshConfig } from "@baditaflorin/mesh-common";

export const config = createMeshConfig({
  appName: "mesh-word-chain",
  description: "A quick peer-to-peer word chain with shared turns and a round clock.",
  accentHex: "#7c3aed",
  version: __APP_VERSION__,
  commit: __GIT_COMMIT__,
});
