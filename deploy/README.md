# Cloud Run ပေါ် တင်ခြင်း (Singapore · asia-southeast1)

```
Browser ─→ Cloud Run (container ၁ ခု: API + dashboard + video worker)
              ├─ Cloud SQL Postgres 16     (users, credits, products, jobs)
              ├─ Cloud Storage bucket → /data (ပစ္စည်းပုံ + ထုတ်ပြီး video)
              ├─ Upstash Redis              (BullMQ job queue)
              └─ Gemini API                 (video · အသံ · script)
```

## လိုအပ်တာ (တစ်ခါပဲ)
1. **Google Cloud project + billing** — https://console.cloud.google.com → project အသစ် → Billing ချိတ်
2. **gcloud CLI** — `brew install --cask google-cloud-sdk` → `gcloud auth login`
3. **Redis** — https://upstash.com → Redis database (region: Singapore) → `rediss://…` URL ကို ကူးပါ
   (Cloud Memorystore က လစဉ် ~$35+ ဖြစ်လို့ စစချင်း Upstash ကို သုံးပါ)
4. `.env` မှာ `GEMINI_API_KEY`, `CLIP_MODE`, `TTS_PROVIDER`, `GEMINI_TTS_VOICE`, `LLM_*` မှန်နေပါစေ
   (script က `.env` ထဲက key တွေကို Secret Manager ထဲ ထည့်ပေးပါတယ် — image ထဲ မပါပါ)

## Deploy
```bash
PROJECT_ID=<your-project-id> REDIS_URL='rediss://default:…@….upstash.io:6379' ./deploy/cloudrun.sh
```
- ပထမအကြိမ် ~15 မိနစ် (Cloud SQL ဖန်တီးရလို့)၊ နောက်ပိုင်း version အသစ်တင်ရင် ~5 မိနစ်
- ပြီးရင် `✓ live at https://affiliate-video-….run.app` ပြပါမယ်
- Code ပြင်ပြီး ထပ်တင်ချင်ရင် command တူတူကို ပြန် run ပါ (database / ဖိုင်တွေ မပျောက်ပါ)
- Database migration တွေကို container စတိုင်း အလိုအလျောက် run ပါတယ်

## Deploy မလုပ်ခင် ကိုယ့်စက်မှာ စမ်းရန်
```bash
docker build -t affiliate-video-app .
docker run --rm -p 8080:8080 --env-file .env \
  -e DATABASE_URL=postgres://app:app@host.docker.internal:5432/affiliate_video \
  -e REDIS_URL=redis://host.docker.internal:6379/1 -e JWT_SECRET=$(openssl rand -hex 32) \
  affiliate-video-app
# → http://localhost:8080
```

## လစဉ် ကုန်ကျစရိတ် (ခန့်မှန်း — Google ရဲ့ pricing calculator နဲ့ ပြန်စစ်ပါ)
| | |
|---|---|
| Cloud Run (1 vCPU · 2 GiB · အမြဲဖွင့်) | ~$55–60 |
| Cloud SQL db-f1-micro + 10 GB | ~$10–12 |
| Cloud Storage | ~$1 (video 1,000 ခုဆို ~5 GB) |
| Upstash Redis | $0–10 |
| **စုစုပေါင်း (video မထုတ်ရသေးခင်)** | **~$70–80** |
| + Gemini (video တစ်ခုစီ) | ~$0.71 |

Worker က job ကို အမြဲစောင့်နေရလို့ instance တစ်ခု အမြဲဖွင့်ထားရပါတယ် — ဒါက အဓိက ကုန်ကျစရိတ်ပါ။
User နည်းသေးရင် **Compute Engine e2-small VM (~$13/လ) + docker compose** က ပိုသက်သာပါတယ်။

## Credit ထည့်ခြင်း / database ကြည့်ခြင်း
Console → SQL → `avs-db` → **Cloud SQL Studio** (user `app`, password က Secret Manager `avs-database-url` ထဲမှာ)
```sql
UPDATE users SET credits = credits + 100 WHERE email = 'customer@example.com';
```

## သတိ
- `--max-instances 1` — API နဲ့ worker က instance တစ်ခုတည်းမှာ run တယ်။ User များလာရင် `ROLE=api` / `ROLE=worker`
  service ၂ ခု ခွဲပြီး API ကို scale လုပ်ပါ (`deploy/start.mjs`)
- Cloud Run ရဲ့ `/tmp` က memory ထဲမှာပါ — render ပြီးတိုင်း ရှင်းပေးထားပါတယ်
- Cloud Build က permission error ပြရင်: Console → Cloud Build → Settings → service account ကို
  "Cloud Run Admin" + "Artifact Registry Writer" ပေးပါ
