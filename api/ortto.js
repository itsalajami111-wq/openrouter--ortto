const DEFAULT_MODEL = "openai/gpt-4o-mini";
const COUNTRY_CODE_FIELD = "str:cm:country-of-residence-code";
const PROMPT_FIELD = "str:cm:prompt";
const COUNTRY_NAME_FIELD = "str:cm:country-of-residence";

function parseBody(req) {
  if (!req.body) {
    return null;
  }

  if (Buffer.isBuffer(req.body)) {
    const text = req.body.toString("utf8").trim();
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
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

function getFieldValue(payload, fieldName) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const direct = payload[fieldName];
  if (direct !== undefined && direct !== null) {
    return direct;
  }

  const nestedSources = [
    payload.fields,
    payload.data,
    payload.data?.fields,
    payload.attributes,
    payload.attributes?.fields,
  ];

  for (const source of nestedSources) {
    if (source && typeof source === "object" && fieldName in source) {
      return source[fieldName];
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
    countryCode: getFieldValue(payload, COUNTRY_CODE_FIELD),
    prompt: getFieldValue(payload, PROMPT_FIELD),
  };
}

module.exports = async function handler(req, res) {
  console.log("Ortto webhook received", {
    method: req.method,
    contentType: req.headers["content-type"],
    contentLength: req.headers["content-length"],
    userAgent: req.headers["user-agent"],
  });

  if (req.method === "GET" || req.method === "HEAD") {
    res.setHeader("Allow", "POST");
    console.log("Ortto connection test request received");
    if (req.method === "HEAD") {
      return res.status(200).end();
    }
    return res.status(200).json({ status: "ok" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const payload = parseBody(req);
  if (!payload) {
    console.warn("Ortto webhook missing or invalid JSON body", {
      bodyType: typeof req.body,
    });
  }

  if (payload && typeof payload === "object") {
    console.log("Ortto payload keys", Object.keys(payload));
  }

  const { countryCode, prompt } = extractFields(payload);
  const isEmptyTestRequest = !payload || (!countryCode && !prompt);
  if (isEmptyTestRequest) {
    console.log("Ortto test request detected (empty payload). Returning 200.");
    return res.status(200).json({ status: "ok" });
  }

  if (!countryCode || !prompt) {
    const missing = [];
    if (!countryCode) {
      missing.push(COUNTRY_CODE_FIELD);
    }
    if (!prompt) {
      missing.push(PROMPT_FIELD);
    }

    console.warn("Ortto webhook missing required fields", {
      missing,
      countryCodePresent: Boolean(countryCode),
      promptPresent: Boolean(prompt),
    });
    return res.status(400).json({
      error: "Missing required fields",
      required: [COUNTRY_CODE_FIELD, PROMPT_FIELD],
      missing,
    });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OPENROUTER_API_KEY is not configured" });
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  console.log("Calling OpenRouter", { model });
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
      console.error("OpenRouter request failed", {
        status: response.status,
        details: errorText,
      });
      return res.status(502).json({
        error: "OpenRouter request failed",
        status: response.status,
        details: errorText,
      });
    }

    const data = await response.json();
    const output = data?.choices?.[0]?.message?.content?.trim();

    if (!output) {
      console.error("OpenRouter returned empty content", { data });
      return res.status(502).json({ error: "OpenRouter returned no content" });
    }

    return res.status(200).json({
      [COUNTRY_NAME_FIELD]: output,
    });
  } catch (error) {
    console.error("Unexpected error calling OpenRouter", error);
    return res.status(500).json({
      error: "Unexpected error calling OpenRouter",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};
