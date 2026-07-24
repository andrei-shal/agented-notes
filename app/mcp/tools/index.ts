export { type McpTool, tools } from "./registry";

// Side-effect imports — each tool module pushes its tools into the
// `tools` array from `registry.ts`.  There are no circular dependencies
// because no tool module imports from `./index` anymore.
import "./todos";
import "./search";
import "./analytics";
import "./events";

// notes.ts exports noteTools but doesn't self-register
import { noteTools } from "./notes";
import { tools } from "./registry";
tools.push(...noteTools);

// comments.ts exports named tools but doesn't self-register
import { commentsGetPendingTool, commentsMarkProcessedTool, commentsDeleteTool } from "./comments";
tools.push(commentsGetPendingTool, commentsMarkProcessedTool, commentsDeleteTool);
