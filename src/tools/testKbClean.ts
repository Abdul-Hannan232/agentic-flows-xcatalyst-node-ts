import { retrieve } from "./kb";

async function test() {
  try {
    console.log("Running kb.retrieve test against actual KB folder...");
    const result = await retrieve({ query: "pricing", top_k: 5 });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("kb.retrieve test failed:", err);
  }
}

test();
