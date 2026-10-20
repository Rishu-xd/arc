import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class PublicWebsiteError extends Error {}

function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    const [first, second, third] = octets;
    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && (second === 0 || second === 168)) ||
      (first === 192 && second === 88 && third === 99) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 && second === 51 && third === 100) ||
      (first === 203 && second === 0 && third === 113) ||
      first >= 224
    );
  }

  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) {
      const mappedAddress = normalized.slice("::ffff:".length);
      return isIP(mappedAddress) === 4 && isPublicAddress(mappedAddress);
    }
    const groups = normalized.split(":");
    const firstGroup = Number.parseInt(groups[0] || "0", 16);
    const secondGroup = Number.parseInt(groups[1] || "0", 16);
    return firstGroup >= 0x2000 &&
      firstGroup <= 0x3fff &&
      !(firstGroup === 0x2001 && (secondGroup === 0 || secondGroup === 0x0db8));
  }

  return false;
}

export async function assertPublicWebHost(url: URL): Promise<void> {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new PublicWebsiteError("For safety, Arc can only open public websites.");
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new PublicWebsiteError("For safety, Arc can only open URLs that resolve to public websites.");
  }
}
