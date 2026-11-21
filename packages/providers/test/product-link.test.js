import test from "node:test";
import assert from "node:assert/strict";
import { parseProductLink, fullSizeImage, isAllowedImageUrl, importProduct, resolveShortLink } from "../src/product-link.js";

const IMG = "https://p16-oec-sg.ibyteimg.com/tos-alisg-i-aphluv4xwc-sg/abc~tplv-aphluv4xwc-resize-webp:260:260.webp?dr=1&idc=my";
const TT = `https://www.tiktok.com/view/product/1731481458480090035?u_code=x&user_id=7497&og_info=${encodeURIComponent(JSON.stringify({ title: "Haier ตู้เย็น 149 ลิตร", image: IMG }))}`;

test("TikTok share link: id, clean url without user ids, title + full-size photo from og_info", () => {
  const r = parseProductLink(TT);
  assert.equal(r.platform, "tiktok");
  assert.equal(r.productUrl, "https://www.tiktok.com/view/product/1731481458480090035");
  assert.equal(r.title, "Haier ตู้เย็น 149 ลิตร");
  assert.deepEqual(r.images, ["https://p16-oec-sg.ibyteimg.com/tos-alisg-i-aphluv4xwc-sg/abc~tplv-aphluv4xwc-origin-jpeg.jpeg"]);
});

test("Shopee links: both URL shapes → shop + item id and a clean url", () => {
  for (const u of ["https://shopee.co.th/product/871058531/29175338970?sp_atk=x", "https://shopee.co.th/Haier-Fridge-i.871058531.29175338970?xptdk=1"]) {
    const r = parseProductLink(u);
    assert.equal(r.platform, "shopee");
    assert.equal(r.shopId, "871058531");
    assert.equal(r.productId, "29175338970");
    assert.equal(r.productUrl, "https://shopee.co.th/product/871058531/29175338970");
  }
  assert.equal(fullSizeImage("https://down-th.img.susercontent.com/file/th-11134207-abc_tn"), "https://down-th.img.susercontent.com/file/th-11134207-abc");
});

test("only https shop CDN photos are downloaded (no SSRF to other hosts)", () => {
  assert.ok(isAllowedImageUrl(IMG));
  assert.ok(isAllowedImageUrl("https://down-th.img.susercontent.com/file/x"));
  for (const bad of ["http://down-th.img.susercontent.com/file/x", "https://169.254.169.254/latest", "https://evil.com/x.ibyteimg.com.jpg",
    "https://localhost/x", "https://susercontent.com.evil.io/x", "file:///etc/passwd"]) assert.equal(isAllowedImageUrl(bad), false, bad);
});

test("short links only follow redirects to shop hosts", async () => {
  const hops = { "https://vt.tiktok.com/ZS123/": "https://www.tiktok.com/view/product/42424242?x=1" };
  const fetchImpl = async (u) => ({ headers: { get: () => hops[u] || null } });
  assert.equal(await resolveShortLink("https://vt.tiktok.com/ZS123/", { fetchImpl }), "https://www.tiktok.com/view/product/42424242?x=1");
  const evil = async () => ({ headers: { get: () => "http://127.0.0.1:4000/api" } });
  assert.equal(await resolveShortLink("https://vt.tiktok.com/ZS9/", { fetchImpl: evil }), "https://vt.tiktok.com/ZS9/");
});

test("importProduct: bookmarklet data wins, bad photos skipped, notes when nothing found", async () => {
  const jpeg = Buffer.alloc(5000, 1);
  const fetchImpl = async (u) => ({
    ok: !u.includes("broken"), status: u.includes("broken") ? 404 : 200,
    headers: { get: (h) => (h === "content-type" ? "image/jpeg" : null) },
    arrayBuffer: async () => jpeg,
  });
  const r = await importProduct({ page: {
    url: "https://shopee.co.th/product/1/2?a=b", title: "  Mini   chopper ", description: "2 blades", price: "299", currency: "THB",
    images: ["https://down-th.img.susercontent.com/file/a_tn", "https://down-th.img.susercontent.com/file/a", "https://evil.com/x.jpg",
      "https://down-th.img.susercontent.com/file/broken"],
  } }, { fetchImpl });
  assert.equal(r.title, "Mini chopper");
  assert.equal(r.price, 299);
  assert.equal(r.product_url, "https://shopee.co.th/product/1/2");
  assert.equal(r.images.length, 1); // a_tn and a are the same photo; evil host and broken one skipped
  const none = await importProduct({ url: "https://shopee.co.th/product/1/2" }, { fetchImpl });
  assert.equal(none.images.length, 0);
  assert.match(none.notes[0], /bookmark/);
});
