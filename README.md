# Affiliate Video Studio

ပစ္စည်းပုံ ၁–၄ ပုံ → **ထိုင်း video** (ထိုင်းအသံ + ထိုင်းစာ) နဲ့ **မြန်မာ video** (မြန်မာအသံ + မြန်မာစာ) ကို **သီးသန့်စီ** ထုတ်ပေးတဲ့ SaaS app ပါ။
Shopee / TikTok Shop affiliate ရောင်းသူတွေအတွက် ရည်ရွယ်ပါတယ်။

```
ပစ္စည်းပုံ ─→ Seedance 2.5 (9:16 clip + ပစ္စည်းအသံ) ─┬─→ video-th.mp4  ထိုင်း voiceover + hook/subtitle/CTA
AI script (th / my သီးသန့်) ───────────────────────┴─→ video-my.mp4  မြန်မာ voiceover + hook/subtitle/CTA
```

## Stack
| အပိုင်း | နည်းပညာ |
|---|---|
| `apps/web` | React 19 + Vite (dashboard) |
| `apps/api` | Express (auth / products / scripts / jobs / signed media) |
| `apps/worker` | BullMQ worker (Seedance သို့မဟုတ် အခမဲ့ photo clip → render th → render my) |
| `packages/db` | PostgreSQL + SQL migrations |
| `packages/providers` | Seedance (BytePlus ModelArk), LLM (OpenAI-compatible), Shopee Affiliate API |
| `packages/video-engine` | FFmpeg + libass + HarfBuzz — ထိုင်း/မြန်မာ စာ မှန်ကန်စွာ render |
| Infra | Docker Compose (Postgres 16 + Redis 7) |

## VS Code မှာ စတင်ခြင်း

### 1. လိုအပ်တာများ install
- **Node.js 22+**, **Git**, **Docker Desktop**
- **FFmpeg 6.1+** (libass + harfbuzz ပါတဲ့ build)
  - Windows: `winget install Gyan.FFmpeg`
  - macOS: `brew install ffmpeg-full` ပြီးရင် `echo 'export PATH="/opt/homebrew/opt/ffmpeg-full/bin:$PATH"' >> ~/.zshrc`
    (⚠ Homebrew ရဲ့ ရိုးရိုး `ffmpeg` မှာ libass/`ass` filter မပါတော့လို့ စာတန်း render မရပါ — `ffmpeg -filters | grep " ass "` နဲ့ စစ်ပါ)
  - Ubuntu 24.04: `sudo apt install ffmpeg`
- VS Code ကဖွင့်ရင် recommended extensions တွေကို install လုပ်ခိုင်းပါလိမ့်မယ် (`.vscode/extensions.json`)

### 2. Run
```bash
npm install
cp .env.example .env          # Windows PowerShell: copy .env.example .env
npm run infra:up              # Postgres + Redis (Docker)
npm run db:migrate
npm run dev                   # api :4000 + worker + web :5173
```
Browser မှာ http://localhost:5173 ကိုဖွင့်ပြီး account လုပ်ကာ ပစ္စည်းထည့် → **AI write scripts** → **Create videos** နှိပ်ပါ။

> **API key မထည့်ဘဲ run လို့ရပါတယ်:** LLM key မရှိရင် နမူနာ script သုံးပါတယ်၊ Seedance key မရှိရင် **ထည့်ထားတဲ့ ပစ္စည်းပုံ ၁–၄ ပုံကို zoom/pan + crossfade နဲ့ 9:16 video** လုပ်ပေးပါတယ် (အခမဲ့၊ `CLIP_MODE=photos`)၊ `TTS_PROVIDER=none` ဆိုရင် voiceover မပါပါဘူး။ Pipeline တစ်ခုလုံးကို ငွေမကုန်ဘဲ စမ်းလို့ရပါတယ်။ (`CLIP_MODE=sample` ဆိုမှ `samples/sample-product-clip.mp4` ကို သုံးပါတယ်)

### 3. Debug
VS Code → Run and Debug → **API + Worker** (`.vscode/launch.json`)

### 4. Test
```bash
npm test     # provider unit tests + ထိုင်း/မြန်မာ video render tests
```

