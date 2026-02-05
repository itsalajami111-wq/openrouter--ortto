const DEFAULT_MODEL = "openai/gpt-4o-mini";
const COUNTRY_CODE_FIELD = "str:cm:country-of-residence-code";
const PROMPT_FIELD = "str:cm:prompt";
const COUNTRY_NAME_FIELD = "str:cm:country-of-residence";

function parseBody(req) {
  if (!req.body) {
    return null;
  }
  if (!req.body) return null;

  if (typeof req.body === "object") {
  let text = "";
  if (typeof req.body === "string") {
    text = req.body;
  } else if (Buffer.isBuffer(req.body)) {
    text = req.body.toString("utf8");
  } else {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return null;
  try {
    return JSON.parse(text);
  } catch {}

  try {
    const params = new URLSearchParams(text);
    const obj = {};
    for (const [k, v] of params.entries()) obj[k] = v;
    return obj;
  } catch {}

  return null;
}

function getFieldValue(payload, key) {
  if (!payload) return null;
  if (payload[key]) return payload[key];
  if (Array.isArray(payload.fields)) {
    for (const field of payload.fields) {
      if (field.field === key || field.key === key) return field.value;
    }
  }

  return null;
}

function extractFields(payload) {
  if (!payload || typeof payload !== "object") {
    return { countryCode: null, prompt: null };
async function generateCountryName(countryCode, prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  return {
    countryCode: payload[COUNTRY_CODE_FIELD] ?? null,
    prompt: payload[PROMPT_FIELD] ?? null,
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const requestBody = {
    model,
    messages: [
      {
        role: "system",
        content:
          prompt ||
          "You receive a country code. Return only the final country name.",
      },
      {
        role: "user",
        content: `Country code: ${countryCode}`,
      },
    ],
  };

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OpenRouter request failed (${response.status}): ${errorText}`,
    );
  }

  const data = await response.json();
  const output = data?.choices?.[0]?.message?.content?.trim();
  if (!output) {
    throw new Error("OpenRouter returned no content");
  }

  return output;
}

module.exports = async function handler(req, res) {
  console.log("Ortto webhook received", {
    method: req.method,
    contentType: req.headers["content-type"],
  });

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const payload = parseBody(req);
  const { countryCode, prompt } = extractFields(payload);
  console.log("Ortto payload keys", Object.keys(payload || {}));

  if (!countryCode || !prompt) {
    return res.status(400).json({
      error: "Missing required fields",
      required: [COUNTRY_CODE_FIELD, PROMPT_FIELD],
    });
  const contactId = getFieldValue(payload, "contact_id");
  const countryCode =
    getFieldValue(payload, "country_of_residence_code") ||
    getFieldValue(payload, COUNTRY_CODE_FIELD);
  const prompt = getFieldValue(payload, "prompt");

  if (!countryCode) {
    return res.status(400).json({ error: "Missing country code" });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OPENROUTER_API_KEY is not configured" });
  console.log("Calling OpenRouter", {
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
  });

  let countryName;
  try {
    countryName = await generateCountryName(countryCode, prompt);
  } catch (error) {
    console.error("OpenRouter generation failed:", error);
    return res.status(500).json({ error: "OpenRouter failure" });
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const requestBody = {
    model,
    messages: [
      {
        role: "system",
        content:
          "You receive a country code and a prompt. Use the prompt instructions and interpret the country code as needed. Return only the final country name.",
      },
  const orttoApiKey = process.env.ORTTO_API_KEY;
  if (!orttoApiKey) {
    console.error("Ortto update skipped (missing ORTTO_API_KEY).");
    return res.status(500).json({ error: "Missing ORTTO API key" });
  }

  const mergeUrl = "https://api.eu.ap3api.com/v1/person/merge";
  const mergeBody = {
    people: [
      {
        role: "user",
        content: `Prompt: ${prompt}\nCountry code: ${countryCode}`,
        person_id: contactId,
        fields: {
          [COUNTRY_NAME_FIELD]: countryName,
        },
      },
    ],
  };

  let orttoResult;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    const resp = await fetch(mergeUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Api-Key": orttoApiKey,
      },
      body: JSON.stringify(requestBody),
      body: JSON.stringify(mergeBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(502).json({
        error: "OpenRouter request failed",
        status: response.status,
        details: errorText,
      });
    const text = await resp.text();
    if (!resp.ok) {
      console.error("Ortto merge failed", resp.status, text);
      orttoResult = { ok: false, status: resp.status, body: text };
    } else {
      console.log("Ortto merge success", text);
      orttoResult = { ok: true, status: resp.status, body: text };
    }

    const data = await response.json();
    const output = data?.choices?.[0]?.message?.content?.trim();

    if (!output) {
      return res.status(502).json({ error: "OpenRouter returned no content" });
    }

    return res.status(200).json({
      [COUNTRY_NAME_FIELD]: output,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Unexpected error calling OpenRouter",
      details: error instanceof Error ? error.message : String(error),
    });
    console.error("Ortto merge exception", error);
    orttoResult = { ok: false, exception: String(error) };
  }

  return res.status(200).json({
    contact_id: contactId,
    country_of_residence: countryName,
    ortto_update: orttoResult,
  });
};
