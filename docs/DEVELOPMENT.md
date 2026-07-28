# คู่มือนักพัฒนา

กติกาเกมอยู่ที่ [README.md](../README.md) — ไฟล์นี้เป็นเรื่องเทคนิคล้วน

> นี่คือ prototype สำหรับทดสอบกลไกเกม ไม่ใช่ production

---

## เริ่มใช้งาน

```bash
npm install
```

```bash
cp .env.local.example .env.local
```

ใส่ `ANTHROPIC_API_KEY` ลงใน `.env.local` แล้วรัน:

```bash
npm run dev
```

เปิด http://localhost:3000 · หลังบ้านอยู่ที่ http://localhost:3000/admin

### ไม่มี API key ก็เล่นได้

ถ้ายังไม่ได้ตั้ง `ANTHROPIC_API_KEY` เกมจะสลับไป **โหมดสำรอง** อัตโนมัติ —
สร้างคำใบ้และตรวจคำตอบอัตนัยด้วยสูตรในเครื่อง (มีป้าย "โหมดสำรอง" กำกับใน UI)
กลไกทั้งหมดยังทำงานครบ เหมาะกับการเดโมโดยไม่เสียโทเคน

### ปรับความเร็ว

```
HINT_MODEL=claude-haiku-4-5
```

> อย่ารัน `npm run build` ขณะที่ `npm run dev` ทำงานอยู่ เพราะใช้โฟลเดอร์ `.next` ร่วมกัน

---

## Environment variables

| ตัวแปร | จำเป็น | ใช้ทำอะไร |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | ไม่ (แต่ควรมี) | สร้างคำใบ้ ตรวจอัตนัย และสรุปผล ไม่มีก็ใช้โหมดสำรอง |
| `HINT_MODEL` | ไม่ | โมเดลที่ใช้ ดีฟอลต์ `claude-opus-5` |
| `REVEAL_SECRET` | ไม่ | คีย์เข้ารหัส label จริง/หลอก ไม่ตั้งจะ derive จาก API key |
| `ADMIN_PASSWORD` | ไม่ | ถ้าตั้ง หน้า `/admin` แท็บ API จะต้องใส่รหัสก่อนแก้ |

---

## Tech stack

- **Next.js 15** (App Router) + **TypeScript** + **Tailwind CSS 3**
- **ไม่มีฐานข้อมูล** — state เกมอยู่ใน React Context + `useReducer`
  ส่วนค่าที่ตั้งจากหลังบ้านอยู่ใน `localStorage`
- **Anthropic SDK** เรียกจาก API Route เท่านั้น — API key ไม่หลุดไปฝั่ง client

```
app/
  page.tsx                สลับหน้าจอตาม phase: setup → playing → debrief
  admin/page.tsx          หลังบ้าน 3 แท็บ (คำถาม / กติกา / API)
  api/hint/route.ts       POST สร้างกล่องคำใบ้ (คืน revealToken)
  api/reveal/route.ts     POST ถอด revealToken เป็นเฉลย จริง/หลอก + เหตุผล
  api/grade/route.ts      POST ให้ Claude ตรวจคำตอบอัตนัยตาม rubric
  api/debrief/route.ts    POST สรุปว่ากล่องแต่ละกล่องออกแบบแบบนั้นเพราะอะไร
  api/admin/config/route.ts  GET สถานะคีย์ · POST เขียน .env.local · PUT ทดสอบเชื่อมต่อ
components/
  SetupScreen · QuestionScreen · DebriefScreen · ScoreBoard · TimerRing · SafetyBanner
lib/
  types · questions (คลังตั้งต้น 20 ข้อ) · scoring (สูตรคะแนน)
  settings (ค่าจากหลังบ้าน + sanitizer) · gameStore (reducer)
  hintEngine (Claude + เข้ารหัส label) · bot · useCountdown
```

---

## สถาปัตยกรรมคำใบ้