## API key တွေ (`.env`)
| Key | ဘယ်ကရမလဲ | မှတ်ချက် |
|---|---|---|
| `SEEDANCE_API_KEY`, `SEEDANCE_MODEL` | BytePlus ModelArk console | Seedance 2.5 model ID ကို model list ကနေ ကူးပါ။ Resource pack ဝယ်ထားရပါမယ် |
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` | OpenAI / OpenRouter / Gemini (OpenAI-compatible) | **မြန်မာစာ quality** ကို model အမျိုးမျိုး စမ်းပါ |
| `CLIP_MODE=gemini`, `GEMINI_API_KEY`, `GEMINI_VIDEO_*` | aistudio.google.com → API keys (paid tier) | Seedance အစား Gemini Omni video (၃–၁၅ s)။ စမ်းရန်: `node --env-file=.env packages/providers/scripts/try-gemini-video.mjs ပုံ.jpg` (≈ $0.10) |
| `TTS_PROVIDER=azure`, `AZURE_SPEECH_KEY` | Azure AI Speech | Production မှာ ဒါကိုပဲ သုံးပါ။ `edge` က တရားဝင်မဟုတ်လို့ prototype အတွက်ပဲ |
| `TTS_PROVIDER=gemini`, `GEMINI_TTS_VOICE` | `GEMINI_API_KEY` တစ်ခုတည်း | သဘာဝအကျဆုံး (TikTok creator လို ပြောပုံ)၊ ထိုင်း+မြန်မာ နှစ်ခုလုံး ရ၊ video တစ်ခု ≈ $0.003 |
| `TTS_PROVIDER=edge`, `EDGE_TTS_BIN` | `brew install pipx && pipx install edge-tts` | အခမဲ့ (key မလို)။ `EDGE_TTS_BIN=$HOME/.local/bin/edge-tts`။ ဆက်တိုက်ခေါ်ရင် ခဏ throttle ဖြစ်တတ်လို့ engine က backoff နဲ့ retry ပြီး ဘာသာတူ အခြား voice ကို ပြောင်းသုံးပါတယ် |
| `SHOPEE_APP_ID`, `SHOPEE_SECRET` | affiliate.shopee.co.th → Open API | Shopee link ထည့်ရင် affiliate short link အလိုအလျောက် လုပ်ပေးပါတယ် |

## Credit စနစ် (SaaS)
- Account အသစ်ဖွင့်ရင် `SIGNUP_FREE_CREDITS` (30) ရပါတယ်။ Video job တစ်ခု = `JOB_CREDIT_COST` (10)
- **Pre-spend gate:** "Create videos" နှိပ်ရင် `GET /api/jobs/quote` က credit ကုန်ကျမှု၊ လက်ကျန်၊ Seedance model/ကြာချိန်/resolution နဲ့ Seedance ကို ပို့မယ့် prompt အပြည့်ကို အရင်ပြပါတယ်။ User က "Confirm" နှိပ်မှ `POST /api/jobs` (`confirm_cost` ပါမှ) credit နုတ်ပါတယ်။ စျေးပြောင်းသွားရင် 409 ပြန်ပြီး ထပ်အတည်ပြုခိုင်းပါတယ်
- Job စတင်တာနဲ့ credit နုတ်ပြီး fail ဖြစ်ရင် (queue error, worker stall အပါအဝင်) **အလိုအလျောက် တစ်ကြိမ်တည်း ပြန်အမ်း**ပါတယ်။ အပြောင်းအလဲတိုင်းကို `credit_ledger` မှာ မှတ်ထားပါတယ်
- Admin က credit ထည့်/နုတ်: `npm run credits:add -- <email> 100` (နုတ်ရင် `-50`)။ `credit_ledger` မှာ `admin` အဖြစ် မှတ်ပါတယ်
- AI script ရေးတာ user တစ်ယောက် တစ်နာရီ `SCRIPT_GEN_PER_HOUR` (20) ကြိမ်။ Script: hook ≤80၊ စာကြောင်း ≤6 ကြောင်း (တစ်ကြောင်း ≤160)၊ CTA ≤80 စာလုံး
- Seedance task ကို DB ထဲ သိမ်းထားလို့ worker restart ဖြစ်လည်း **အသစ်ထပ်မခေါ်ဘဲ ဆက်စောင့်**ပါတယ် (ပိုက်ဆံ နှစ်ခါမကုန်ပါ)

## လုံခြုံရေး (ပါပြီးသား)
- bcrypt password, JWT, login rate limit, helmet
- User တစ်ယောက်ချင်း ကိုယ့် data ကိုပဲ မြင်ရ (query တိုင်း `user_id` စစ်)
- Video/ပုံ ဖိုင်တွေကို **signed URL** (6 နာရီ သက်တမ်း) နဲ့ပဲ ဖွင့်လို့ရ၊ path traversal ကာကွယ်ထား
- Upload: jpg/png/webp, 10MB, max 4 ပုံ (extension ကို mime type ကနေယူ၊ validation မအောင်ရင် ဖိုင်ဖျက်)
- API response တွေမှာ server path / internal error စာသား မပါ (user ကို အကြောင်းရင်း တိုတိုပဲ ပြ၊ အပြည့်အစုံက DB `video_jobs.error` မှာ)
- Shopee affiliate link ကို `https://shopee.*` / `shp.ee` host အစစ်တွေအတွက်ပဲ ထုတ်ပေး
- API က `127.0.0.1` ပေါ်မှာပဲ listen လုပ်ပါတယ် → production မှာ nginx နောက်ကွယ်မှာ ထားပါ

