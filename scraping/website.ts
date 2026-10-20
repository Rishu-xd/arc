import puppeteer from "puppeteer";
import type { ChatCompletionTool } from "groq-sdk/resources/chat/completions";
import { assertPublicWebHost, PublicWebsiteError } from "./network";
import type { ScrapedWebsiteResult } from "./types";

export const websiteScraperTool = {
  type: "function",
  function: {
    name: "scrape_website",
    description:
      "Use Puppeteer to inspect a public website and find current product or page information. Call this for requests to scrape a named website or URL, or to find a product on a specific site. Provide the website URL or domain and a concise search query.",
    parameters: {
      type: "object",
      properties: {
        website: {
          type: "string",
          description: "The target site's public URL or domain, such as https://shop.example.com.",
        },
        query: {
          type: "string",
          description: "The product name or topic to search for on that site.",
        },
      },
      required: ["website"],
      additionalProperties: false,
    },
  },
} satisfies ChatCompletionTool;

export class WebsiteScraperError extends Error {}

type PageExtraction = {
  title: string;
  price: string;
  description: string;
  imageUrl: string;
  pageUrl: string;
  hasProductEvidence: boolean;
};

function parseWebsiteUrl(value: string) {
  const candidate = value.trim();
  if (!candidate || candidate.length > 500) {
    throw new WebsiteScraperError("Provide a website URL or domain under 500 characters.");
  }

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
  } catch {
    throw new WebsiteScraperError("That website address is invalid.");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new WebsiteScraperError("Only public HTTP or HTTPS websites can be opened.");
  }
  url.hash = "";
  return url;
}

function isAllowedSiteHost(hostname: string, siteHost: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === siteHost || host.endsWith(`.${siteHost}`);
}

function isPublicImageUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      Boolean(url.hostname)
    );
  } catch {
    return false;
  }
}