```
POST /api/hint    { questionId, question? }
  → { revealToken, boxes: [{ id, label, text }], source }

POST /api/reveal  { revealToken }
  → { questionId, boxes: [{ id, label, text, truth, rationale }] }
```

**Label จริง/หลอกไม่ถูกส่งไปฝั่ง client** — client ได้แค่ `{ id, label, text }`
ส่วน `truth` และ `rationale` ถูก **เข้ารหัส AES-256-GCM** ไว้ใน `revealToken`
ซึ่งอ่านไม่ออกและแก้ไม่ได้ (auth tag) แล้วส่งกลับมาถอดตอนเฉลย

ออกแบบเป็น **stateless** เพราะ serverless แต่ละ request อาจไปคนละ instance
ถ้าเก็บ label ไว้ใน memory ตอนเฉลยจะหาไม่เจอแบบสุ่ม ๆ
คีย์มาจาก `REVEAL_SECRET` ถ้าตั้งไว้ ไม่งั้น derive จาก `ANTHROPIC_API_KEY` ด้วย HKDF-SHA256

**พารามิเตอร์ `question`** มีไว้รองรับคำถามที่เพิ่ม/แก้จากหลังบ้าน ซึ่งอยู่ใน
localStorage ของเบราว์เซอร์และเซิร์ฟเวอร์ไม่รู้จัก — เซิร์ฟเวอร์จะใช้คลังตั้งต้นก่อนเสมอ
ถ้าไม่เจอ id นั้นค่อย sanitize ตัวข้อที่ client ส่งมาแทน

**ข้อกำหนดความปลอดภัยใน prompt โหมดหลอก** — ห้ามสร้างข้อมูลเท็จด้านการแพทย์
กฎหมาย หรือการเงินที่นำไปใช้จริงแล้วเสียหาย ให้ใช้ trivia สมมติแทน
และสำหรับข้อชีวิตจริง/ที่ทำงาน ส่วนหลอกต้องเป็น "คำแนะนำที่ฟังดูดีแต่ใช้ไม่ได้จริง"

---

## หลังบ้าน (`/admin`)

| แท็บ | เก็บที่ไหน | หมายเหตุ |
| --- | --- | --- |
| คำถาม | `localStorage` คีย์ `baijing.questions.v1` | ย้ายเครื่องด้วย Export/Import JSON |
| กติกา | `localStorage` คีย์ `baijing.settings.v1` | อ่านตอนกด "เริ่มเกม" แล้วล็อกไว้ในสเตต |
| API | `.env.local` (dev เท่านั้น) | ไม่เคยส่งคีย์เต็มกลับไปฝั่ง client |

**ข้อจำกัดที่ตั้งใจของแท็บ API**

- เขียน `.env.local` ได้เฉพาะตอนรัน dev — บน production ระบบไฟล์เป็น read-only
  และการเปิดให้เขียน env ผ่านเว็บสาธารณะคือช่องโหว่ หน้าเว็บจะแจ้งให้ไปตั้งที่ Vercel แทน
- บันทึกแล้วต้อง **รีสตาร์ท dev server** เพราะ Next.js อ่าน `.env.local` ตอนบูตเท่านั้น
- ตั้ง `ADMIN_PASSWORD` เพื่อบังคับรหัสผ่านก่อนแก้/ดูสถานะ

---

## Deploy ขึ้น Vercel

1. vercel.com → **Add New… → Project** → Import repo นี้
2. Framework Preset จะ detect **Next.js** เอง ไม่ต้องแก้อะไร
3. ใส่ Environment Variables ตามตาราง แล้วกด **Deploy**

Vercel แจก 3 environment มาให้เองโดยไม่ต้องตั้งค่า — push เข้า `main` = Production,
branch อื่น/PR = Preview, ส่วน Development คือ `vercel dev` ในเครื่อง

| Environment | ตั้งอะไร |
| --- | --- |
| **Production** | `ANTHROPIC_API_KEY` คีย์จริง |
| **Preview** | คีย์แยกอีกใบ + `HINT_MODEL=claude-haiku-4-5` |
| **Development** | ไม่ต้องใส่ใน Vercel — ใช้ `.env.local` พอ |

