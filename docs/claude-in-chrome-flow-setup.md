# Claude in Chrome — Google Flow setup prompt (တစ်ခါပဲ လုပ်ရ)

> အသုံးပြုနည်း: `---` အောက်က စာအားလုံးကို Claude in Chrome ထဲ ကူးထည့်ပါ။ Setup ပြီးရင် ပစ္စည်းတစ်ခုချင်းအတွက်
> [claude-in-chrome-flow-prompt.md](claude-in-chrome-flow-prompt.md) ကို သုံးပါ။

---

မင်းက ကျွန်တော့်ရဲ့ TikTok Shop / Shopee affiliate video ထုတ်လုပ်ရေး assistant ပါ။ ကျွန်တော်ဟာ ထိုင်းနဲ့ မြန်မာ ဈေးကွက်အတွက် ပစ္စည်း video တိုတွေ ထုတ်ပါတယ်။

**ဒီတစ်ခါ လုပ်ရမယ့်အလုပ်:** **Google Flow (https://flow.google.com)** ကို ကျွန်တော့် လုပ်ငန်းစဉ်အတွက် **setup** လုပ်ပေးပါ။ ဒါမှ နောက်ပိုင်း ပစ္စည်းတိုင်းမှာ prompt ကို paste လုပ်ရုံနဲ့ storyboard ပုံနဲ့ video ကို တန်းထုတ်လို့ရမှာပါ။ ဒီတစ်ခါ video ဒါမှမဟုတ် ပုံ **မထုတ်ရပါ** (Flow credit မကုန်စေရ)။

## ကျွန်တော့် လုပ်ငန်းစဉ် (setup ကို ဒီအတွက် လုပ်ရမှာပါ)
1. ကျွန်တော့် app (http://localhost:5173) က ပစ္စည်းတစ်ခုချင်းအတွက် prompt ၂ ခု ထုတ်ပေးပါတယ်:
   - **① Storyboard prompt:** Flow → **Image · 16:9** မှာ storyboard sheet တစ်ပုံ ထုတ်ဖို့ (panel တွေ၊ အချိန်၊ ထိုင်း/မြန်မာ စာ ပါ)
   - **② Video prompt:** Flow → **Video · Ingredients · 9:16 · Omni 1.2 Flash · 720p · Length 5–15 s** မှာ ① storyboard ပုံ + ပစ္စည်းပုံကို ingredient ထည့်ပြီး **အသံ/စာ မပါတဲ့** clip ထုတ်ဖို့
2. ထွက်လာတဲ့ MP4 ကို app ထဲ ပြန်ထည့်ပါတယ်။ App က ထိုင်း/မြန်မာ voiceover၊ စာတန်း၊ hook နဲ့ CTA ကို ထည့်ပါတယ်။

**ကျွန်တော် လိုချင်တဲ့ ပုံစံ:**
- 9:16 ဒေါင်လိုက်၊ photorealistic၊ လက်နဲ့ ပစ္စည်းကို တကယ်သုံးပြနေတဲ့ UGC ပုံစံ၊ သဘာဝ အလင်း
- ပစ္စည်းက ပစ္စည်းပုံနဲ့ အတိအကျ တူရမယ်
- Video မှာ စကား၊ music၊ screen ပေါ်က စာ မပါရ
- ချဲ့ကားတဲ့ ရလဒ် မပြရ

## အဆင့် A — စစ်ဆေးခြင်း (ဘာမှ မပြောင်းရ)
Flow ကို ဖွင့်ပြီး ဒါတွေကို စစ်ပြီး မှတ်ထားပါ:
1. **Account:** ဘယ် Google account နဲ့ login ဝင်ထားလဲ၊ plan (Google AI Pro / Ultra / free) က ဘာလဲ၊ ကျန်တဲ့ Flow credit ဘယ်လောက်လဲ၊ ဘယ်နေ့ ပြန်ပြည့်လဲ။
2. **ကုန်ကျမယ့် credit:** Generate မနှိပ်ဘဲ setting ပြောင်းကြည့်ရုံနဲ့ "Generating will use __ credits" မှာ ပြတဲ့ ပမာဏကို မှတ်ပါ:
   - Video · Omni 1.2 Flash · 720p · 9:16 · Length **5 s / 10 s / 15 s** · x1
   - Video · 360p · 15 s · x1 (နှိုင်းယှဉ်ဖို့)
   - Image · 16:9 · Nano Banana / Nano Banana Pro (ရှိသလောက်) · x1
3. **Model:** Video နဲ့ Image မှာ ရွေးလို့ရတဲ့ model အားလုံး (Omni၊ Veo၊ Nano Banana version တွေ)
4. **Feature:** Ingredients၊ Frames၊ Extend၊ Scenebuilder၊ project/folder၊ style preset၊ saved prompt/template၊ ingredient/character library၊ download format (MP4 720p/1080p၊ GIF)၊ visible watermark ပါမပါ။
5. **Settings page:** Default aspect ratio၊ default model၊ output count (x1–x4)၊ download quality၊ language နဲ့ တခြား setting တွေ ဘာရှိလဲ။

## အဆင့် B — Setup လုပ်ခြင်း (credit မကုန်တာတွေပဲ)
Flow မှာ ရှိတဲ့ feature တွေနဲ့ ကိုက်သလောက်ပဲ လုပ်ပါ။ မရှိတဲ့ feature ဆိုရင် ကျော်ပြီး report မှာ ရေးပါ။
1. **Default:** Video ကို **9:16 · Omni 1.2 Flash · 720p · x1** ထားပါ။ Image ကို **16:9 · x1** ထားပါ။ Default မရှိရင် နောက်ဆုံးသုံးတဲ့ setting ကို မှတ်ထားလား စစ်ပါ။
2. **Output count:** Default ကို **x1** ထားပါ (x2–x4 က credit ၂–၄ ဆ ကုန်လို့ပါ)။
3. **Download:** Video ကို **MP4 720p** နဲ့ ဒေါင်းဖို့ ထားပါ။
4. **Project:** Project အသစ် **"Affiliate Videos – TH/MM"** ဖန်တီးပါ။ Folder ခွဲလို့ရရင် **"Storyboards"** နဲ့ **"Clips"** ခွဲပါ။
5. **Style preset / saved prompt:** ရှိရင် ဒီ ၂ ခုကို သိမ်းပါ:
   - **"UGC product demo"** — `Photorealistic vertical 9:16 social-commerce product video. Natural handheld iPhone / UGC look, soft daylight, real home or desk setting, hands interacting with the product. The product looks exactly like the reference photos (shape, colours, logo, label) and never changes between shots. Realistic, modest results. Nobody speaks; only natural product sounds; no music. No on-screen text, subtitles, captions, logos or watermarks.`
   - **"Ad storyboard sheet"** — `Professional ad-agency storyboard sheet, landscape 16:9, dark navy header, bold modern typography, high contrast, clean grid of numbered vertical 9:16 photorealistic panels, each with a rounded label and the on-screen text. The product is exactly as in the reference photos. No prices, discounts, warranties, ratings or badges that are not given.`
6. **Ingredient library:** ရှိရင် ဘာမှ မထည့်ဘဲ ဘယ်လို သုံးရမလဲ (ပစ္စည်းပုံ upload လုပ်ပုံ၊ project အကြား ပြန်သုံးလို့ရလား) ကိုပဲ report မှာ ရေးပါ။

## လုံးဝ မလုပ်ရတာ
- ပုံ ဒါမှမဟုတ် video ကို **generate လုပ်တာ** (ဒီ setup မှာ credit ၀ ပဲ ကုန်ရမယ်)
- Flow credit ဒါမှမဟုတ် Google One/AI plan ကို **ဝယ်တာ၊ upgrade လုပ်တာ၊ trial စတာ**
- Billing၊ payment၊ account၊ password၊ 2FA၊ privacy/data-sharing setting ပြင်တာ (privacy setting ပြင်ချင်ရင် ကျွန်တော့်ကို အရင်မေးပါ)
- Project ဟောင်းတွေ၊ ကျွန်တော့် ပုံ/video ဟောင်းတွေကို ဖျက်တာ၊ နာမည်ပြောင်းတာ
- Share လုပ်တာ၊ public လုပ်တာ၊ collaborator ဖိတ်တာ
- Login မေးရင်၊ terms/consent မေးရင်၊ ပိုက်ဆံ ပေါ်လာရင် ရပ်ပြီး ကျွန်တော့်ကို ခေါ်ပါ

## Report (ဒီပုံစံနဲ့ ပြန်ပေးပါ)
```
Account / plan:                credit ကျန် __ · ပြန်ပြည့်မယ့်နေ့ __
Credit ကုန်ကျမှု:
  Omni 1.2 Flash 720p 9:16 x1 →  5s __ · 10s __ · 15s __ · (360p 15s __)
  Image 16:9 x1              →  Nano Banana __ · Nano Banana Pro __
  ⇒ credit ကျန်ငွေနဲ့ ထုတ်လို့ရမယ့် ပစ္စည်း အရေအတွက် (storyboard ၁ + 15s video ၁ / ပစ္စည်း): __
ရရှိနိုင်တဲ့ model:          Video __ · Image __
Feature:                       Ingredients __ · Extend __ · Scenebuilder __ · style preset __ · saved prompt __ · watermark __
ပြောင်းခဲ့တဲ့ setting:        __
ဖန်တီးခဲ့တာ:                  project __ · folder __ · preset __
မလုပ်နိုင်ခဲ့တာ (အကြောင်းရင်း): __
ကျွန်တော့် app/prompt မှာ ပြင်သင့်တာ (Flow ရဲ့ menu နာမည်၊ Length ကန့်သတ်ချက် စသည်): __
```
