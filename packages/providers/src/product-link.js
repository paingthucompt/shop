// Product link import: a TikTok Shop / Shopee link (or data sent by the bookmarklet from the user's own
// browser) → title, price, photos. Nothing here bypasses the shops' bot protection: the server only
//   • reads what is already inside the shared link (TikTok share links carry og_info = title + image),
//   • follows the shops' own short-link redirects,
//   • asks the official Shopee Affiliate Open API (when SHOPEE_APP_ID / SHOPEE_SECRET are set),
//   • downloads photos from the shops' public image CDNs (allowlisted hosts only — no other URLs).
// Product pages themselves (bot-protected) are read by the bookmarklet in the user's own browser.

const TIKTOK_HOSTS = /(^|\.)tiktok\.com$/i;
const SHOPEE_HOSTS = /(^|\.)shopee\.(co\.th|com\.my|sg|ph|vn|co\.id|tw|com\.br)$/i;
const SHORT_LINK_HOSTS = /^(vt|vm)\.tiktok\.com$|^(s\.shopee\.[a-z.]+|shp\.ee|shope\.ee)$/i;
// public image CDNs of TikTok Shop, Shopee and Lazada — the only hosts photos are downloaded from
const IMAGE_HOSTS = /(^|\.)(ibyteimg\.com|byteimg\.com|tiktokcdn\.com|tiktokcdn-us\.com|tiktokcdn-eu\.com|susercontent\.com|slatic\.net|lazcdn\.com)$/i;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const parseUrl = (u) => { try { return new URL(String(u).trim()); } catch { return null; } };

export const isAllowedImageUrl = (u) => {
  const url = parseUrl(u);
  return Boolean(url && url.protocol === "https:" && IMAGE_HOSTS.test(url.hostname) && !url.username && !url.password);
};

/**
 * The full-size version of a shop CDN photo:
 *   TikTok  …/abc~tplv-xyz-resize-webp:260:260.webp?…  →  …/abc~tplv-xyz-origin-jpeg.jpeg
 *   Shopee  …/file/th-111-abc_tn                       →  …/file/th-111-abc
 */
export function fullSizeImage(u) {
  const url = parseUrl(u);
  if (!url) return u;
  if (/(ibyteimg|byteimg|tiktokcdn)/i.test(url.hostname)) {
    const m = url.pathname.match(/^(.*~tplv-[a-z0-9]+)-[^/]*$/i);
    if (m) return `${url.origin}${m[1]}-origin-jpeg.jpeg`;
  }
  if (/susercontent\.com$/i.test(url.hostname)) {
    return `${url.origin}${url.pathname.replace(/(_tn|@resize_[^/]*)$/i, "")}`;
  }
  return url.href;
}

/**
 * What the link itself tells us, without any network request.
 * → { platform: "tiktok"|"shopee"|null, productId, shopId, productUrl (clean, no tracking/user ids), title, images }
 */
export function parseProductLink(input) {
  const url = parseUrl(input);
  if (!url || !["http:", "https:"].includes(url.protocol)) return null;
  const out = { platform: null, productId: null, shopId: null, productUrl: null, title: "", images: [] };

  if (TIKTOK_HOSTS.test(url.hostname)) {
    const id = url.pathname.match(/\/product\/(\d{6,})/)?.[1] || url.searchParams.get("product_id");
    out.platform = "tiktok";
    out.productId = id || null;
    if (id) out.productUrl = `https://www.tiktok.com/view/product/${id}`;
    // share links carry {"title": "...", "image": "..."} in og_info
    try {
      const og = JSON.parse(url.searchParams.get("og_info") || "{}");
      if (typeof og.title === "string") out.title = og.title.trim().slice(0, 200);
      if (typeof og.image === "string" && isAllowedImageUrl(og.image)) out.images.push(fullSizeImage(og.image));
    } catch { /* no og_info */ }
    return out;
  }

  if (SHOPEE_HOSTS.test(url.hostname)) {
    out.platform = "shopee";
    // /product/{shop}/{item}  or  /Some-Name-i.{shop}.{item}
    const m = url.pathname.match(/\/product\/(\d+)\/(\d+)/) || url.pathname.match(/-i\.(\d+)\.(\d+)/);
    if (m) {
      [, out.shopId, out.productId] = m;
      out.productUrl = `${url.origin}/product/${out.shopId}/${out.productId}`;
    }
    return out;
  }
  return out; // unknown shop: the bookmarklet data (if any) is all we have
}