async function extractPage(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>>,
  query: string,
) {
  return page.evaluate((searchQuery): PageExtraction => {
    const getMeta = (...selectors: string[]) => {
      for (const selector of selectors) {
        const content = document.querySelector<HTMLMetaElement>(selector)?.content?.trim();
        if (content) return content;
      }
      return "";
    };
    const getText = (element: Element | null | undefined) => {
      if (!element) return "";
      const text = element instanceof HTMLElement ? element.innerText : element.textContent;
      return text?.replace(/\s+/g, " ").trim() ?? "";
    };
    const getImageUrl = (image: HTMLImageElement | null | undefined) => {
      if (!image) return "";
      const source = [
        image.getAttribute("data-src"),
        image.getAttribute("data-lazy-src"),
        image.getAttribute("data-original"),
        image.getAttribute("src"),
        image.currentSrc,
      ].find((candidate) => {
        if (!candidate) return false;
        try {
          const url = new URL(candidate, location.href);
          return ["https:", "http:"].includes(url.protocol);
        } catch {
          return false;
        }
      });
      return source ? new URL(source, location.href).toString() : "";
    };
    const getReadableBodyText = () => {
      const body = document.body.cloneNode(true) as HTMLElement;
      body
        .querySelectorAll("script, style, noscript, svg, iframe, template, header, footer, nav, aside, form")
        .forEach((element) => element.remove());
      return getText(body);
    };
    const findPrice = (value: string) =>
      value.match(/(?:[$€£₹]\s?[\d,.]+|(?:USD|EUR|GBP|INR|CAD|AUD)\s?[\d,.]+|[\d,.]+\s?(?:USD|EUR|GBP|INR|CAD|AUD))/i)?.[0] ?? "";
    const collectProducts = (value: unknown): Record<string, unknown>[] => {
      if (Array.isArray(value)) return value.flatMap(collectProducts);
      if (typeof value !== "object" || value === null) return [];
      const record = value as Record<string, unknown>;
      const type = record["@type"];
      const isProductType = (entry: unknown) =>
        typeof entry === "string" &&
        entry.toLowerCase().split(/[\/#\s]/).at(-1) === "product";
      const isProduct =
        isProductType(type) || (Array.isArray(type) && type.some(isProductType));
      return [
        ...(isProduct ? [record] : []),
        ...Object.values(record).flatMap(collectProducts),
      ];
    };

    const structuredProduct = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    ).flatMap((script) => {
      try {
        return collectProducts(JSON.parse(script.textContent ?? ""));
      } catch {
        return [];
      }
    })[0];

    if (structuredProduct) {
      const offers = Array.isArray(structuredProduct.offers)
        ? structuredProduct.offers[0]
        : structuredProduct.offers;
      const offer = typeof offers === "object" && offers !== null
        ? offers as Record<string, unknown>
        : {};
      const priceValue = offer.price ?? offer.lowPrice;
      const price =
        typeof priceValue === "string" || typeof priceValue === "number"
          ? `${typeof offer.priceCurrency === "string" ? `${offer.priceCurrency} ` : ""}${priceValue}`
          : "";
      const images = Array.isArray(structuredProduct.image)
        ? structuredProduct.image
        : [structuredProduct.image];
      const imageEntry = images.find((entry) => typeof entry === "string" || typeof entry === "object");
      const image =
        typeof imageEntry === "string"
          ? imageEntry
          : typeof imageEntry === "object" && imageEntry !== null && "url" in imageEntry
            ? imageEntry.url
            : undefined;
      const canonicalUrl =
        typeof structuredProduct.url === "string"
          ? new URL(structuredProduct.url, location.href).toString()
          : location.href;

      return {
        title:
          typeof structuredProduct.name === "string"
            ? structuredProduct.name.trim()
            : getMeta('meta[property="og:title"]') || getText(document.querySelector("h1")) || document.title,
        price,
        description:
          typeof structuredProduct.description === "string"
            ? structuredProduct.description.replace(/\s+/g, " ").trim().slice(0, 320)
            : getMeta('meta[property="og:description"]', 'meta[name="description"]'),
        imageUrl: typeof image === "string" ? image : getMeta('meta[property="og:image"]'),
        pageUrl: canonicalUrl,
        hasProductEvidence: true,
      };
    }

    const headingLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("h1 a, h2 a, h3 a"));
    const productLink = headingLinks.find((anchor) => {
      const card =
        anchor.closest('[itemtype*="Product"], [data-testid*="product"], [class*="product" i], article, li') ??
        anchor.parentElement;
      return Boolean(card && findPrice(getText(card)));
    });
    const queryTerms = searchQuery.toLowerCase().split(/\s+/).filter((term) => term.length > 2);
    const priceElements = Array.from(document.querySelectorAll<HTMLElement>("span, div"))
      .filter((element) => {
        const text = getText(element);
        return !element.children.length && text.length <= 80 && Boolean(findPrice(text));
      })
      .slice(0, 60);
    const productCandidates = priceElements.flatMap((priceElement) => {
      let container: Element | null = priceElement;
      let fallbackCandidate:
        | {
            anchor: HTMLAnchorElement;
            container: Element;
            image: HTMLImageElement | undefined;
            title: string;
            price: string;
            text: string;
            imageUrl: string;
            score: number;
          }
        | undefined;
      for (let depth = 0; depth < 6 && container; depth += 1) {
        const text = getText(container);
        const anchor = Array.from(container.querySelectorAll<HTMLAnchorElement>("a[href]")).find(
          (candidate) =>
            (getText(candidate).length >= 4 ||
              Boolean(candidate.getAttribute("title")) ||
              Boolean(candidate.querySelector("img")?.getAttribute("alt"))) &&
            (() => {
              try {
                const url = new URL(candidate.href, location.href);
                return (
                  url.protocol === "https:" || url.protocol === "http:"
                ) && (
                  url.hostname === location.hostname ||
                  url.hostname.endsWith(`.${location.hostname}`)
                );
              } catch {
                return false;
              }
            })(),
        );
        if (anchor && text.length <= 1200) {
          const images = Array.from(container.querySelectorAll<HTMLImageElement>("img"));
          const image = images.find((candidate) => {
            return Boolean(getImageUrl(candidate)) && candidate.alt.trim().length > 5;
          }) ?? images.find((candidate) => Boolean(getImageUrl(candidate)));
          const title =
            anchor.getAttribute("title") ||
            image?.alt ||
            getText(anchor)
              .replace(findPrice(getText(anchor)), "")
              .replace(/\b\d+(?:\.\d+)?\s*[\d,]*\s*(?:ratings?|reviews?)\b.*$/i, "")
              .replace(/^[\d.]+\s*/, "")
              .trim() ||
            image?.getAttribute("alt") ||
            "";
          const price = findPrice(getText(priceElement));
          const matchingTerms = queryTerms.filter((term) =>
            title.toLowerCase().includes(term),
          ).length;
          const candidate = {
            anchor,
            container,
            image,
            title: title.trim(),
            price,
            text,
            imageUrl: getImageUrl(image),
            score:
              (image ? 4 : 0) +
              (title ? 4 : 0) +
              (price ? 3 : 0) +
              matchingTerms * 5 -
              Math.min(text.length, 1200) / 400,
          };
          if (image) return [candidate];
          fallbackCandidate = candidate;
        }
        container = container.parentElement;
      }
      return fallbackCandidate ? [fallbackCandidate] : [];
    });
    const bestProductCandidate = productCandidates.sort(
      (first, second) => second.score - first.score,
    )[0];
    const matchingImage = Array.from(document.querySelectorAll<HTMLImageElement>("img"))
      .flatMap((image) => {
        const imageUrl = getImageUrl(image);
        const alt = image.alt.trim();
        const altText = alt.toLowerCase();
        if (
          !imageUrl ||
          alt.length < 6 ||
          (queryTerms.length > 0 && !queryTerms.some((term) => altText.includes(term))) ||
          (queryTerms.some((term) => /^\d+$/.test(term)) &&
            !queryTerms
              .filter((term) => /^\d+$/.test(term))
              .some((term) => altText.includes(term)))
        ) {
          return [];
        }
        return [{
          image,
          imageUrl,
          score:
            queryTerms.filter((term) => altText.includes(term)).length +
            (bestProductCandidate?.title
              .toLowerCase()
              .split(/\s+/)
              .filter((term) => term.length > 2 && altText.includes(term)).length ?? 0),
        }];
      })
      .sort((first, second) => second.score - first.score)[0];
    const productCard =
      bestProductCandidate?.container ??
      productLink?.closest('[itemtype*="Product"], [data-testid*="product"], [class*="product" i], article, li') ??
      productLink?.parentElement;
    const title =
      bestProductCandidate?.image?.alt ||
      matchingImage?.image.alt ||
      bestProductCandidate?.title ||
      (productLink ? getText(productLink) : "") ||
      getText(document.querySelector("h1")) ||
      getMeta('meta[property="og:title"]') ||
      document.title;
    const cardText = getText(productCard);
    const priceElement = document.querySelector<HTMLElement>('[itemprop="price"]');
    const metaPriceAmount = getMeta(
      'meta[property="product:price:amount"]',
      'meta[name="price"]',
      'meta[itemprop="price"]',
    );
    const metaCurrency = getMeta('meta[property="product:price:currency"]', 'meta[itemprop="priceCurrency"]');
    const pagePrice =
      findPrice(priceElement?.getAttribute("content") ?? "") ||
      findPrice(getText(priceElement)) ||
      findPrice(getText(document.querySelector('[class*="price" i]'))) ||
      (metaPriceAmount ? `${metaCurrency ? `${metaCurrency} ` : ""}${metaPriceAmount}` : "");
    const price = bestProductCandidate?.price || findPrice(cardText) || pagePrice;
    const imageElement =
      bestProductCandidate?.image ??
      matchingImage?.image;
    const metaImage = getMeta('meta[property="og:image"]');
    const imageUrl =
      bestProductCandidate?.imageUrl || matchingImage?.imageUrl || getImageUrl(imageElement) || metaImage;
    const cardDescription = bestProductCandidate
      ? bestProductCandidate.text
          .replace(/^\s*\d+\.?\s*/, "")
          .replace(/^[\s\S]*?\b(?:ratings?|reviews?)\b/i, "")
          .replace(/&?\s*[\d,.]+\s*(?:ratings?|reviews?)\b/gi, " ")
          .replace(bestProductCandidate.title, "")
          .replace(bestProductCandidate.price, "")
          .replace(/\s+/g, " ")
          .replace(/^[\s&|.…,]+/, "")
          .trim()
      : "";
    const description =
      cardDescription ||
      (cardText && productLink ? cardText : "") ||
      getMeta('meta[property="og:description"]', 'meta[name="description"]') ||
      getText(document.querySelector("main")) ||
      getReadableBodyText();
    const pageUrl = bestProductCandidate?.anchor.href || productLink?.href || location.href;

    return {
      title: title.replace(/\s+/g, " ").trim().slice(0, 300),
      price,
      description: description.replace(/\s+/g, " ").trim().slice(0, 320),
      imageUrl,
      pageUrl,
      hasProductEvidence: Boolean(bestProductCandidate || productLink || (price && document.querySelector("h1"))),
    };
  }, query);
}