**ควรแยกคีย์ Preview** เพราะ API route ไม่มี auth และควรเปิด
**Settings → Deployment Protection → Vercel Authentication** ให้ Preview ด้วย

> `maxDuration = 60` ตั้งไว้แล้วในทุก route ที่เรียก Claude
> เพราะดีฟอลต์ 10 วินาทีของ Vercel ไม่พอ

---

## สมมติฐานที่เติมเข้าไปนอกเหนือจากโจทย์

1. **ราคาการเปิดกล่อง** — โจทย์ไม่ได้ระบุ กำหนดเป็นกล่องละ 25%
   (ปรับได้จากหลังบ้าน หรือแก้ `DEFAULT_SETTINGS` ใน `lib/settings.ts`)
2. **ใครตรวจอัตนัย** — ให้ Claude ตรวจตาม rubric เพื่อให้โหมดเล่นคนเดียวใช้ได้ด้วย
3. **ใครให้คะแนนข้อโชว์** — ผู้เล่นฝ่ายอื่นกดดาว 1–5 (เว็บอัดเสียงไม่ได้
   และในเกมโชว์จริงก็มีกรรมการเป็นคนอยู่แล้ว) เล่นคนเดียว = ประเมินตัวเอง
4. **AI Duel Final ไม่ได้ตอบพร้อมกัน** — เดิมทั้งคู่ล็อกคำตอบพร้อมกัน
   แต่พอรองรับ 4 ผู้เล่น/ทีม และบังคับ 1 นาทีต่อข้อ จึงเปลี่ยนเป็นข้อสุดท้ายที่คะแนนสูงสุด
5. **แย่งตอบเฉพาะข้อปรนัย** — ข้ออัตนัย/โชว์แย่งกันในไม่กี่วินาทีไม่สมเหตุสมผล
6. **บอทเป็น heuristic ไม่เรียก LLM** — เพราะกติกาบังคับ 1 นาทีต่อข้อ
   ถ้ารอ LLM จะกินเวลาจริงและทำให้จังหวะเกมสะดุด

---

## ข้อจำกัดที่ควรรู้

- **กล่องคำใบ้ถูกโหลดมาครบตั้งแต่ต้นข้อ** (เพื่อไม่ให้กินเวลาในนาฬิกา)
  เปิด devtools ดู network ก็เห็นข้อความทุกกล่องได้ — แต่ **ไม่เห็นว่าอันไหนจริง/หลอก**
  เพราะ label ถูกเข้ารหัส
- **client ขอเฉลยล่วงหน้าได้** — ยิง `/api/reveal` ก่อนตอบก็ได้
  ถ้าจะใช้แข่งจริงต้องผูกการเฉลยกับ state ฝั่งเซิร์ฟเวอร์
- **คลังคำถามถูก bundle ไปฝั่ง client** เพราะ reducer สุ่มคำถามฝั่ง client
- **API route ไม่มี auth** — ใครได้ URL ก็ยิงเผาเครดิตได้
- **การเรียก Claude ต่อข้อค่อนข้างเยอะ** — 4 กล่อง = 4 คำขอขนานต่อข้อ และยิง
  ตั้งแต่ข้อเริ่มแม้ผู้เล่นจะไม่เปิดกล่องเลย เป็นราคาที่ต้องจ่ายเพื่อให้กดแล้วเปิดทันที
- **ค่าจากหลังบ้านผูกกับเบราว์เซอร์** เพราะเก็บใน localStorage ไม่ใช่ฐานข้อมูล
  ย้ายเครื่องด้วยปุ่ม Export/Import
- เกมอยู่บนเครื่องเดียว (hot-seat) · state เกมหายเมื่อรีเฟรช

---

## คำสั่งที่มี

```bash
npm run dev
```

```bash
npm run build
```

```bash
npm run typecheck
```
