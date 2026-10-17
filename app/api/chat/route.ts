const MAX_PROMPT_LENGTH = 4000;
const DEFAULT_IMAGE_RESULT_COUNT = 3;
const MAX_IMAGE_RESULT_COUNT = 10;
const MAX_HISTORY_MESSAGES = 20;
const MAX_RESPONSE_WORDS = 120;
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "llama3.2:latest";

export const maxDuration = 180;

type CommonsImage = {
  thumbnailUrl: string;
  sourceUrl: string;
  title: string;
  artist: string;
  license: string;
  width: number;
  height: number;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getMetadataValue(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  const entry = metadata[key];
  return isRecord(entry) && typeof entry.value === "string" ? entry.value : undefined;
}

function stripMarkup(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function limitResponseLength(response: string) {
  const words = response
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gi, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\bwww\.\S+/gi, "")
    .replace(/[ \t]+([,.;!?])/g, "$1")
    .trim()
    .split(/\s+/);

  if (words.length <= MAX_RESPONSE_WORDS) return words.join(" ");
  return `${words.slice(0, MAX_RESPONSE_WORDS - 1).join(" ")}…`;
}

function removeImageAccessDisclaimer(response: string) {
  return response
    .split(/(?<=[.!?])\s+/)
    .filter(
      (sentence) =>
        !(
          /\b(?:can't|cannot|unable|not capable|not able)\b/i.test(sentence) &&
          /\b(?:images?|pictures?|photos?|photographs?|illustrations?|visuals?)\b/i.test(sentence)
        ),
    )
    .join(" ")
    .trim();
}

function getImageSearchRequest(prompt: string) {
  const imageSearchTerms =
    /(?:images?|pictures?|photos?|photographs?|illustrations?|visuals?)/i;
  const asksForImages =
    imageSearchTerms.test(prompt) &&
    (/\b(?:show|find|look|want|need|see|get|give|display|view|fetch|pull up|would like|can you|could you)\b/i.test(prompt) ||
      /\bsearch\s+(?:for\s+)?(?:some\s+)?(?:images?|pictures?|photos?|photographs?|illustrations?|visuals?)\b|\bsearch\b.{0,40}\bfor\s+(?:some\s+)?(?:images?|pictures?|photos?|photographs?|illustrations?|visuals?)\b/i.test(prompt) ||
    /^\s*(?:some\s+)?(?:images?|pictures?|photos?|photographs?|illustrations?|visuals?)\b/i.test(prompt) ||
    /\b(?:images?|pictures?|photos?|photographs?|illustrations?|visuals?)\s*(?:please)?[.!?]*\s*$/i.test(prompt));

  if (!asksForImages) return undefined;

  const subject =
    prompt.match(
      /\b(?:images?|pictures?|photos?|photographs?|illustrations?|visuals?)\s+(?:of|for|about|related to|showing|depicting)\s+(.+)/i,
    )?.[1] ?? prompt;

  const query = subject
    .replace(
      /^\s*(?:(?:please|can you|could you|would you|show me|find me|search(?:\s+for)?|look for|give me|display|fetch|pull up|i want|i need|i would like|i'd like)\s+)+/i,
      "",
    )
    .replace(/^\s*(?:a|an|the|some)\s+/i, "")
    .replace(/\b(?:images?|pictures?|photos?|photographs?|illustrations?|visuals?)\b/gi, " ")
    .replace(/^\s*(?:of|for|about|showing|depicting)\b/i, "")
    .replace(/\b(?:please|thanks|thank you)\s*$/i, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

  if (!query) return undefined;

  const numberWords: Record<string, number> = {
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const requestedCountMatch = prompt.match(
    /\b(\d{1,2}|four|five|six|seven|eight|nine|ten)\s+(?:more\s+)?(?:images?|pictures?|photos?|photographs?|illustrations?|visuals?)\b/i,
  );
  const requestedCount = requestedCountMatch
    ? Number(requestedCountMatch[1]) || numberWords[requestedCountMatch[1].toLowerCase()]
    : undefined;
  const asksForMore =
    /\b(?:more|as many as possible|up to ten|up to 10)\b/i.test(prompt);
  const asksForMoreThan = /\bmore than\b/i.test(prompt);

  return {
    query,
    count: Math.min(
      MAX_IMAGE_RESULT_COUNT,
      asksForMoreThan
        ? MAX_IMAGE_RESULT_COUNT
        : requestedCount ?? (asksForMore ? MAX_IMAGE_RESULT_COUNT : DEFAULT_IMAGE_RESULT_COUNT),
    ),
  };
}

async function searchCommonsImages(query: string, count: number): Promise<CommonsImage[]> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: String(Math.min(100, count * 4)),
    prop: "imageinfo",
    iiprop: "url|extmetadata|mime",
    iiurlwidth: "480",
    format: "json",
    formatversion: "2",
  }).toString();

  const response = await fetch(url, {
    headers: { "user-agent": "ArcWorkflowCanvas/1.0 (Wikimedia Commons image search)" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Wikimedia Commons returned HTTP ${response.status}.`);
  }

  const result: unknown = await response.json();
  const queryResult = isRecord(result) && isRecord(result.query) ? result.query : undefined;
  const pages = queryResult && Array.isArray(queryResult.pages) ? queryResult.pages : [];

  const seenTitles = new Set<string>();
  return pages.flatMap((page): CommonsImage[] => {
    if (!isRecord(page) || typeof page.title !== "string" || !Array.isArray(page.imageinfo)) {
      return [];
    }

    const info = page.imageinfo[0];
    if (
      !isRecord(info) ||
      typeof info.thumburl !== "string" ||
      typeof info.descriptionurl !== "string" ||
      typeof info.mime !== "string" ||
      !info.mime.startsWith("image/")
    ) {
      return [];
    }

    let thumbnailUrl: URL;
    let sourceUrl: URL;
    try {
      thumbnailUrl = new URL(info.thumburl);
      sourceUrl = new URL(info.descriptionurl);
    } catch {
      return [];
    }
    if (
      thumbnailUrl.protocol !== "https:" ||
      !["thumb.wikimedia.org", "upload.wikimedia.org"].includes(thumbnailUrl.hostname) ||
      sourceUrl.protocol !== "https:" ||
      sourceUrl.hostname !== "commons.wikimedia.org"
    ) {
      return [];
    }

    const metadata = isRecord(info.extmetadata) ? info.extmetadata : {};
    const title = page.title.replace(/^File:/, "").replace(/_/g, " ");
    if (seenTitles.has(title)) return [];
    seenTitles.add(title);

    return [{
      thumbnailUrl: thumbnailUrl.toString(),
      sourceUrl: sourceUrl.toString(),
      title,
      artist: stripMarkup(getMetadataValue(metadata, "Artist") ?? "Unknown author"),
      license: getMetadataValue(metadata, "LicenseShortName") ?? "See source",
      width: typeof info.thumbwidth === "number" ? info.thumbwidth : 480,
      height: typeof info.thumbheight === "number" ? info.thumbheight : 320,
    }];
  }).slice(0, count);
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("prompt" in body) ||
    typeof body.prompt !== "string"
  ) {
    return Response.json({ error: "A prompt is required." }, { status: 400 });
  }

  const prompt = body.prompt.trim();
  if (!prompt) {
    return Response.json({ error: "Enter a message before sending." }, { status: 400 });
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return Response.json(
      { error: `Keep messages under ${MAX_PROMPT_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const rawHistory =
    "history" in body && Array.isArray(body.history) ? body.history : [];
  if ("history" in body && !Array.isArray(body.history)) {
    return Response.json({ error: "Chat history must be a list of messages." }, { status: 400 });
  }
  const history: ChatMessage[] = [];
  for (const entry of rawHistory.slice(-MAX_HISTORY_MESSAGES)) {
    if (
      !isRecord(entry) ||
      (entry.role !== "user" && entry.role !== "assistant") ||
      typeof entry.content !== "string"
    ) {
      return Response.json({ error: "Chat history contains an invalid message." }, { status: 400 });
    }
    const content = entry.content.trim();
    if (!content || content.length > MAX_PROMPT_LENGTH) {
      return Response.json({ error: "Chat history contains an empty or oversized message." }, { status: 400 });
    }
    history.push({ role: entry.role, content });
  }

  try {
    const imageSearch = getImageSearchRequest(prompt);
    const baseUrl = process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL;
    const model = process.env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
    const chatUrl = new URL("/api/chat", `${baseUrl.replace(/\/+$/, "")}/`);
    const generationStartedAt = performance.now();
    const modelPrompt = imageSearch
      ? `${prompt}\n\nThe app is searching Wikimedia Commons for "${imageSearch.query}" and will show up to ${imageSearch.count} matching pictures below. Do not invent image names, descriptions, citations, or URLs. Mention briefly that matching pictures are below.`
      : prompt;
    const ollamaResponse = await fetch(chatUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: `You are Arc, a helpful assistant. Use prior conversation messages when answering follow-up questions. Answer naturally and clearly in at most a few concise paragraphs, up to ${MAX_RESPONSE_WORDS} words. Avoid unnecessary caveats. The application searches Wikimedia Commons for requested pictures and shows matching images below your answer. Never invent image names, sources, or URLs. For ordinary descriptive questions, answer directly without mentioning image search or claiming you cannot access images.`,
          },
          ...history,
          { role: "user", content: modelPrompt },
        ],
        stream: false,
        options: { temperature: 0.2, num_predict: 320 },
      }),
      signal: AbortSignal.timeout(170_000),
    });

    if (!ollamaResponse.ok) {
      let ollamaError = "";
      try {
        const errorResult: unknown = await ollamaResponse.json();
        if (isRecord(errorResult) && typeof errorResult.error === "string") {
          ollamaError = errorResult.error;
        }
      } catch {
        // Keep the user-facing error useful even if Ollama returns a non-JSON error body.
      }

      console.error(`Ollama returned HTTP ${ollamaResponse.status}.`);
      if (
        ollamaResponse.status === 404 ||
        /model .* not found/i.test(ollamaError)
      ) {
        return Response.json(
          {
            error: `The local model "${model}" is not available. Run "ollama pull ${model}" and try again.`,
          },
          { status: 503 },
        );
      }
      return Response.json(
        { error: `Ollama returned HTTP ${ollamaResponse.status}. Check the local Ollama service and try again.` },
        { status: 502 },
      );
    }

    const generation: unknown = await ollamaResponse.json();
    const generatedText =
      isRecord(generation) &&
      isRecord(generation.message) &&
      typeof generation.message.content === "string"
        ? generation.message.content.trim()
        : "";
    const generationTimeMs = Math.round(performance.now() - generationStartedAt);
    if (!generatedText) {
      console.error("Ollama returned an empty or invalid generation response.");
      return Response.json(
        { error: "The local model returned an empty response. Please try again." },
        { status: 502 },
      );
    }
    const responseWithoutImageDisclaimer = imageSearch
      ? removeImageAccessDisclaimer(generatedText)
      : generatedText;
    const text =
      limitResponseLength(responseWithoutImageDisclaimer) ||
      (imageSearch ? "Here are the pictures you requested." : "");
    if (!text) {
      console.error("Ollama response contained no displayable text.");
      return Response.json(
        { error: "The local model returned an empty response. Please try again." },
        { status: 502 },
      );
    }

    let images: CommonsImage[] = [];
    let imageError: string | undefined;
    if (imageSearch) {
      try {
        images = await searchCommonsImages(imageSearch.query, imageSearch.count);
        if (images.length === 0) {
          imageError = "No matching images were found. Try a more specific request.";
        }
      } catch (error) {
        console.error(
          "Wikimedia Commons image search failed.",
          error instanceof Error ? error.message : "Unknown error",
        );
        imageError = "Images could not be loaded right now. Please try again.";
      }
    }

    return Response.json({ text, images, imageError, generationTimeMs });
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "TimeoutError";
    console.error("Local Ollama request failed.", error instanceof Error ? error.name : "Unknown error");
    return Response.json(
      {
        error: isTimeout
          ? "The local model took too long to respond. Try again or use a smaller model."
          : "Could not reach Ollama. Make sure Ollama is running on this computer, then try again.",
      },
      { status: 502 },
    );
  }
}
