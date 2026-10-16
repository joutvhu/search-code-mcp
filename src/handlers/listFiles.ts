import { ListFilesParams } from "../types.js";
import { runRipgrepListFiles } from "../engines/ripgrep.js";

export async function handleListFiles(params: ListFilesParams) {
  const files = await runRipgrepListFiles(params);
  if (files.length === 0) {
    return {
      content: [{ type: "text", text: "No files found matching criteria." }],
    };
  }

  return {
    content: [
      {
        type: "text",
        text: `Found ${files.length} file(s):\n\n` + files.join("\n"),
      },
    ],
  };
}
