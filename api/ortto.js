const DEFAULT_MODEL = "openai/gpt-4o-mini";
const COUNTRY_CODE_FIELD = "str:cm:country-of-residence-code";
const PROMPT_FIELD = "str:cm:prompt";
const COUNTRY_NAME_FIELD = "str:cm:country-of-residence";

function parseBody(req) {
  if (!req.body) {
    return null;
  }

  if (typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return null;
    }
  }

  return null;
}

function extractFields(payload) {
  if (!payload || typeof payload !== "object") {
    return { countryCode: null, prompt: null };
  }

  return {
    countryCode: payload[COUNTRY_CODE_FIELD] ?? null,
    prompt: payload[PROMPT_FIELD] ?? null,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const payload = parseBody(req);
  const { countryCode, prompt } = extractFields(payload);

  if (!countryCode || !prompt) {
    return res.status(400).json({
      error: "Missing required fields",
      required: [COUNTRY_CODE_FIELD, PROMPT_FIELD],
    });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OPENROUTER_API_KEY is not configured" });
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
      {
        role: "user",
        content: `Prompt: ${prompt}\nCountry code: ${countryCode}`,
      },
    ],
  };

  try {
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
      return res.status(502).json({
        error: "OpenRouter request failed",
        status: response.status,
        details: errorText,
      });
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
  }
};