## Video ပုံစံ (Thai TikTok seller video ကို လေ့လာပြီး ချထားတာ)
- **Hook ကို 0.15s ကစ အသံနဲ့ပြော** + အပေါ်မှာ စာနဲ့ပြ။ TTS ရှေ့နောက် တိတ်ဆိတ်ချိန် (~1s/စာကြောင်း) ကို ဖြတ်ပြီး ဆက်တိုက်ပြော
- **Video အရှည် = အသံအရှည်** (နောက်ဆုံးစကား + 0.8s)။ ဘာသာတစ်ခုချင်း သူ့အရှည်နဲ့သူ (မြန်မာက ပိုရှည်)
- **အခမဲ့ ပုံ video:** ~2.2s တိုင်း hard cut — ပစ္စည်းအပြည့် (zoom) ↔ close-up (ချဲ့ + pan)၊ နောက်ဆုံး shot က အမြဲ အပြည့်
- **Key-phrase စာတန်း:** စာကြောင်းတိုင်းမှာ "On-screen text" (`scripts.captions`) ထည့်လို့ရ — ပြောတဲ့စကားအစား ရောင်းချက်အတို (ဥပမာ "လေအား ၅ ဆင့်") ကို box နဲ့ ကြီးကြီးပြ။ ဗလာ = ပြောတဲ့စကားကိုပြ။ `.srt` က ပြောတဲ့စကားအတိုင်း
- **Seedance style:** `product` (လက်/close-up/သုံးပြ) သို့မဟုတ် `presenter` (AI လူက ကိုင်ပြ၊ **စကားမပြော** — clip တစ်ခုကို ထိုင်း/မြန်မာ နှစ်ခုလုံးမှာ သုံးလို့ voiceover ကို ဘာသာအလိုက်ထည့်)
- AI video model က စာကို pixel အဖြစ်ဆွဲရင် ထိုင်းစာတောင် စာလုံးပေါင်းမှားလို့ (reference video မှာ ၃ နေရာ) prompt မှာ "No on-screen text" — စာအားလုံးကို engine က ထိုး

## ထိုင်း/မြန်မာ စာအတွက် အရေးကြီးချက်များ (video-engine)
- Font: Noto Sans Thai, **Padauk** (Noto Sans Myanmar က `ပြ/ပြီး` မှား render လုပ်လို့), Noto Sans (Latin/ဂဏန်း) — အားလုံး OFL
- `ass` filter + `shaping=complex` (`subtitles` filter မှာ မြန်မာစာ ပျက်ပါတယ်)
- `Intl.Segmenter` + HarfBuzz width တိုင်းပြီး စာကြောင်းခွဲ (သရ/အသတ် မပြတ်)
- မြန်မာ script တိုတိုရေးပါ — ပြောရတာ ထိုင်းထက် ကြာပါတယ်

## Roadmap (နောက်အဆင့်များ)
1. [ ] UI ကို မြန်မာ / ထိုင်း ဘာသာ (i18n)
2. [x] Seedance မခေါ်ခင် prompt + ကုန်ကျစရိတ် ပြပြီး အတည်ပြုခိုင်း (pre-spend gate)
3. [ ] Clip ထွက်လာရင် "ပစ္စည်းနဲ့တူသလား" approve/reject + reject ရင် ပြန်ထုတ်
4. [ ] Shopee product search page (API ပြီးသား: `GET /api/shopee/search?q=`)
5. [ ] TikTok Content Posting API → draft upload, Shopee Video upload (socialautoupload.com နဲ့ ချိတ်)
6. [ ] Credit ဝယ်ရန် payment (Stripe / PromptPay / KBZPay စသည်)
7. [ ] Object storage (S3 / Hetzner) + ဖိုင်ဟောင်းများ အလိုအလျောက် ဖျက်
8. [ ] Hook / CTA A/B variants, template library
9. [ ] Admin dashboard (user, credit, API ကုန်ကျစရိတ်)

## Production (Hetzner Ubuntu 24.04)
- `apt install ffmpeg` (6.1) — Docker image သုံးရင် FFmpeg ≥ 6.1 ပါတဲ့ base (ubuntu:24.04) ကိုသုံးပါ၊ Debian 12 (5.1) မသုံးပါနဲ့
- PM2: `pm2 start apps/api/src/server.js --node-args="--env-file=.env"` နဲ့ worker ကိုလည်း ထိုနည်းတူ
- nginx: `apps/web/dist` ကို static serve + `/api` ကို `127.0.0.1:4000` သို့ proxy
- `NODE_ENV=production` နဲ့ `JWT_SECRET=$(openssl rand -hex 32)` ထားပါ — production မှာ secret အားနည်းရင် API က start မလုပ်ပါ
