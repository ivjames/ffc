// Mock CenterEdge API — process entrypoint.
// The Express app lives in app.js (importable without listen side effects),
// mirroring the ffc-server layout.
import { createApp } from "./app.js";

const port = process.env.PORT || 8070;
const app = createApp();
app.listen(port, () => {
  console.log(`[mock-centeredge] listening on port ${port}`);
  if (process.env.MOCK_API_KEY) {
    console.log(`[mock-centeredge] auth ON — requests need "Authorization: Bearer <MOCK_API_KEY>"`);
  } else {
    console.log(`[mock-centeredge] auth OFF — set MOCK_API_KEY to rehearse the auth flow`);
  }
});