export async function scrapeWebsite(
  website: string,
  query: string,
  onProgress: (message: string) => void,
): Promise<ScrapedWebsiteResult> {
  const normalizedQuery = query.replace(/\s+/g, " ").trim();
  if (normalizedQuery.length > 200) {
    throw new WebsiteScraperError("The search query must be under 200 characters.");
  }

  const websiteUrl = parseWebsiteUrl(website);
  await assertPublicWebHost(websiteUrl).catch((error: unknown) => {
    if (error instanceof PublicWebsiteError) {
      throw new WebsiteScraperError(error.message);
    }
    throw error;
  });

  const siteHost = websiteUrl.hostname.toLowerCase().replace(/^www\./, "");
  const siteName = siteHost;
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;

  try {
    onProgress(`Opening ${siteName}`);
    browser = await puppeteer.launch({ headless: true, timeout: 30_000 });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(30_000);
    await page.setRequestInterception(true);
    const hostChecks = new Map<string, Promise<void>>();
    page.on("request", (request) => {
      const handleRequest = async () => {
        try {
          const requestUrl = new URL(request.url());
          if (
            !["http:", "https:"].includes(requestUrl.protocol) ||
            requestUrl.port ||
            requestUrl.username ||
            requestUrl.password ||
            !isAllowedSiteHost(requestUrl.hostname, siteHost)
          ) {
            await request.abort();
            return;
          }
          let hostCheck = hostChecks.get(requestUrl.hostname);
          if (!hostCheck) {
            hostCheck = assertPublicWebHost(requestUrl);
            hostChecks.set(requestUrl.hostname, hostCheck);
          }
          await hostCheck;
          await request.continue();
        } catch (error) {
          if (!(error instanceof PublicWebsiteError)) {
            console.error(
              "Could not enforce the website scraper request policy.",
              error instanceof Error ? error.message : "Unknown error",
            );
          }
          await request.abort().catch((abortError: unknown) => {
            console.error(
              "Could not block an unsafe website scraper request.",
              abortError instanceof Error ? abortError.message : "Unknown error",
            );
          });
        }
      };
      void handleRequest();
    });

    await page.goto(websiteUrl.toString(), { waitUntil: "domcontentloaded" });
    const currentUrl = new URL(page.url());
    if (!isAllowedSiteHost(currentUrl.hostname, siteHost)) {
      throw new WebsiteScraperError("The website redirected to an unsupported destination.");
    }

    onProgress(`Inspecting ${siteName} for matching information`);
    let extraction = await extractPage(page, normalizedQuery);
    if (normalizedQuery && (!extraction.hasProductEvidence || websiteUrl.pathname === "/")) {
      const searchSelector = await page.evaluate(() => {
        const candidates = Array.from(
          document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
            'input:not([type="hidden"]), textarea',
          ),
        ).filter((element) => {
          const style = window.getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
        });
        const score = (element: HTMLInputElement | HTMLTextAreaElement) => {
          const attributes = [
            element.type,
            element.name,
            element.id,
            element.placeholder,
            element.getAttribute("aria-label") ?? "",
          ].join(" ").toLowerCase();
          return (
            (element instanceof HTMLInputElement && element.type === "search" ? 10 : 0) +
            (/\b(search|query|keyword|find)\b/.test(attributes) ? 5 : 0)
          );
        };
        const input = candidates.sort((first, second) => score(second) - score(first))[0];
        if (!input || score(input) === 0) return "";
        input.setAttribute("data-arc-scraper-search", "true");
        return '[data-arc-scraper-search="true"]';
      });

      if (searchSelector) {
        onProgress(`Searching ${siteName}`);
        const searchInput = page.locator(searchSelector);
        await searchInput.fill(normalizedQuery);
        const navigation = page
          .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 12_000 })
          .catch(() => null);
        await page.keyboard.press("Enter");
        await navigation;
        extraction = await extractPage(page, normalizedQuery);
      }
    }

    const resultUrl = new URL(extraction.pageUrl, page.url());
    if (
      !isAllowedSiteHost(resultUrl.hostname, siteHost) ||
      !["http:", "https:"].includes(resultUrl.protocol) ||
      resultUrl.port ||
      resultUrl.username ||
      resultUrl.password
    ) {
      throw new WebsiteScraperError("The website returned a result link outside the requested site.");
    }

    let imageUrl: string | undefined;
    if (isPublicImageUrl(extraction.imageUrl)) {
      const candidateImageUrl = new URL(extraction.imageUrl);
      try {
        await assertPublicWebHost(candidateImageUrl);
        imageUrl = candidateImageUrl.toString();
      } catch (error) {
        if (!(error instanceof PublicWebsiteError)) throw error;
      }
    }

    const title = extraction.title.trim().slice(0, 300);
    if (!title) {
      throw new WebsiteScraperError(`No readable content was found on ${siteName}.`);
    }

    return {
      siteName,
      title,
      price: extraction.price.trim().slice(0, 100) || undefined,
      description:
        extraction.description.trim().slice(0, 320) ||
        `Open the ${siteName} page for more information.`,
      imageUrl,
      pageUrl: resultUrl.toString(),
    };
  } catch (error) {
    if (error instanceof WebsiteScraperError) throw error;
    if (error instanceof PublicWebsiteError) {
      throw new WebsiteScraperError(error.message);
    }
    if (
      error instanceof Error &&
      (error.message.includes("Could not find Chrome") ||
        error.message.includes("Could not find expected browser"))
    ) {
      throw new WebsiteScraperError(
        "Puppeteer's Chrome browser is not installed. Run `npx puppeteer browsers install chrome` and try again.",
      );
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new WebsiteScraperError(`${siteName} took too long to respond. Please try again.`);
    }
    console.error(
      `Website scraping failed for ${siteName}.`,
      error instanceof Error ? error.message : "Unknown error",
    );
    throw new WebsiteScraperError(`Arc could not read ${siteName} right now. Please try again later.`);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        console.error(
          "Could not close the website scraper browser.",
          error instanceof Error ? error.message : "Unknown error",
        );
      }
    }
  }
}
