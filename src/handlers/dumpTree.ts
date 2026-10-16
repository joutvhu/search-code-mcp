import { DumpTreeParams } from "../types.js";
import { runAstGrepDump } from "../engines/astgrep.js";

export async function handleDumpTree(params: DumpTreeParams) {
  const output = await runAstGrepDump(params);
  return {
    content: [{ type: "text", text: output }],
  };
}