/** follow a shop's short link (vt.tiktok.com/…, s.shopee.co.th/…) to the real product link — shop hosts only */
export async function resolveShortLink(input, { fetchImpl = fetch, hops = 4 } = {}) {
  let url = parseUrl(input);
  for (let i = 0; url && i < hops && SHORT_LINK_HOSTS.test(url.hostname); i++) {
    const res = await fetchImpl(url.href, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const next = res.headers.get("location");
    if (!next) break;
    const to = parseUrl(new URL(next, url).href);
    if (!to || to.protocol !== "https:" || !(TIKTOK_HOSTS.test(to.hostname) || SHOPEE_HOSTS.test(to.hostname))) break;
    url = to;
  }
  return url?.href || String(input);
}

/** one allowlisted CDN photo → { mime, data } (no redirects, size and type checked) */
export async function downloadImage(u, { fetchImpl = fetch } = {}) {
  if (!isAllowedImageUrl(u)) throw new Error("photo host not allowed");
  const res = await fetchImpl(u, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`photo download failed (${res.status})`);
  const mime = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!IMAGE_MIME.has(mime)) throw new Error(`not a jpg/png/webp photo (${mime || "unknown"})`);
  if (Number(res.headers.get("content-length") || 0) > MAX_IMAGE_BYTES) throw new Error("photo is too large");
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > MAX_IMAGE_BYTES) throw new Error("photo is too large");
  if (data.length < 2_000) throw new Error("photo is too small");
  return { mime, data };
}

const clean = (s, max) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * page: optional data the bookmarklet read from the product page in the user's browser
 *   { url, title, description, price, currency, images: [urls] }
 * Returns the merged product data + up to `maxImages` downloaded photos and notes for the user.
 */
export async function importProduct({ url, page } = {}, { shopee, fetchImpl = fetch, maxImages = 8 } = {}) {
  const notes = [];
  const link = url ? await resolveShortLink(url, { fetchImpl }).catch(() => url) : page?.url;
  const info = parseProductLink(link) || { platform: null, images: [], title: "" };
  const result = {
    platform: info.platform,
    product_url: info.productUrl || (parseUrl(page?.url) ? `${parseUrl(page.url).origin}${parseUrl(page.url).pathname}` : null),
    title: clean(page?.title || info.title, 200),
    description: clean(page?.description, 2000),
    price: Number.isFinite(Number(page?.price)) && String(page?.price ?? "").trim() !== "" ? Number(page.price) : null,
    currency: ["THB", "MMK", "USD"].includes(page?.currency) ? page.currency : info.platform ? "THB" : null,
  };
  let candidates = [...(Array.isArray(page?.images) ? page.images : []), ...info.images];

  if (info.platform === "shopee" && info.productId && shopee?.shopeeEnabled?.()) {
    try {
      const p = await shopee.getProduct(info.shopId, info.productId);
      if (p) {
        result.title ||= clean(p.productName, 200);
        if (result.price === null && Number.isFinite(Number(p.price))) result.price = Number(p.price);
        if (p.imageUrl) candidates.push(p.imageUrl);
        result.affiliate_url = p.offerLink || null;
      }
    } catch (e) { notes.push(`Shopee API: ${e.message}`); }
  }

  candidates = [...new Set(candidates.map(fullSizeImage).filter(isAllowedImageUrl))].slice(0, maxImages * 2);
  const images = [];
  for (const c of candidates) {
    if (images.length >= maxImages) break;
    try {
      const img = await downloadImage(c, { fetchImpl });
      images.push({ mime: img.mime, data: img.data, source: c });
    } catch { /* skip broken / tiny photos */ }
  }

  if (!result.title && !images.length) {
    notes.push(info.platform === "shopee"
      ? "Shopee protects its pages from servers — open the product in your browser and click the “Send to Affiliate Studio” bookmark."
      : info.platform === "tiktok"
        ? "This TikTok link has no product details inside — open it in your browser and click the “Send to Affiliate Studio” bookmark."
        : "Unknown link — paste a TikTok Shop or Shopee product link, or use the bookmark on the product page.");
  } else if (images.length < 2 && !page) {
    notes.push("Only the main photo is inside the link — for more photos (and the details) use the “Send to Affiliate Studio” bookmark on the product page.");
  }
  return { ...result, images, notes };
}
