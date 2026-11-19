// Shopee Affiliate Open API (GraphQL). Auth header:
//   Authorization: SHA256 Credential={appId}, Timestamp={ts}, Signature=sha256(appId + ts + payload + secret)
import crypto from "node:crypto";

const cfg = () => ({
  endpoint: process.env.SHOPEE_AFFILIATE_ENDPOINT || "https://open-api.affiliate.shopee.co.th/graphql",
  appId: process.env.SHOPEE_APP_ID,
  secret: process.env.SHOPEE_SECRET,
});

export const shopeeEnabled = () => Boolean(cfg().appId && cfg().secret);

export function buildAuthorization(appId, secret, payload, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = crypto.createHash("sha256").update(`${appId}${timestamp}${payload}${secret}`).digest("hex");
  return `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`;
}

async function graphql(query, variables) {
  const { endpoint, appId, secret } = cfg();
  if (!appId || !secret) throw new Error("SHOPEE_APP_ID / SHOPEE_SECRET not set");
  const payload = JSON.stringify(variables ? { query, variables } : { query });
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: buildAuthorization(appId, secret, payload) },
    body: payload,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors?.length) throw new Error(`Shopee: ${json.errors?.[0]?.message || res.status}`);
  return json.data;
}

const gqlString = (s) => JSON.stringify(String(s));

/** Search products that have affiliate commission */
export async function searchProducts(keyword, { page = 1, limit = 20 } = {}) {
  const data = await graphql(`{
    productOfferV2(keyword: ${gqlString(keyword)}, sortType: 2, page: ${Number(page)}, limit: ${Number(limit)}) {
      nodes { itemId productName imageUrl price commissionRate sales productLink offerLink shopName }
      pageInfo { page limit hasNextPage }
    }
  }`);
  return data.productOfferV2;
}

/** Turn a normal Shopee product URL into a tracked affiliate short link */
export async function generateShortLink(originUrl, subIds = []) {
  const data = await graphql(`mutation {
    generateShortLink(input: { originUrl: ${gqlString(originUrl)}, subIds: ${JSON.stringify(subIds.slice(0, 5).map(String))} }) { shortLink }
  }`);
  return data.generateShortLink.shortLink;
}
