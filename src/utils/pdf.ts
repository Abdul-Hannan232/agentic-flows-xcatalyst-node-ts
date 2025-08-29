// // src/utils/pdf.ts
// import fs from "node:fs/promises";
// import { extract } from "unpdf";

// /**
//  * Extracts text from a PDF file.
//  * @param filePath Absolute or relative path to PDF file
//  * @returns Extracted plain text
//  */
// export async function extractText(filePath: string): Promise<string> {
//   try {
//     const data = await fs.readFile(filePath);
//     const { text } = await extract(data);

//     // Fallback: trim & normalize whitespace
//     return text.replace(/\s+/g, " ").trim();
//   } catch (err) {
//     console.error(`[pdf.extractText] Failed for ${filePath}:`, err);
//     return ""; // fail safe, agent can escalate
//   }
// }
