import { warmUserCache } from "./cache/userCache";
import { handleBatchRequest } from "./controller/userController";

warmUserCache();

const lines = handleBatchRequest(
  ["u-100", "u-101", "u-102", "u-404"],
  { requestId: "demo-run-001", includeArchived: false }
);

for (const line of lines) {
  console.log(line);
}
