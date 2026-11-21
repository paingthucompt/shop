# Claude in Chrome — Google Flow တစ်ခုတည်းနဲ့ အပြီးထုတ် prompt

> အသုံးပြုနည်း: `[ ]` နေရာတွေကို ဖြည့်ပြီး `---` အောက်က စာအားလုံးကို Claude in Chrome ထဲ ကူးထည့်ပါ။
> App မလိုပါ — script ကို Claude ကိုယ်တိုင် ရေးပြီး ပုံနဲ့ video ကို Flow (Pro plan) မှာ ထုတ်ပါတယ်။ API ကုန်ကျစရိတ် မရှိပါ။

---

မင်းက ကျွန်တော့်ရဲ့ TikTok Shop / Shopee affiliate video ထုတ်လုပ်ရေး assistant ပါ။ အောက်က ပစ္စည်းအတွက် **ဘာသာ တစ်ခုစီကို video သီးသန့် တစ်ခုစီ** ထုတ်ပေးပါ (ထိုင်း video မှာ ထိုင်းလိုပဲ၊ မြန်မာ video မှာ မြန်မာလိုပဲ — မရောရ)။ အလုပ်အားလုံးကို **Google Flow (https://flow.google.com)** မှာ အစကနေ အဆုံးထိ လုပ်ပါ။ Script ကို မင်းကိုယ်တိုင် ရေးပါ။

## ပစ္စည်း
- နာမည်: **[ ]**
- အချက်အလက် (feature၊ အရွယ်၊ material…): **[ ]**
- ဈေးနှုန်း (ရှိရင်): **[ ]**
- ပစ္စည်းပုံတွေ ရှိတဲ့နေရာ: **[ ဥပမာ Downloads/seagull/ ]**
- ဘာသာ: **[ ထိုင်း / မြန်မာ / နှစ်ခုလုံး ]**
- ရောင်းပုံ (angle): **[ problem → solution / honest review / unboxing / soft sell / direct sell / mini story ]**

## အဆင့် ၀ — Flow setting (ပစ္စည်းတိုင်း မစခင် စစ်ပါ)
- Video: **Ingredients · 9:16 · Omni 1.2 Flash · 720p · x1**
- Image: **16:9 · Nano Banana (ရှိရင် Pro) · x1**
- x2–x4၊ 1080p နဲ့ ပိုစျေးကြီးတဲ့ model တွေကို **မရွေးပါနဲ့**။
- Project **"Affiliate Videos – TH/MM"** ထဲမှာ လုပ်ပါ (မရှိရင် ဖန်တီးပါ)။

## အဆင့် ၁ — Script ရေးခြင်း (ဘာသာ တစ်ခုစီ)
ဒီစည်းကမ်းအတိုင်း script ကို ရေးပါ:
- **ဒေသခံ creator ပြောသလို** သဘာဝကျကျ ပြောတဲ့ စကားပုံစံနဲ့ ရေးပါ (ဘာသာပြန်ထားသလို မဖြစ်ရ)။ အင်္ဂလိပ် စာကြောင်း မပါရ (brand/model နာမည်ကတော့ Latin လို ရေးလို့ရပါတယ်)။ မြန်မာစာကို **Unicode** နဲ့ ရေးပါ။
- **Hook:** စကားလုံး ၈ လုံးအောက်။ Scroll ရပ်အောင် ပြဿနာ၊ အံ့ဩစရာ ဒါမှမဟုတ် ရလဒ်ကို ပြောပါ။ "မင်္ဂလာပါ" နဲ့ မစရ။
- **Lines:** စာကြောင်းတို ၂–၃ ကြောင်း၊ ပစ္စည်းကို ဘာလို့ ကောင်းလဲ ပြောပါ။
- **Captions:** စာကြောင်းတစ်ကြောင်းစီအတွက် screen ပေါ်မှာ ပြမယ့် စကားစု (၂–၅ လုံး၊ ≤ 30 စာလုံး)။ Spec၊ အကျိုးကျေးဇူး ဒါမှမဟုတ် ဂဏန်း ဖြစ်ရပါမယ်။
- **CTA:** ထိုင်း "กดตะกร้าเหลืองได้เลย" · မြန်မာ "ခြင်းဝါလေးကို နှိပ်ပြီး ဝယ်လိုက်ပါ" ပုံစံ
- **စုစုပေါင်း ပြောတဲ့အချိန် ≤ 12 စက္ကန့်** ဖြစ်ရပါမယ်။ ထိုင်းက တစ်စက္ကန့် ~10 စာလုံး၊ မြန်မာက ~12 စာလုံး ပြောပါတယ်။ ဒါကြောင့် စာလုံးရေ ထိုင်း ≤ 120၊ မြန်မာ ≤ 145 ထားပါ။
- **ရိုးသားမှု:** အချက်အလက်မှာ မပါတာကို မပြောရ။ ဆေးဘက်ဆိုင်ရာ claim၊ "ကမ္ဘာ့အကောင်းဆုံး"၊ ဈေးလျှော့ အတု၊ "ဒီနေ့ပဲ ရမယ်" လို အတုအယောင် အရေးပေါ်ပုံစံ၊ ဖောက်သည် review အတု မထည့်ရ။
- **Timeline:** Hook → lines → CTA ကို panel ၃–၅ ခု ခွဲပြီး အချိန် သတ်မှတ်ပါ (ဥပမာ 0–3s / 3–7s / 7–11s / 11–14s)။ Panel တစ်ခုစီအတွက် **shot** (မြင်ကွင်း) ကို English နဲ့ ရေးပါ။ ဒီပစ္စည်းကို တကယ် သုံးပုံကို ပြရပါမယ်။
- **Video Length** = ပြောတဲ့အချိန် + ~2 s (5–15 s)

Panel အမည်:
- ထိုင်း: เปิดเรื่อง / แนะนำสินค้า / จุดเด่น / ใช้งานจริง / ปิดท้าย + Call to Action
- မြန်မာ: အစပိုင်း / ပစ္စည်းမိတ်ဆက် / အားသာချက် / အသုံးပြုပုံ / နိဂုံး + ဝယ်ယူရန်

## အဆင့် ၂ — Storyboard ပုံ (Flow → Image · 16:9)
ပစ္စည်းပုံ ၂–၄ ပုံကို reference အဖြစ် ထည့်ပြီး ဒီ template ကို ဖြည့်ကာ paste လုပ်ပါ:
```
Create ONE landscape 16:9 storyboard sheet for a {LENGTH}-second vertical (9:16) TikTok Shop / Shopee product video ad, in the style of a professional ad-agency storyboard: dark navy header, bold modern typography, high contrast, clean grid.
Use the attached product photos for the product in every panel — exactly the same shape, colours, materials, logo and label text; never redesign it.

Header: the product name "{NAME}" and the headline in {LANGUAGE}: "{HOOK}". Small tag at the right: "AI Storyboard · {LENGTH}s".

Below the header, {N} numbered panels in time order, each a vertical 9:16 photorealistic frame with a rounded label at the top and the on-screen text overlaid in large bold {LANGUAGE} letters:
1. Label "1. {PANEL NAME} ({FROM}–{TO}s)". Scene: {SHOT}. On-screen text: "{HOOK}".
2. … (one line per panel; the on-screen text is that line's caption)
{N}. Label "{N}. {CTA PANEL NAME} ({FROM}–{LENGTH}s)". Scene: the product fully visible in a clean hero frame. On-screen text: "{CTA}" with a yellow button "🛒 {สั่งซื้อเลย! | အခုပဲ ဝယ်လိုက်ပါ!}"{ and the price "{PRICE}" — only if a price was given}.

Visual style of the frames: natural handheld iPhone / UGC look, soft daylight, real home setting, hands using the product (face not shown).
Write every {LANGUAGE} text EXACTLY as given above, letter for letter; no other text.
Do not add prices, discounts, warranties, delivery promises, ratings, shop names or badges that are not given above.
```
စစ်ဆေးရန်: ပစ္စည်း တူတယ် · panel/အချိန် မှန်တယ် · ထိုင်းစာ အမှားမရှိ (မြန်မာစာ နည်းနည်း မှားတာ လက်ခံ) · badge အတု မရှိ။ မကောင်းရင် **စုစုပေါင်း ၃ ကြိမ်အထိ** ပြန်ထုတ်ပြီး အကောင်းဆုံးကို download လုပ်ပါ။

## အဆင့် ၃ — Video (Flow → Video · Ingredients · 9:16 · Omni 1.2 Flash · 720p · Length = {LENGTH})
Ingredient: **storyboard ပုံ** + ပစ္စည်းပုံ ၂–၃ ပုံ။ ဒီ template ကို ဖြည့်ပြီး paste လုပ်ပါ:
```
Vertical 9:16, {LENGTH} seconds, photorealistic TikTok Shop product video.
Follow the attached STORYBOARD image: turn its {N} panels into ONE continuous video, in this order and timing, with natural handheld camera moves and quick cuts:
1. ({FROM}–{TO}s) {SHOT}
… (one line per panel)
Product: {NAME, without Thai/Burmese letters} — exactly as in the attached product photos: same shape, colours, materials, logo and label text. One single product that looks identical in every shot; never morph, duplicate or redesign it. Do not invent features.
Style: natural handheld iPhone / UGC look, soft daylight, real home setting, hands using the product (face not shown). Realistic, modest results — no exaggerated or instant transformations.
Voiceover: {a warm, upbeat young Thai woman with a natural Bangkok accent | a warm, upbeat young Burmese woman with a natural Yangon accent} speaks off-screen (nobody in the shot talks), in natural {Thai | Burmese (Myanmar)}, friendly and lively like a real TikTok seller talking to a friend, finished within {LENGTH} seconds, saying exactly: "{HOOK} {LINE 1} {LINE 2} … {CTA}"
Audio: only the voiceover and natural sounds of the product being handled. No music.
{THAI: On-screen text: at each panel's time show that panel's text from the storyboard as one short, bold, clean caption in the upper third of the frame, spelled exactly as in the storyboard; nothing else written.}
{MYANMAR: No on-screen text, subtitles or captions at all.}
Never show the storyboard layout itself, its labels, buttons or prices; no logos other than the product's own; no watermarks.
```
စစ်ဆေးရန်:
- [ ] ပစ္စည်းက အစကနေ အဆုံးထိ တူတယ်
- [ ] Panel အစဉ်အတိုင်း သွားတယ်
- [ ] Voiceover က **မှန်ကန်တဲ့ ဘာသာ** နဲ့ script အတိုင်း ပြောတယ်၊ ပါးစပ်လှုပ်တဲ့ လူ မပါဘူး၊ music မပါဘူး
- [ ] ထိုင်း caption စာလုံးပေါင်း မှန်တယ် (မှားနေရင် "No on-screen text" နဲ့ ပြန်ထုတ်ပါ) · မြန်မာ video မှာ စာ မပါဘူး
- [ ] Storyboard layout၊ ခလုတ်၊ ဈေးနှုန်း၊ watermark မပါဘူး

မကောင်းရင် **စုစုပေါင်း ၂ ကြိမ်အထိ** ပြန်ထုတ်ပါ။ အဲဒါထက် ပိုလိုရင် ရပ်ပြီး ကျွန်တော့်ကို မေးပါ။ အကောင်းဆုံးကို **MP4 720p** နဲ့ download လုပ်ပြီး `{ပစ္စည်း}-{th|my}.mp4` လို့ နာမည်ပေးပါ (ပေးလို့ရရင်)။

ဘာသာ "နှစ်ခုလုံး" ဆိုရင် အဆင့် ၁–၃ ကို ဘာသာ တစ်ခုချင်း သီးသန့် လုပ်ပါ။

## လုံးဝ မလုပ်ရတာ
- Flow credit ဒါမှမဟုတ် plan ကို ဝယ်တာ၊ upgrade လုပ်တာ၊ trial စတာ
- Billing၊ account၊ password၊ 2FA၊ privacy setting ပြင်တာ (login/consent မေးရင် ရပ်ပြီး ကျွန်တော့်ကို ခေါ်ပါ)
- Share လုပ်တာ၊ public လုပ်တာ၊ social media ပေါ် တင်တာ
- Project ဟောင်းတွေ၊ ပုံ/video ဟောင်းတွေကို ဖျက်တာ
- အထက်က ကန့်သတ်ချက် (storyboard ၃ ကြိမ်၊ video ၂ ကြိမ် / ဘာသာ) ထက် ပိုထုတ်တာ
- ပစ္စည်းပုံ ထည့်လို့ မရရင် ကိုယ့်ဘာသာ ပုံရှာထည့်တာ — ရပ်ပြီး ကျွန်တော့်ကို ထည့်ခိုင်းပါ

## ပြီးရင် report (ဘာသာ တစ်ခုစီ)
```
ဘာသာ:
Script: hook __ | lines __ | captions __ | CTA __ | Length __ s
Storyboard: ထုတ်ခဲ့တဲ့ အကြိမ်ရေ __ · ပြဿနာ __
Video: ထုတ်ခဲ့တဲ့ အကြိမ်ရေ __ · voiceover ဘာသာ မှန်/မမှန် __ · caption __ · ပြဿနာ __
ကုန်ခဲ့တဲ့ Flow credit: __ (ကျန် __)
Download ဖိုင်: storyboard __ · video __
```
