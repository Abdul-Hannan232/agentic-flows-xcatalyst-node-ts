// test-openai.js
import { OpenAI } from "openai";

async function main() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Say hi in one short sentence." }
      ],
      temperature: 0
    });

    console.log("OK — API call succeeded.");
    console.log("Model reply:", resp.choices?.[0]?.message?.content ?? "<no content>");
  } catch (err) {
    // Print useful error details for debugging (do NOT share your API key)
    console.error("API call failed:");
    console.error("name:", err?.name);
    console.error("message:", err?.message);
    console.error("code:", err?.code || err?.error?.type);
    console.error("status:", err?.status);
    console.error("request_id:", err?.request_id || err?.requestId || "<none>");
    // Full error for local debugging
    console.error("full error:", err);
    process.exit(1);
  }
}

main();