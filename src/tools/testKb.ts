// src/tools/testKb.ts
import { retrieve } from "./kb";

async function test() {
  try {
    const query = "pricing"; // pick a word that exists in your KB
    const result = await retrieve({ query, top_k: 5 });
    console.log("✅ kb.retrieve result:");
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("❌ kb.retrieve test failed:", err);
  }
}

test();
